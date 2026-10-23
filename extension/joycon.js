// Joy-Con 2 (Switch 2) Bluetooth LE protocol.
// Protocol facts from github.com/ndeadly/switch2_controller_research
// (bluetooth_interface.md, hid_reports.md); some details ported from
// github.com/OZORDI/JoyCon2Mac (MIT).

export const NINTENDO_COMPANY_ID = 0x0553;
export const SERVICE = 'ab7de9be-89fe-49ad-828f-118f09df7fd0';
export const CHAR_INPUT = 'ab7de9be-89fe-49ad-828f-118f09df7fd2';   // input report 0x05 (common)
export const CHAR_COMMAND = '649d4ac9-8eb7-4e6c-af44-1ea54fe5f005'; // commands
export const CHAR_RESPONSE = 'c765a961-d9d8-4d36-a20a-5315b111836a'; // command responses
export const CHAR_SIDE_LEFT = 'cc1bbbb5-7354-4d32-a716-a81cb241a32a';  // only on Joy-Con (L)
export const CHAR_SIDE_RIGHT = 'd5a9e01e-2ffc-4cca-b20c-8b67142bf442'; // only on Joy-Con (R)
export const CHAR_RUMBLE_LEFT = '289326cb-a471-485d-a8f4-240c14f18241';
export const CHAR_RUMBLE_RIGHT = 'fa19b0fb-cd1f-46a7-84a1-bbb09e00c149';

// Report 0x05 buttons: 32-bit little-endian at offset 0x4.
export const BTN = {
  Y: 1 << 0, X: 1 << 1, B: 1 << 2, A: 1 << 3,
  SR_R: 1 << 4, SL_R: 1 << 5, R: 1 << 6, ZR: 1 << 7,
  MINUS: 1 << 8, PLUS: 1 << 9, RS: 1 << 10, LS: 1 << 11,
  HOME: 1 << 12, CAPTURE: 1 << 13, C: 1 << 14,
  DOWN: 1 << 16, UP: 1 << 17, RIGHT: 1 << 18, LEFT: 1 << 19,
  SR_L: 1 << 20, SL_L: 1 << 21, L: 1 << 22, ZL: 1 << 23,
};

export const CMD = {
  // 09 91 01 07 00 08 00 00 [LED mask] ...
  playerLed: (mask) => new Uint8Array([0x09, 0x91, 0x01, 0x07, 0x00, 0x08, 0x00, 0x00,
    mask & 0x0f, 0, 0, 0, 0, 0, 0, 0]),
  connectVibration: () => new Uint8Array([0x0a, 0x91, 0x01, 0x02, 0x00, 0x04, 0x00, 0x00,
    0x03, 0x00, 0x00, 0x00]),
};

function stick12(dv, off) {
  const b0 = dv.getUint8(off);
  const b1 = dv.getUint8(off + 1);
  const b2 = dv.getUint8(off + 2);
  return { x: b0 | ((b1 & 0x0f) << 8), y: (b1 >> 4) | (b2 << 4) };
}

// Decodes input report 0x05. Returns null for short packets.
export function parseReport(dv) {
  if (!dv || dv.byteLength < 0x10) return null;
  const out = {
    counter: dv.getUint32(0, true),
    buttons: dv.getUint32(4, true) & 0x00ffffff,
    leftStick: stick12(dv, 0x0a),
    rightStick: stick12(dv, 0x0d),
    batteryMv: 0,
  };
  if (dv.byteLength >= 0x21) out.batteryMv = dv.getUint16(0x1f, true);
  return out;
}

// Battery estimate from voltage (same curve as JoyCon2Mac).
export function batteryPercent(mv) {
  if (!mv) return null;
  const v = mv / 1000;
  const empty = 3.0, nominal = 3.89, full = 4.45;
  const pct = v <= nominal
    ? ((v - empty) / (nominal - empty)) * 50
    : 50 + ((v - nominal) / (full - nominal)) * 50;
  return Math.round(Math.max(0, Math.min(100, pct)));
}

// ---------------------------------------------------------------------------
// Stick calibration
//
// Factory calibration lives in flash at 0x130A8 (9 bytes): three packed 12-bit
// (x, y) pairs = center, positive reach, negative reach. Joy-Con 2 has a single
// stick, stored as the "primary" one.
export const FLASH_STICK_CAL = 0x130a8;

function unpack12(b, o) {
  return { x: b[o] | ((b[o + 1] & 0x0f) << 8), y: (b[o + 1] >> 4) | (b[o + 2] << 4) };
}

export function decodeStickCalibration(bytes) {
  if (!bytes || bytes.length < 9) return null;
  const center = unpack12(bytes, 0);
  const pos = unpack12(bytes, 3);
  const neg = unpack12(bytes, 6);
  const okCenter = (v) => v >= 1400 && v <= 2700;
  const okReach = (v) => v >= 700 && v <= 2047;
  if (![center.x, center.y].every(okCenter)) return null;
  if (![pos.x, pos.y, neg.x, neg.y].every(okReach)) return null;
  return { cx: center.x, cy: center.y, px: pos.x, py: pos.y, nx: neg.x, ny: neg.y };
}

// Command 0x02 / 0x04: read `len` bytes of flash at `addr` (max 0x4F over BLE).
export function readFlashCommand(addr, len) {
  return new Uint8Array([0x02, 0x91, 0x01, 0x04, 0x00, 0x08, 0x00, 0x00,
    len & 0xff, 0x7e, 0x00, 0x00,
    addr & 0xff, (addr >> 8) & 0xff, (addr >> 16) & 0xff, (addr >> 24) & 0xff]);
}

// Response: 8-byte header (02 01 01 04 ...), then len, 7e?, 00 00, addr, data.
export function parseFlashResponse(dv) {
  if (!dv || dv.byteLength < 16) return null;
  const u = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
  if (u[0] !== 0x02 || u[3] !== 0x04) return null;
  const len = u[8];
  const addr = u[12] | (u[13] << 8) | (u[14] << 16) | (u[15] << 24);
  return { addr, data: u.slice(16, 16 + len) };
}

// The calibrator maps raw 12-bit readings to a circular -1..1 output.
// The stick's real outer edge is stored as a radius per direction (32 bins),
// so octagonal or slightly lopsided gates still give full diagonals.
// Sources, in order of preference: a guided calibration the user recorded,
// the factory data, then a generic default. Bins also grow on their own when
// the stick reaches further than the table expects.
export const STICK_BINS = 32;
const TAU = Math.PI * 2;
const DEFAULT_REACH = 1450;
const INNER_DEADZONE = 0.1;
const OUTER_SATURATION = 0.93;

export class StickCalibrator {
  constructor() {
    this.factory = null;
    this.custom = null;
    this.capture = null;
    this.reset();
  }

  setFactory(f) { this.factory = f; this.reset(); }
  setCustom(c) { this.custom = c && Array.isArray(c.bins) && c.bins.length === STICK_BINS ? c : null; this.reset(); }

  // Restores center and edge shape from the best available source.
  reset() {
    const src = this.custom || null;
    if (src) {
      this.cx = src.cx; this.cy = src.cy;
      this.bins = src.bins.slice();
    } else if (this.factory) {
      const f = this.factory;
      this.cx = f.cx; this.cy = f.cy;
      // ellipse through the four factory reaches, 3% in so the edge is reachable
      this.bins = Array.from({ length: STICK_BINS }, (_, i) => {
        const a = (i / STICK_BINS) * TAU;
        const c = Math.cos(a), s = Math.sin(a);
        const rx = c >= 0 ? f.px : f.nx;
        const ry = s >= 0 ? f.py : f.ny;
        return 0.97 / Math.sqrt((c / rx) ** 2 + (s / ry) ** 2);
      });
    } else {
      this.cx = null; this.cy = null;
      this.bins = new Array(STICK_BINS).fill(DEFAULT_REACH);
    }
    this.centerKnown = this.cx != null;
    this.rest = { n: 0, sx: 0, sy: 0 };
    this.last = null;
  }

  // Re-measures the resting center (stick released). Keeps the edge shape.
  recenter() {
    this.centerKnown = false;
    this.rest = { n: 0, sx: 0, sy: 0 };
  }

  startCapture() {
    this.capture = { bins: new Array(STICK_BINS).fill(0) };
    this.recenter();
  }

  // Fraction of directions the user has pushed to the edge during capture.
  captureProgress() {
    if (!this.capture) return 0;
    const reached = this.capture.bins.filter((r) => r >= 0.55 * DEFAULT_REACH).length;
    return reached / STICK_BINS;
  }

  // Finishes the guided calibration. Returns the profile to persist, or null
  // if not enough directions were covered.
  finishCapture() {
    const cap = this.capture;
    this.capture = null;
    if (!cap || this.cx == null) return null;
    const min = 0.55 * DEFAULT_REACH;
    const known = cap.bins.map((r) => (r >= min ? r : 0));
    if (known.filter(Boolean).length < STICK_BINS * 0.75) return null;
    // fill gaps by interpolating between the nearest recorded neighbours
    const bins = known.map((r, i) => {
      if (r) return r;
      let a = 1, b = 1;
      while (!known[(i - a + STICK_BINS) % STICK_BINS]) a++;
      while (!known[(i + b) % STICK_BINS]) b++;
      const ra = known[(i - a + STICK_BINS) % STICK_BINS];
      const rb = known[(i + b) % STICK_BINS];
      return ra + ((rb - ra) * a) / (a + b);
    });
    // light smoothing so one noisy sample does not dent the edge
    const smooth = bins.map((r, i) => {
      const p = bins[(i - 1 + STICK_BINS) % STICK_BINS];
      const n = bins[(i + 1) % STICK_BINS];
      return Math.max(r * 0.98, (p + 2 * r + n) / 4);
    });
    const profile = { cx: this.cx, cy: this.cy, bins: smooth.map((r) => Math.round(r)) };
    this.setCustom(profile);
    return profile;
  }

  edgeAt(angle) {
    const p = (((angle % TAU) + TAU) % TAU) / TAU * STICK_BINS;
    const i = Math.floor(p) % STICK_BINS;
    const f = p - Math.floor(p);
    return this.bins[i] * (1 - f) + this.bins[(i + 1) % STICK_BINS] * f;
  }

  update(raw) {
    const still = this.last && Math.abs(raw.x - this.last.x) <= 6 && Math.abs(raw.y - this.last.y) <= 6;
    this.last = raw;

    // Learn (or re-learn) the resting center from 30 still samples near neutral.
    if (!this.centerKnown) {
      const nearRef = this.cx == null
        ? raw.x >= 1400 && raw.x <= 2700 && raw.y >= 1400 && raw.y <= 2700
        : Math.abs(raw.x - this.cx) <= 220 && Math.abs(raw.y - this.cy) <= 220;
      if (still && nearRef) {
        this.rest.n++; this.rest.sx += raw.x; this.rest.sy += raw.y;
        if (this.rest.n >= 30) {
          this.cx = this.rest.sx / this.rest.n;
          this.cy = this.rest.sy / this.rest.n;
          this.centerKnown = true;
        }
      } else {
        this.rest = { n: 0, sx: 0, sy: 0 };
      }
      if (this.cx == null) return { x: 0, y: 0 };
    }

    const dx = raw.x - this.cx;
    const dy = raw.y - this.cy;
    const r = Math.hypot(dx, dy);
    if (r < 1) return { x: 0, y: 0 };
    const angle = Math.atan2(dy, dx);
    const bin = Math.round(((((angle % TAU) + TAU) % TAU) / TAU) * STICK_BINS) % STICK_BINS;

    if (this.capture) {
      if (r > this.capture.bins[bin]) this.capture.bins[bin] = r;
    } else if (this.centerKnown && r > this.bins[bin] && r < 2047) {
      this.bins[bin] = r; // the stick reached further than expected: widen
    }

    const n = r / this.edgeAt(angle);
    if (n < INNER_DEADZONE) return { x: 0, y: 0 };
    const m = Math.min(1, (n - INNER_DEADZONE) / (OUTER_SATURATION - INNER_DEADZONE));
    // Joy-Con Y grows upward; Gamepad API Y grows downward
    return { x: clamp((dx / r) * m), y: clamp((-dy / r) * m) };
  }

  // Edge shape normalized to the largest bin, for drawing.
  shape() {
    const max = Math.max(...this.bins);
    return this.bins.map((r) => r / max);
  }
}

const clamp = (v) => Math.max(-1, Math.min(1, v));

// Gamepad API "standard" mapping indices (Xbox layout).
export const STD = {
  A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7,
  VIEW: 8, MENU: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, GUIDE: 16,
};

// 'position': the Joy-Con's bottom button (B) becomes Xbox A, and so on.
// 'label': each Joy-Con letter becomes the same Xbox letter.
export function mapButtons(bits, layout = 'position') {
  const b = new Array(17).fill(0);
  const on = (mask) => ((bits & mask) ? 1 : 0);
  if (layout === 'label') {
    b[STD.A] = on(BTN.A); b[STD.B] = on(BTN.B); b[STD.X] = on(BTN.X); b[STD.Y] = on(BTN.Y);
  } else {
    b[STD.A] = on(BTN.B); b[STD.B] = on(BTN.A); b[STD.X] = on(BTN.Y); b[STD.Y] = on(BTN.X);
  }
  b[STD.LB] = on(BTN.L); b[STD.RB] = on(BTN.R);
  b[STD.LT] = on(BTN.ZL); b[STD.RT] = on(BTN.ZR);
  b[STD.VIEW] = on(BTN.MINUS) | on(BTN.CAPTURE);
  b[STD.MENU] = on(BTN.PLUS);
  b[STD.LS] = on(BTN.LS); b[STD.RS] = on(BTN.RS);
  b[STD.UP] = on(BTN.UP); b[STD.DOWN] = on(BTN.DOWN);
  b[STD.LEFT] = on(BTN.LEFT); b[STD.RIGHT] = on(BTN.RIGHT);
  b[STD.GUIDE] = on(BTN.HOME);
  return b;
}

// Rumble packet (42 bytes) for each side's vibration characteristic.
// Block layout ported from JoyCon2Mac (FillJoyConVibrationMotorBlock, MIT).
// amplitude01: 0..1 from the game. strength: user multiplier (0.5..1.5).
// A perceptual curve makes light effects noticeable; the 10-bit amplitude
// ceiling scales with strength (768 at 100%, capped at 1023).
export function rumbleAmplitude10(amplitude01, strength = 1) {
  const a = Math.max(0, Math.min(1, amplitude01));
  if (a <= 0.01) return 0;
  const ceiling = Math.min(1023, Math.round(768 * strength));
  return Math.round(64 + Math.pow(a, 0.6) * (ceiling - 64));
}

export function rumblePacket(amplitude01, counter, strength = 1) {
  const packet = new Uint8Array(42);
  const amp = rumbleAmplitude10(amplitude01, strength);
  if (amp === 0) return packet;
  const freq = 512;
  // 40 bits: amp<<30 | freq<<20 | amp<<10 | freq
  const packed = (BigInt(amp & 0x3ff) << 30n) | (BigInt(freq) << 20n) |
    (BigInt(amp & 0x3ff) << 10n) | BigInt(freq);
  for (const start of [1, 17]) {
    packet[start] = (0x05 << 4) | (counter & 0x0f);
    for (let i = 0; i < 5; i++) packet[start + 1 + i] = Number((packed >> BigInt(8 * i)) & 0xffn);
  }
  return packet;
}

// Splits an Xbox-style dual-rumble effect across the two halves: the strong
// (low-frequency) motor lives in the left grip, the weak (high-frequency)
// motor in the right grip, with some bleed so neither side feels dead.
export function splitRumble(strong, weak) {
  const s = Math.max(0, Math.min(1, +strong || 0));
  const w = Math.max(0, Math.min(1, +weak || 0));
  return { L: Math.max(s, w * 0.6), R: Math.max(w, s * 0.6) };
}
