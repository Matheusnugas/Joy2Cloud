// Joy2Cloud control tab: owns the Bluetooth connections to both Joy-Con,
// turns their reports into one Xbox-style gamepad state, and streams it to
// game tabs (bridge.js -> inject.js).
import {
  NINTENDO_COMPANY_ID, SERVICE, CHAR_INPUT, CHAR_COMMAND, CHAR_RESPONSE,
  CHAR_SIDE_LEFT, CHAR_SIDE_RIGHT, CHAR_RUMBLE_LEFT, CHAR_RUMBLE_RIGHT,
  CMD, BTN, parseReport, batteryPercent, StickCalibrator, mapButtons,
  rumblePacket, splitRumble, FLASH_STICK_CAL, readFlashCommand,
  parseFlashResponse, decodeStickCalibration, STICK_BINS,
} from './joycon.js';
import { LANGS, setLang, getLang, t, toastStrings } from './i18n.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sideName = (side) => t(side === 'L' ? 'leftName' : 'rightName');

// ---------- language ----------
const langSelect = $('lang');
for (const [code, name] of LANGS) langSelect.add(new Option(name, code));

function applyText() {
  document.documentElement.lang = getLang();
  langSelect.value = getLang();
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  $('recenter').textContent = t(calibration.active ? 'calCancel' : 'calibrateButton');
  buildChips();
  applySettingsToUi();
  render();
}

langSelect.addEventListener('change', () => {
  setLang(langSelect.value);
  chrome.storage.local.set({ lang: getLang(), toast: toastStrings(getLang()) });
  applyText();
});

// ---------- log ----------
function log(msg, isErr = false) {
  const el = $('log');
  const line = document.createElement('div');
  if (isErr) line.className = 'err';
  const time = document.createElement('time');
  time.textContent = new Date().toLocaleTimeString();
  line.append(time, msg);
  el.prepend(line);
  while (el.childNodes.length > 80) el.lastChild.remove();
  (isErr ? console.error : console.log)('[joy2cloud]', msg);
  if (isErr) $('log').closest('details').open = true;
}

// ---------- settings ----------
const settings = { layout: 'position', rumble: true, strength: 100 };
setLang('en');
let savedCalibrations = {}; // device id -> stick profile

function applySettingsToUi() {
  document.querySelectorAll('input[name="layout"]').forEach((r) => { r.checked = r.value === settings.layout; });
  $('layoutHelp').textContent = t(settings.layout === 'label' ? 'layoutHelpLabel' : 'layoutHelpPosition');
  $('rumble').checked = settings.rumble;
  $('strength').value = settings.strength;
  $('strength').disabled = !settings.rumble;
  $('testRumble').disabled = !settings.rumble;
  $('strengthValue').textContent = settings.strength + '%';
}

chrome.storage.local.get(['lang', 'layout', 'rumble', 'strength', 'stickCal']).then((s) => {
  setLang(s.lang || 'en');
  if (!s.lang) chrome.storage.local.set({ lang: 'en', toast: toastStrings('en') });
  if (s.layout) settings.layout = s.layout;
  if (typeof s.rumble === 'boolean') settings.rumble = s.rumble;
  if (typeof s.strength === 'number') settings.strength = s.strength;
  savedCalibrations = s.stickCal || {};
  applyText();
  pushState(true);
});

document.querySelectorAll('input[name="layout"]').forEach((r) => r.addEventListener('change', () => {
  settings.layout = r.value;
  chrome.storage.local.set({ layout: settings.layout });
  applySettingsToUi();
  pushState(true);
}));
$('rumble').addEventListener('change', (e) => {
  settings.rumble = e.target.checked;
  chrome.storage.local.set({ rumble: settings.rumble });
  applySettingsToUi();
  if (!settings.rumble) stopRumble();
});
$('strength').addEventListener('input', (e) => {
  settings.strength = +e.target.value;
  $('strengthValue').textContent = settings.strength + '%';
});
$('strength').addEventListener('change', () => chrome.storage.local.set({ strength: settings.strength }));
$('testRumble').addEventListener('click', () => handleRumble({ strong: 0.85, weak: 0.55, duration: 450 }, true));

// ---------- Joy-Con connections ----------
// slot: { device, side, connected, reconnecting, dropped, cmd, rumbleChar,
//         calib, bits, stick, batteryMv, sideFromData, rumble: {...}, pending }
const slots = { L: null, R: null };
const allSlots = () => [slots.L, slots.R].filter(Boolean);
const connectedSlots = () => allSlots().filter((s) => s.connected);

function newSlot(device) {
  return {
    device, side: null, connected: false, reconnecting: false, dropped: false,
    cmd: null, rumbleChar: null, calib: new StickCalibrator(),
    bits: 0, stick: { x: 0, y: 0 }, raw: null, batteryMv: 0, sideFromData: false,
    rumble: { amp: 0, until: 0, last: 0, counter: 0, writing: false },
    pending: new Map(), trail: [],
  };
}

function plausibleStick(s) {
  return s.x > 400 && s.x < 3700 && s.y > 400 && s.y < 3700;
}

async function detectSide(service) {
  try { await service.getCharacteristic(CHAR_SIDE_LEFT); return 'L'; } catch (_) { /* not left */ }
  try { await service.getCharacteristic(CHAR_SIDE_RIGHT); return 'R'; } catch (_) { /* not right */ }
  return null;
}

async function writeCmd(slot, bytes) {
  if (!slot.cmd) return;
  try {
    if (slot.cmd.writeValueWithoutResponse) await slot.cmd.writeValueWithoutResponse(bytes);
    else await slot.cmd.writeValue(bytes);
  } catch (e) {
    log(t('logCmdFailed', sideName(slot.side), e.message), true);
  }
}

// Reads flash memory through command 0x02/0x04; the answer arrives on the
// response characteristic.
function readFlash(slot, addr, len) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { slot.pending.delete(addr); resolve(null); }, 1500);
    slot.pending.set(addr, (data) => { clearTimeout(timer); resolve(data); });
    writeCmd(slot, readFlashCommand(addr, len));
  });
}

function onResponse(slot, dv) {
  const r = parseFlashResponse(dv);
  if (!r) return;
  const cb = slot.pending.get(r.addr);
  if (cb) { slot.pending.delete(r.addr); cb(r.data); }
}

function assignSlot(slot, side) {
  const other = side === 'L' ? 'R' : 'L';
  if (slots[other] === slot) slots[other] = null;
  const prev = slots[side];
  if (prev && prev !== slot) {
    if (slots[other] == null) {
      // other side is free: move the old one there and let its data confirm
      slots[other] = prev;
      prev.side = other;
      prev.sideFromData = false;
      prev.calib.reset();
    } else {
      // both sides taken: replace the old one
      prev.dropped = true;
      prev.reconnecting = false;
      try { prev.device.gatt.disconnect(); } catch (_) { /* ignore */ }
    }
  }
  slot.side = side;
  slots[side] = slot;
}

async function loadCalibration(slot) {
  const custom = savedCalibrations[slot.device.id];
  const data = await readFlash(slot, FLASH_STICK_CAL, 9);
  const factory = decodeStickCalibration(data);
  if (factory) slot.calib.setFactory(factory);
  if (custom) {
    slot.calib.setCustom(custom);
    log(t('logCustomCal', sideName(slot.side)));
  } else if (factory) {
    log(t('logFactoryCal', sideName(slot.side)));
  } else {
    log(t('logNoFactoryCal', sideName(slot.side)));
  }
}

async function setupDevice(device, slot) {
  slot = slot || newSlot(device);

  log(t('logConnecting', device.name || 'Joy-Con'));
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(SERVICE);

  let side = slot.side || await detectSide(service);
  if (!side) side = slots.L ? 'R' : 'L';
  assignSlot(slot, side);

  const input = await service.getCharacteristic(CHAR_INPUT);
  const response = await service.getCharacteristic(CHAR_RESPONSE).catch(() => null);
  slot.cmd = await service.getCharacteristic(CHAR_COMMAND).catch(() => null);
  slot.rumbleChar = await service
    .getCharacteristic(slot.side === 'L' ? CHAR_RUMBLE_LEFT : CHAR_RUMBLE_RIGHT)
    .catch(() => null);

  if (!slot.listening) {
    input.addEventListener('characteristicvaluechanged', (ev) => onInput(slot, ev.target.value));
    if (response) response.addEventListener('characteristicvaluechanged', (ev) => onResponse(slot, ev.target.value));
    device.addEventListener('gattserverdisconnected', () => onDisconnected(slot));
    slot.listening = true;
  }
  if (response) await response.startNotifications().catch(() => {});
  await input.startNotifications();

  slot.connected = true;
  slot.reconnecting = false;
  slot.dropped = false;
  render();
  log(t('logConnected', sideName(slot.side)));

  await sleep(120);
  await loadCalibration(slot);
  await writeCmd(slot, CMD.playerLed(0x01));
  await sleep(60);
  await writeCmd(slot, CMD.connectVibration());
  pushState(true);
  return slot;
}

function onInput(slot, dv) {
  const r = parseReport(dv);
  if (!r) return;

  // Each Joy-Con only fills in its own stick, so the data confirms the side.
  if (!slot.sideFromData) {
    const l = plausibleStick(r.leftStick);
    const rr = plausibleStick(r.rightStick);
    if (l !== rr) {
      const dataSide = l ? 'L' : 'R';
      slot.sideFromData = true;
      if (dataSide !== slot.side) {
        assignSlot(slot, dataSide);
        slot.calib.reset();
        log(t('logSideFixed', sideName(dataSide)));
        render();
      }
    }
  }

  slot.bits = r.buttons;
  slot.batteryMv = r.batteryMv || slot.batteryMv;
  slot.raw = slot.side === 'L' ? r.leftStick : r.rightStick;
  slot.stick = slot.calib.update(slot.raw);
  tickRumble(slot);
  if (calibration.active) tickCalibration();
  pushState(false);
}

async function onDisconnected(slot) {
  if (slot.dropped) { slot.connected = false; render(); pushState(true); return; }
  if (!slot.connected && slot.reconnecting) return;
  slot.connected = false;
  slot.bits = 0;
  slot.stick = { x: 0, y: 0 };
  slot.rumble.amp = 0;
  log(t('logDisconnected', sideName(slot.side)), true);
  render();
  pushState(true);

  slot.reconnecting = true;
  render();
  const until = Date.now() + 90_000;
  while (slot.reconnecting && Date.now() < until) {
    await sleep(3000);
    if (!slot.reconnecting || slot.connected) return;
    try {
      await setupDevice(slot.device, slot);
      return;
    } catch (_) {
      // keep trying; the user can press sync
    }
  }
  if (!slot.connected) {
    slot.reconnecting = false;
    log(t('logGaveUp', sideName(slot.side)), true);
    if (slots[slot.side] === slot) slots[slot.side] = null;
    render();
    pushState(true);
  }
}

// On macOS, Chrome does not expose manufacturer data to the device chooser,
// so a Nintendo company-ID filter never matches. There we list everything.
const isMac = /Mac/i.test(navigator.userAgentData?.platform || navigator.platform || navigator.userAgent);

async function pair() {
  if (!navigator.bluetooth) {
    log(t('logNoBluetooth'), true);
    return;
  }
  try {
    if (navigator.bluetooth.getAvailability && !(await navigator.bluetooth.getAvailability())) {
      log(t('logBtUnavailable'), true);
    }
  } catch (_) { /* ignore */ }

  log(t('logChooser'));
  let device;
  try {
    device = await navigator.bluetooth.requestDevice(isMac
      ? { acceptAllDevices: true, optionalServices: [SERVICE] }
      : { filters: [{ manufacturerData: [{ companyIdentifier: NINTENDO_COMPANY_ID }] }], optionalServices: [SERVICE] });
  } catch (e) {
    if (/cancel/i.test(e.message)) log(t('logCancelled'));
    else log(t('logBtError', e.name, e.message), true);
    return;
  }

  const existing = allSlots().find((s) => s.device.id === device.id);
  try {
    await setupDevice(device, existing);
  } catch (e) {
    if (/service/i.test(e.message)) log(t('logNotJoycon'), true);
    else log(t('logConnectFailed', e.message), true);
    try { device.gatt.disconnect(); } catch (_) { /* ignore */ }
  }
}

$('pair').addEventListener('click', pair);

// ---------- guided stick calibration ----------
const calibration = { active: false, phase: 'idle', slots: [] };

function startCalibration() {
  const targets = connectedSlots();
  if (!targets.length) return;
  calibration.active = true;
  calibration.phase = 'release';
  calibration.slots = targets;
  targets.forEach((s) => s.calib.startCapture());
  $('recenter').textContent = t('calCancel');
  render();
}

function cancelCalibration() {
  calibration.slots.forEach((s) => { s.calib.capture = null; s.calib.reset(); });
  endCalibration();
}

function endCalibration() {
  calibration.active = false;
  calibration.phase = 'idle';
  calibration.slots = [];
  $('recenter').textContent = t('calibrateButton');
  render();
}

function tickCalibration() {
  const list = calibration.slots.filter((s) => s.connected);
  if (!list.length) { cancelCalibration(); return; }
  if (calibration.phase === 'release' && list.every((s) => s.calib.centerKnown)) {
    calibration.phase = 'rotate';
  }
  if (calibration.phase === 'rotate' && list.every((s) => s.calib.captureProgress() >= 1)) {
    // wait until the sticks are released again before saving
    if (list.every((s) => Math.hypot(s.stick.x, s.stick.y) === 0 || s.raw == null)) {
      const updates = {};
      for (const s of list) {
        const profile = s.calib.finishCapture();
        if (profile) updates[s.device.id] = profile;
      }
      savedCalibrations = { ...savedCalibrations, ...updates };
      chrome.storage.local.set({ stickCal: savedCalibrations });
      log(t('calSaved'));
      endCalibration();
      return;
    }
  }
  renderCalibrationText();
}

$('recenter').addEventListener('click', () => {
  if (calibration.active) cancelCalibration();
  else startCalibration();
});

$('resetCal').addEventListener('click', () => {
  for (const s of allSlots()) delete savedCalibrations[s.device.id];
  chrome.storage.local.set({ stickCal: savedCalibrations });
  allSlots().forEach((s) => { s.calib.setCustom(null); });
  log(t('logCalReset'));
});

// ---------- vibration ----------
function stopRumble() {
  for (const s of allSlots()) {
    s.rumble.amp = 0;
    s.rumble.until = 0;
    if (s.connected && s.rumbleChar) sendRumble(s, 0);
  }
}

async function sendRumble(slot, amp) {
  const r = slot.rumble;
  if (!slot.rumbleChar || r.writing) return;
  r.writing = true;
  try {
    r.counter = (r.counter + 1) & 0x0f;
    await slot.rumbleChar.writeValueWithoutResponse(rumblePacket(amp, r.counter, settings.strength / 100));
  } catch (_) {
    // vibration is best-effort
  } finally {
    r.writing = false;
  }
}

// Vibration is re-sent with every incoming Joy-Con report (tickRumble in
// onInput) instead of setInterval: Chrome throttles timers in background
// tabs to once a second, and short gaps between packets feel like buzzing.
function handleRumble({ strong = 0, weak = 0, duration = 0 }, force = false) {
  if (!settings.rumble && !force) return;
  const split = splitRumble(strong, weak);
  const ms = Math.min(5000, Math.max(0, duration));
  for (const s of connectedSlots()) {
    if (!s.rumbleChar) continue;
    const amp = split[s.side] || 0;
    if (amp <= 0 || ms <= 0) {
      s.rumble.amp = 0;
      s.rumble.until = 0;
      sendRumble(s, 0);
      continue;
    }
    s.rumble.amp = amp;
    s.rumble.until = performance.now() + ms;
    s.rumble.last = 0;
    tickRumble(s);
  }
}

function tickRumble(s) {
  const r = s.rumble;
  if (!r.amp) return;
  const now = performance.now();
  if (now >= r.until) {
    r.amp = 0;
    sendRumble(s, 0);
    return;
  }
  if (now - r.last >= 12) {
    r.last = now;
    sendRumble(s, r.amp);
  }
}

// ---------- state for game tabs ----------
const ports = new Set();
let lastSent = '';

function currentState() {
  const L = slots.L && slots.L.connected ? slots.L : null;
  const R = slots.R && slots.R.connected ? slots.R : null;
  // while calibrating, the game sees a still controller
  const live = !calibration.active;
  const bits = live ? (L ? L.bits : 0) | (R ? R.bits : 0) : 0;
  const ls = live && L ? L.stick : { x: 0, y: 0 };
  const rs = live && R ? R.stick : { x: 0, y: 0 };
  return {
    type: 'state',
    active: !!(L || R),
    buttons: mapButtons(bits, settings.layout),
    axes: [ls.x, ls.y, rs.x, rs.y].map((v) => Math.round(v * 1000) / 1000),
  };
}

let frameQueued = false;
function pushState(force) {
  const st = currentState();
  const key = JSON.stringify(st);
  if (force || key !== lastSent) {
    lastSent = key;
    for (const p of ports) {
      try { p.postMessage(st); } catch (_) { ports.delete(p); }
    }
  }
  if (!frameQueued) {
    frameQueued = true;
    requestAnimationFrame(() => { frameQueued = false; drawLive(); });
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'joy2cloud') return;
  ports.add(port);
  port.onMessage.addListener((msg) => {
    if (msg && msg.type === 'rumble') handleRumble(msg);
  });
  port.onDisconnect.addListener(() => { ports.delete(port); renderLink(); });
  port.postMessage(currentState());
  renderLink();
});

// ---------- interface ----------
const chipEls = { L: [], R: [] };
function buildChips() {
  const labels = {
    L: [['ZL', BTN.ZL], ['L', BTN.L], ['−', BTN.MINUS], ['↑', BTN.UP], ['↓', BTN.DOWN], ['←', BTN.LEFT],
      ['→', BTN.RIGHT], [t('chipStick'), BTN.LS], [t('chipCapture'), BTN.CAPTURE], ['SL', BTN.SL_L], ['SR', BTN.SR_L]],
    R: [['ZR', BTN.ZR], ['R', BTN.R], ['+', BTN.PLUS], ['A', BTN.A], ['B', BTN.B], ['X', BTN.X], ['Y', BTN.Y],
      [t('chipStick'), BTN.RS], [t('chipHome'), BTN.HOME], ['C', BTN.C], ['SL', BTN.SL_R], ['SR', BTN.SR_R]],
  };
  for (const side of ['L', 'R']) {
    const box = $('chips' + side);
    box.textContent = '';
    chipEls[side] = [];
    for (const [label, mask] of labels[side]) {
      const el = document.createElement('span');
      el.className = 'chip';
      el.textContent = label;
      box.appendChild(el);
      chipEls[side].push([el, mask]);
    }
  }
}

function render() {
  for (const side of ['L', 'R']) {
    const s = slots[side];
    const half = $('half' + side);
    let state = 'empty';
    let text = t('stateEmpty');
    if (s && s.connected) {
      state = 'on';
      const pct = batteryPercent(s.batteryMv);
      text = pct != null ? t('stateBattery', pct) : t('stateOn');
    } else if (s && s.reconnecting) {
      state = 'waiting';
      text = t('stateWaiting');
    }
    half.dataset.state = state;
    $('state' + side).textContent = text;
  }
  $('recenter').disabled = !connectedSlots().length;
  $('resetCal').disabled = !allSlots().some((s) => savedCalibrations[s.device.id]);
  renderCalibrationText();
  renderLink();
  drawLive();
}
setInterval(render, 5000);

function renderCalibrationText() {
  for (const side of ['L', 'R']) {
    const s = slots[side];
    const el = $('cal' + side);
    if (!calibration.active || !s || !calibration.slots.includes(s)) { el.hidden = true; continue; }
    el.hidden = false;
    if (calibration.phase === 'release' || !s.calib.centerKnown) {
      el.textContent = t('calRelease');
    } else {
      const pct = Math.round(s.calib.captureProgress() * 100);
      el.textContent = pct >= 100 ? t('calLetGo') : t('calRotate', pct);
    }
  }
}

function renderLink() {
  const n = ports.size;
  const active = connectedSlots().length > 0;
  const link = $('link');
  link.dataset.state = n && active ? 'live' : n ? 'waiting' : 'idle';
  $('linkText').textContent = !n ? t('linkIdle') : n === 1 ? t('linkLiveOne') : t('linkLiveMany', n);
}

// Stick view: the stick's calibrated edge, a short trail, and the dot.
const canvases = {};
function setupCanvas(side) {
  const c = $('stick' + side);
  const dpr = window.devicePixelRatio || 1;
  const size = 176;
  c.width = size * dpr; c.height = size * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  canvases[side] = { ctx, size };
}
setupCanvas('L'); setupCanvas('R');

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function drawLive() {
  for (const side of ['L', 'R']) {
    const s = slots[side];
    const half = $('half' + side);
    for (const [el, mask] of chipEls[side]) el.classList.toggle('on', !!(s && s.connected && (s.bits & mask)));

    const { ctx, size } = canvases[side];
    const mid = size / 2;
    const radius = 70;
    const color = cssVar(side === 'L' ? '--left' : '--right');
    const line = cssVar('--line');
    const muted = cssVar('--muted');
    ctx.clearRect(0, 0, size, size);

    // edge shape (circle until a Joy-Con is connected)
    const shape = s ? s.calib.shape() : new Array(STICK_BINS).fill(1);
    ctx.beginPath();
    shape.forEach((r, i) => {
      const a = (i / STICK_BINS) * Math.PI * 2;
      const x = mid + Math.cos(a) * radius * r;
      const y = mid - Math.sin(a) * radius * r;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = line;
    ctx.stroke();

    // during guided calibration, fill the directions already covered
    if (s && s.calib.capture) {
      const cap = s.calib.capture.bins;
      const ref = Math.max(...s.calib.bins);
      ctx.beginPath();
      cap.forEach((r, i) => {
        const a = (i / STICK_BINS) * Math.PI * 2;
        const k = Math.min(1, r / ref);
        const x = mid + Math.cos(a) * radius * k;
        const y = mid - Math.sin(a) * radius * k;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = color + '33';
      ctx.fill();
    }

    // crosshair
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mid - 8, mid); ctx.lineTo(mid + 8, mid);
    ctx.moveTo(mid, mid - 8); ctx.lineTo(mid, mid + 8);
    ctx.stroke();

    if (!s || !s.connected) { half.classList.remove('moving'); continue; }

    const px = mid + s.stick.x * radius;
    const py = mid + s.stick.y * radius;
    s.trail.push([px, py]);
    if (s.trail.length > 16) s.trail.shift();

    if (s.trail.length > 1) {
      for (let i = 1; i < s.trail.length; i++) {
        ctx.beginPath();
        ctx.moveTo(s.trail[i - 1][0], s.trail[i - 1][1]);
        ctx.lineTo(s.trail[i][0], s.trail[i][1]);
        ctx.strokeStyle = color;
        ctx.globalAlpha = (i / s.trail.length) * 0.5;
        ctx.lineWidth = 2 + (i / s.trail.length) * 6;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    ctx.beginPath();
    ctx.arc(px, py, 9, 0, Math.PI * 2);
    ctx.fillStyle = (s.bits & (side === 'L' ? BTN.LS : BTN.RS)) ? muted : color;
    ctx.fill();
  }
}

applyText();
log(t('logReady'));

// Debug hook for the console and the test suite: simulate input without Bluetooth.
globalThis.joy2cloudDebug = { slots, newSlot, assignSlot, onInput, pushState, handleRumble, render, calibration };
