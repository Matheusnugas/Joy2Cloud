import assert from 'node:assert/strict';
import * as jc from '../extension/joycon.js';

// doc examples decode to sensible values
const p = jc.decodeStickCalibration(Uint8Array.from([0xB3,0x67,0x83,0x2E,0x66,0x5E,0x3A,0x06,0x5F]));
const s = jc.decodeStickCalibration(Uint8Array.from([0x2C,0x08,0x84,0xD1,0x65,0x63,0x2A,0x26,0x62]));
console.log('primary', p, '\nsecondary', s);
assert.ok(p && s);
assert.equal(jc.decodeStickCalibration(new Uint8Array(9).fill(0xff)), null);

// flash read command / response
assert.deepEqual([...jc.readFlashCommand(0x130a8, 9)], [0x02,0x91,0x01,0x04,0x00,0x08,0,0, 9,0x7e,0,0, 0xa8,0x30,0x01,0x00]);
const resp = Uint8Array.from([0x02,0x01,0x01,0x04,0x10,0x78,0,0, 9,0,0,0, 0xa8,0x30,0x01,0, 0xB3,0x67,0x83,0x2E,0x66,0x5E,0x3A,0x06,0x5F]);
const pr = jc.parseFlashResponse(new DataView(resp.buffer));
assert.equal(pr.addr, 0x130a8); assert.deepEqual([...pr.data], [0xB3,0x67,0x83,0x2E,0x66,0x5E,0x3A,0x06,0x5F]);

// physical stick models: returns raw point at the gate edge for angle a
const CX = 1985, CY = 2090;
const circle = (R) => (a) => R;
const octagon = (R) => (a) => R / Math.cos(((a % (Math.PI / 4)) + Math.PI / 4) % (Math.PI / 4) - Math.PI / 8) * Math.cos(Math.PI / 8);
const raw = (gate, a, k = 1) => ({ x: Math.round(CX + Math.cos(a) * gate(a) * k), y: Math.round(CY + Math.sin(a) * gate(a) * k) });
const rest = (c) => { for (let i = 0; i < 40; i++) c.update({ x: CX, y: CY }); };
const sweep = (c, gate, k = 1, steps = 72) => {
  const out = [];
  for (let i = 0; i < steps; i++) { const a = (i / steps) * Math.PI * 2; const o = c.update(raw(gate, a, k)); out.push({ a, m: Math.hypot(o.x, o.y), o }); }
  return out;
};
const stats = (arr) => ({ min: Math.min(...arr.map((v) => v.m)).toFixed(3), max: Math.max(...arr.map((v) => v.m)).toFixed(3) });

// 1) factory data, circular gate: full push = 1 in every direction (incl. diagonals)
let c = new jc.StickCalibrator();
c.setFactory({ cx: CX, cy: CY, px: 1520, py: 1520, nx: 1520, ny: 1520 });
rest(c);
let r = sweep(c, circle(1500));
console.log('factory + circle, full push:', stats(r));
assert.ok(r.every((v) => v.m > 0.99), 'full in all directions');
r = sweep(c, circle(1500), 0.5);
console.log('factory + circle, half push:', stats(r));
assert.ok(r.every((v) => Math.abs(v.m - 0.48) < 0.06), 'half push ~ uniform');

// 2) octagonal gate WITHOUT guided calibration: auto-widening keeps full push at 1
c = new jc.StickCalibrator();
c.setFactory({ cx: CX, cy: CY, px: 1400, py: 1400, nx: 1400, ny: 1400 });
rest(c); sweep(c, octagon(1400)); r = sweep(c, octagon(1400));
console.log('factory + octagon, full push:', stats(r));
assert.ok(r.every((v) => v.m > 0.99));

// 3) guided calibration on an octagon, then half push should be uniform in every direction
c = new jc.StickCalibrator();
rest(c);
c.startCapture();
rest(c);
for (let t = 0; t < 3; t++) sweep(c, octagon(1450), 1, 90);
console.log('capture progress', c.captureProgress());
assert.equal(c.captureProgress(), 1);
const prof = c.finishCapture();
assert.ok(prof && prof.bins.length === 32);
r = sweep(c, octagon(1450), 0.6);
console.log('guided + octagon, 60% push:', stats(r));
assert.ok(r.every((v) => Math.abs(v.m - 0.58) < 0.06), 'uniform at 60%');
r = sweep(c, octagon(1450), 1);
assert.ok(r.every((v) => v.m > 0.99));

// 4) incomplete capture is rejected
c = new jc.StickCalibrator(); rest(c); c.startCapture(); rest(c);
for (let i = 0; i < 8; i++) c.update(raw(circle(1450), i * 0.05));
assert.equal(c.finishCapture(), null);

// 5) direction sanity: push up -> y negative; right -> x positive; deadzone at rest
c = new jc.StickCalibrator(); c.setFactory({ cx: CX, cy: CY, px: 1500, py: 1500, nx: 1500, ny: 1500 }); rest(c);
let o = c.update({ x: CX, y: CY + 1500 }); assert.ok(o.y < -0.99 && Math.abs(o.x) < 0.01);
o = c.update({ x: CX + 1500, y: CY }); assert.ok(o.x > 0.99);
o = c.update({ x: CX + 60, y: CY - 40 }); assert.deepEqual(o, { x: 0, y: 0 });

// 6) no factory data: center auto-detected, output before that is zero
c = new jc.StickCalibrator();
assert.deepEqual(c.update({ x: 2000, y: 2000 }), { x: 0, y: 0 });
rest(c); r = sweep(c, circle(1400)); r = sweep(c, circle(1400));
console.log('no factory, circle:', stats(r));
assert.ok(r.every((v) => v.m > 0.95));
console.log('calibration tests OK');
