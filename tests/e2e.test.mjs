// End-to-end test: loads the extension in Chromium, fakes two Joy-Con in the
// control tab (no Bluetooth needed) and checks what a game page sees.
// Run with `npm test` (needs `npx playwright install chromium` once).
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const EXT = fileURLToPath(new URL('../extension', import.meta.url));
const ctx = await chromium.launchPersistentContext('', {
  headless: true,
  channel: 'chromium',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
const errors = [];
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;

// a stand-in game page on one of the matched hosts
await ctx.route('https://gamepad-tester.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>game</title>' }));
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('page: ' + e.message));
await page.goto('https://gamepad-tester.com/');
await page.evaluate(() => {
  window.__events = [];
  addEventListener('gamepadconnected', (e) => __events.push(['connected', e.gamepad.id]));
  addEventListener('gamepaddisconnected', (e) => __events.push(['disconnected', e.gamepad.connected]));
});
assert.equal(await page.evaluate(() => [...navigator.getGamepads()].filter(Boolean).length), 0);

const hub = await ctx.newPage();
hub.on('pageerror', (e) => errors.push('hub: ' + e.message));
hub.on('console', (m) => { if (m.type() === 'error') errors.push('hub console: ' + m.text()); });
await hub.goto(`chrome-extension://${extId}/hub.html`);
await hub.waitForFunction(() => !!globalThis.joy2cloudDebug);

// UI language: English by default, switchable
assert.equal(await hub.textContent('#pair'), 'Pair a Joy-Con');
await hub.selectOption('#lang', 'pt');
assert.equal(await hub.textContent('#pair'), 'Parear um Joy-Con');
await hub.selectOption('#lang', 'fr');
assert.equal(await hub.textContent('#pair'), 'Associer un Joy-Con');
await hub.selectOption('#lang', 'en');

// wait for the game page's bridge to connect (it retries every 2 s)
await hub.waitForFunction(() => document.getElementById('linkText').textContent !== 'No game tab open', null, { timeout: 8000 });

await hub.evaluate(() => {
  const { newSlot, assignSlot, onInput } = joy2cloudDebug;
  const mk = (side) => {
    const s = newSlot({ id: 'fake-' + side, gatt: { disconnect() {} } });
    s.connected = true;
    s.rumbleChar = { writes: [], async writeValueWithoutResponse(b) { this.writes.push([...b.slice(0, 8)]); } };
    assignSlot(s, side);
    return s;
  };
  // assign sides the wrong way round: the data must correct them
  const a = mk('R'), b = mk('L');
  const pkt = (buttons, left, right) => {
    const u = new Uint8Array(0x3f); const dv = new DataView(u.buffer);
    dv.setUint32(4, buttons, true);
    const put = (o, [x, y]) => { u[o] = x & 255; u[o + 1] = ((x >> 8) & 15) | ((y & 15) << 4); u[o + 2] = (y >> 4) & 255; };
    put(0x0a, left); put(0x0d, right); dv.setUint16(0x1f, 3890, true); return dv;
  };
  globalThis.__feed = (aBits, aLeft, bBits, bRight, n = 1) => {
    for (let i = 0; i < n; i++) { onInput(a, pkt(aBits, aLeft, [0, 0])); onInput(b, pkt(bBits, [0, 0], bRight)); }
  };
  globalThis.__fake = { a, b };
  __feed(0, [2048, 2048], 0, [2048, 2048], 40); // rest -> learn centers
});
assert.deepEqual(await hub.evaluate(() => [__fake.a.side, __fake.b.side]), ['L', 'R'], 'side corrected from data');
await hub.evaluate(() => __feed(0, [2048, 2048], 0, [2048, 2048], 35));

// Joy-Con B (-> Xbox A), ZL, D-pad up; left stick fully up; right stick ~half right
const BTN_B = 1 << 2, BTN_ZL = 1 << 23, BTN_UP = 1 << 17;
await hub.evaluate(([l, r]) => __feed(l, [2048, 2048 + 1450], r, [2048 + 700, 2048], 1), [BTN_ZL | BTN_UP, BTN_B]);
await page.waitForFunction(() => navigator.getGamepads()[0] && navigator.getGamepads()[0].buttons[0].pressed, null, { timeout: 3000 });
const pad = await page.evaluate(() => {
  const p = navigator.getGamepads()[0];
  return { id: p.id, mapping: p.mapping, isGamepad: p instanceof Gamepad,
    pressed: p.buttons.map((b, i) => (b.pressed ? i : -1)).filter((i) => i >= 0), axes: [...p.axes], events: __events };
});
assert.deepEqual(pad.pressed, [0, 6, 12]);
assert.ok(pad.axes[1] < -0.99, 'left stick up = -1');
assert.ok(pad.axes[2] > 0.3 && pad.axes[2] < 0.6, 'right stick half right');
assert.equal(pad.mapping, 'standard');
assert.ok(pad.isGamepad);
assert.deepEqual(pad.events[0], ['connected', 'Xbox 360 Controller (XInput STANDARD GAMEPAD)']);

// the control tab's live view lights the matching chips
assert.ok(await hub.evaluate(() => [...document.querySelectorAll('#chipsL .chip.on')].map((c) => c.textContent).join(',') === 'ZL,↑'));

// "By letter" layout: Joy-Con B -> Xbox B
await hub.click('input[value="label"] + span');
await page.waitForFunction(() => navigator.getGamepads()[0].buttons[1].pressed);
await hub.click('input[value="position"] + span');

// rumble: page -> bridge -> control tab -> both halves, stops with a zero packet
await page.evaluate(() => navigator.getGamepads()[0].vibrationActuator.playEffect('dual-rumble', { duration: 200, strongMagnitude: 1, weakMagnitude: 0.5 }));
for (let i = 0; i < 20; i++) { await hub.evaluate(() => __feed(0, [2048, 2048], 0, [2048, 2048], 1)); await hub.waitForTimeout(20); }
const writes = await hub.evaluate(() => [__fake.a.rumbleChar.writes.length, __fake.b.rumbleChar.writes.length, __fake.a.rumbleChar.writes.at(-1)]);
assert.ok(writes[0] >= 5 && writes[1] >= 5, 'rumble packets on both sides: ' + writes);
assert.deepEqual(writes[2].slice(1, 7), [0, 0, 0, 0, 0, 0], 'rumble ends with a zero packet');

// guided calibration: release, rotate, release -> profile saved
await hub.click('#recenter');
await hub.evaluate(() => __feed(0, [2048, 2048], 0, [2048, 2048], 40));
await hub.evaluate(() => {
  for (let k = 0; k < 3; k++) for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const p = [Math.round(2048 + Math.cos(a) * 1400), Math.round(2048 + Math.sin(a) * 1400)];
    __feed(0, p, 0, p, 1);
  }
});
assert.equal(await hub.evaluate(() => joy2cloudDebug.calibration.phase), 'rotate');
await hub.evaluate(() => __feed(0, [2048, 2048], 0, [2048, 2048], 5));
assert.equal(await hub.evaluate(() => joy2cloudDebug.calibration.active), false, 'calibration finished');
const saved = await hub.evaluate(() => chrome.storage.local.get('stickCal'));
assert.ok(saved.stickCal['fake-L'] && saved.stickCal['fake-R'], 'profiles saved per device');

// theme toggle: dark by default, persisted
assert.equal(await hub.evaluate(() => document.documentElement.dataset.theme), 'dark');
await hub.click('#theme');
assert.equal(await hub.evaluate(() => document.documentElement.dataset.theme), 'light');
assert.equal((await hub.evaluate(() => chrome.storage.local.get('theme'))).theme, 'light');
await hub.click('#theme');

// disconnect one side: the game keeps a controller, the side is freed, no auto-reconnect
await hub.click('#dropL');
assert.equal(await hub.evaluate(() => joy2cloudDebug.slots.L), null);
assert.equal(await hub.evaluate(() => document.getElementById('halfL').dataset.state), 'empty');
assert.equal(await hub.evaluate(() => __fake.a.reconnecting), false);
await page.waitForFunction(() => !!navigator.getGamepads()[0]);
// input from the disconnected Joy-Con is ignored
await hub.evaluate(() => __feed(1 << 23, [2048, 2048], 0, [2048, 2048], 1));
assert.equal(await page.evaluate(() => navigator.getGamepads()[0].buttons[6].pressed), false);

// disconnect all: the game loses the controller and gets a disconnect event
await hub.click('#dropAll');
await page.waitForFunction(() => !navigator.getGamepads()[0]);
assert.deepEqual((await page.evaluate(() => __events)).at(-1), ['disconnected', false]);
assert.equal(await hub.isDisabled('#dropAll'), true);

// closing the control tab removes the virtual controller
await hub.evaluate(() => {
  const { newSlot, assignSlot, pushState } = joy2cloudDebug;
  const s = newSlot({ id: 'again', gatt: { disconnect() {} } });
  s.connected = true; assignSlot(s, 'L'); pushState(true);
});
await page.waitForFunction(() => !!navigator.getGamepads()[0]);
await hub.close();
await page.waitForFunction(() => !navigator.getGamepads()[0], null, { timeout: 5000 });

assert.deepEqual(errors, []);
console.log('e2e tests OK');
await ctx.close();
