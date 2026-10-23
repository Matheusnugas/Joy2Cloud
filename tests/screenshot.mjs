// Renders docs/screenshot-*.png from a simulated session. Not part of npm test.
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const EXT = fileURLToPath(new URL('../extension', import.meta.url));
const OUT = fileURLToPath(new URL('../docs/', import.meta.url));
const [scheme = 'light', lang = 'en', width = '1100'] = process.argv.slice(2);

const ctx = await chromium.launchPersistentContext('', {
  headless: true, channel: 'chromium', colorScheme: scheme, deviceScaleFactor: 2,
  viewport: { width: +width, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
const hub = await ctx.newPage();
await hub.goto(`chrome-extension://${new URL(sw.url()).host}/hub.html`);
await hub.waitForFunction(() => !!globalThis.joy2cloudDebug);
await hub.selectOption('#lang', lang);
await hub.evaluate(() => {
  const { newSlot, assignSlot, onInput, render } = joy2cloudDebug;
  const pkt = (buttons, left, right, mv) => {
    const u = new Uint8Array(0x3f); const dv = new DataView(u.buffer);
    dv.setUint32(4, buttons, true);
    const put = (o, [x, y]) => { u[o] = x & 255; u[o + 1] = ((x >> 8) & 15) | ((y & 15) << 4); u[o + 2] = (y >> 4) & 255; };
    put(0x0a, left); put(0x0d, right); dv.setUint16(0x1f, mv, true); return dv;
  };
  const L = newSlot({ id: 'L', gatt: { disconnect() {} } }); L.connected = true; assignSlot(L, 'L');
  const R = newSlot({ id: 'R', gatt: { disconnect() {} } }); R.connected = true; assignSlot(R, 'R');
  for (let i = 0; i < 40; i++) { onInput(L, pkt(0, [2048, 2048], [0, 0], 4050)); onInput(R, pkt(0, [0, 0], [2048, 2048], 3980)); }
  globalThis.__shot = { L, R, pkt, onInput, render };
});
// sweep the left stick along an arc to leave a trail; press a few buttons
for (let i = 0; i <= 16; i++) {
  await hub.evaluate((i) => {
    const { L, R, pkt, onInput } = __shot;
    const a = Math.PI * (0.15 + i * 0.03);
    onInput(L, pkt((1 << 23) | (1 << 17), [Math.round(2048 + Math.cos(a) * 1300), Math.round(2048 + Math.sin(a) * 1300)], [0, 0], 4050));
    onInput(R, pkt((1 << 2), [0, 0], [2048 + 500, 2048 - 200], 3980));
  }, i);
  await hub.waitForTimeout(16);
}
await hub.evaluate(() => __shot.render());
await hub.waitForTimeout(100);
await hub.screenshot({ path: `${OUT}screenshot-${scheme}-${lang}.png`, fullPage: true });
await ctx.close();
