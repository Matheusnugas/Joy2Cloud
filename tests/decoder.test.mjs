import assert from 'node:assert/strict';
import * as jc from '../extension/joycon.js';

function packet({ buttons = 0, left = [2048, 2048], right = [0, 0], mv = 3890 } = {}) {
  const b = new Uint8Array(0x3f);
  new DataView(b.buffer).setUint32(4, buttons, true);
  const put = (off, [x, y]) => { b[off] = x & 0xff; b[off + 1] = ((x >> 8) & 0x0f) | ((y & 0x0f) << 4); b[off + 2] = (y >> 4) & 0xff; };
  put(0x0a, left); put(0x0d, right);
  new DataView(b.buffer).setUint16(0x1f, mv, true);
  return new DataView(b.buffer);
}

// stick packing round-trip
const r = jc.parseReport(packet({ left: [1234, 3000], right: [4095, 1] }));
assert.deepEqual(r.leftStick, { x: 1234, y: 3000 });
assert.deepEqual(r.rightStick, { x: 4095, y: 1 });
assert.equal(jc.batteryPercent(r.batteryMv), 50);

// cross-check bits against JoyCon2Mac masks (right uses bytes[3..5], left bytes[4..6] of the BLE buffer)
function jcmRight(buf) { return (buf[3] << 16) | (buf[4] << 8) | buf[5]; }
function jcmLeft(buf) { return (buf[4] << 16) | (buf[5] << 8) | buf[6]; }
const raw = (bits) => new Uint8Array(packet({ buttons: bits }).buffer);
assert.ok(jcmRight(raw(jc.BTN.A)) & 0x000800, 'A');
// X/B: JoyCon2Mac differs; ndeadly docs + Nohzockt/Switch2-Controllers enum (bit index) agree:
const SW2 = { Y:0, X:1, B:2, A:3, R_SR:4, R_SL:5, R:6, ZR:7, MINUS:8, PLUS:9, RJ:10, LJ:11, HOME:12, CAPTURE:13, C:14, DOWN:16, UP:17, RIGHT:18, LEFT:19, L_SR:20, L_SL:21, L:22, ZL:23 };
const mine = { Y:'Y', X:'X', B:'B', A:'A', R_SR:'SR_R', R_SL:'SL_R', R:'R', ZR:'ZR', MINUS:'MINUS', PLUS:'PLUS', RJ:'RS', LJ:'LS', HOME:'HOME', CAPTURE:'CAPTURE', C:'C', DOWN:'DOWN', UP:'UP', RIGHT:'RIGHT', LEFT:'LEFT', L_SR:'SR_L', L_SL:'SL_L', L:'L', ZL:'ZL' };
for (const [k, bit] of Object.entries(SW2)) assert.equal(jc.BTN[mine[k]], 1 << bit, k);
assert.ok(jcmRight(raw(jc.BTN.Y)) & 0x000100, 'Y');
assert.ok(jcmRight(raw(jc.BTN.R)) & 0x004000, 'R');
assert.ok(jcmRight(raw(jc.BTN.ZR)) & 0x008000, 'ZR');
assert.ok(jcmRight(raw(jc.BTN.PLUS)) & 0x000002, 'PLUS');
assert.ok(jcmRight(raw(jc.BTN.RS)) & 0x000004, 'R3');
assert.ok(jcmRight(raw(jc.BTN.HOME)) & 0x000010, 'HOME');
assert.ok(jcmLeft(raw(jc.BTN.DOWN)) & 0x000001, 'DOWN');
assert.ok(jcmLeft(raw(jc.BTN.UP)) & 0x000002, 'UP');
assert.ok(jcmLeft(raw(jc.BTN.RIGHT)) & 0x000004, 'RIGHT');
assert.ok(jcmLeft(raw(jc.BTN.LEFT)) & 0x000008, 'LEFT');
assert.ok(jcmLeft(raw(jc.BTN.L)) & 0x000040, 'L');
assert.ok(jcmLeft(raw(jc.BTN.ZL)) & 0x000080, 'ZL');
assert.ok(jcmLeft(raw(jc.BTN.MINUS)) & 0x000100, 'MINUS');
assert.ok(jcmLeft(raw(jc.BTN.LS)) & 0x000800, 'L3');
assert.ok(jcmLeft(raw(jc.BTN.CAPTURE)) & 0x002000, 'CAPTURE');

// mapping (position layout): Joy-Con B (bottom) -> Xbox A (index 0)
let m = jc.mapButtons(jc.BTN.B | jc.BTN.ZR | jc.BTN.UP);
assert.equal(m[0], 1); assert.equal(m[7], 1); assert.equal(m[12], 1);
assert.equal(m.reduce((a, b) => a + b), 3);
m = jc.mapButtons(jc.BTN.B, 'label'); assert.equal(m[1], 1);

// rumble packet == JoyCon2Mac C++ algorithm
function cpp(a8, counter) {
  const p = new Uint8Array(42); if (!a8) return p;
  const amp = 64 + Math.floor((a8 * 704 + 127) / 255);
  const packed = (BigInt(amp) << 30n) | (512n << 20n) | (BigInt(amp) << 10n) | 512n;
  for (const s of [1, 17]) { p[s] = 0x50 | (counter & 15); for (let i = 0; i < 5; i++) p[s + 1 + i] = Number((packed >> BigInt(8 * i)) & 0xffn); }
  return p;
}
assert.deepEqual(jc.rumblePacket(1, 3), cpp(255, 3)); // 100% strength == JoyCon2Mac output
assert.deepEqual(jc.rumblePacket(0, 3), cpp(0, 3));
assert.equal(jc.parseReport(new DataView(new ArrayBuffer(4))), null);
console.log('decoder tests OK');

// rumble: perceptual curve, strength ceiling, side split
assert.equal(jc.rumbleAmplitude10(0), 0);
assert.ok(jc.rumbleAmplitude10(0.1) > 64 + 0.1 * 704, 'light effects are boosted');
assert.equal(jc.rumbleAmplitude10(1, 1), 768);
assert.equal(jc.rumbleAmplitude10(1, 1.5), 1023);
assert.deepEqual(jc.splitRumble(1, 0), { L: 1, R: 0.6 });
assert.deepEqual(jc.splitRumble(0, 1), { L: 0.6, R: 1 });
console.log('rumble tests OK');
