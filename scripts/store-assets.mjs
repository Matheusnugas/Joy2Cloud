// Renders Chrome Web Store images into store/:
//   screenshot-1..3.jpg (1280x800), promo-small.png (440x280), promo-marquee.png (1400x560),
//   store-icon-128.png (128x128, 96x96 artwork with transparent padding)
// Run: npm run store-assets
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync } from 'node:fs';

const EXT = fileURLToPath(new URL('../extension', import.meta.url));
const OUT = fileURLToPath(new URL('../store/', import.meta.url));
// Promo pages are set from a string, so fonts and the icon are inlined.
const dataUri = (file, type) => `data:${type};base64,${readFileSync(EXT + file).toString('base64')}`;
const FONT_LS = dataUri('/fonts/league-spartan-latin-wght-normal.woff2', 'font/woff2');
const FONT_BC = dataUri('/fonts/barlow-condensed-latin-700-normal.woff2', 'font/woff2');
const FONT_LF = dataUri('/fonts/libre-franklin-latin-wght-normal.woff2', 'font/woff2');
const ICON = dataUri('/icons/icon.svg', 'image/svg+xml');
mkdirSync(OUT, { recursive: true });

const ctx = await chromium.launchPersistentContext('', {
  headless: true, channel: 'chromium', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--allow-file-access-from-files'],
});
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
const hubUrl = `chrome-extension://${new URL(sw.url()).host}/hub.html`;

// A simulated session: both Joy-Con connected, some buttons held, sticks moving.
async function openHub(theme) {
  const hub = await ctx.newPage();
  await hub.goto(hubUrl);
  await hub.waitForFunction(() => !!globalThis.joy2cloudDebug);
  await hub.evaluate((t) => chrome.storage.local.set({ theme: t, lang: 'en' }), theme);
  await hub.reload();
  await hub.waitForFunction(() => !!globalThis.joy2cloudDebug);
  await hub.evaluate(() => {
    const { newSlot, assignSlot, onInput } = joy2cloudDebug;
    const pkt = (buttons, left, right, mv) => {
      const u = new Uint8Array(0x3f); const dv = new DataView(u.buffer);
      dv.setUint32(4, buttons, true);
      const put = (o, [x, y]) => { u[o] = x & 255; u[o + 1] = ((x >> 8) & 15) | ((y & 15) << 4); u[o + 2] = (y >> 4) & 255; };
      put(0x0a, left); put(0x0d, right); dv.setUint16(0x1f, mv, true); return dv;
    };
    const L = newSlot({ id: 'L', gatt: { disconnect() {} } }); L.connected = true; assignSlot(L, 'L');
    const R = newSlot({ id: 'R', gatt: { disconnect() {} } }); R.connected = true; assignSlot(R, 'R');
    for (let i = 0; i < 40; i++) { onInput(L, pkt(0, [2048, 2048], [0, 0], 4050)); onInput(R, pkt(0, [0, 0], [2048, 2048], 3980)); }
    globalThis.__s = { L, R, pkt, onInput };
  });
  return hub;
}

async function sweep(hub, leftBits, rightBits, rightStick) {
  for (let i = 0; i <= 16; i++) {
    await hub.evaluate(([i, lb, rb, rs]) => {
      const { L, R, pkt, onInput } = __s;
      const a = Math.PI * (0.15 + i * 0.03);
      onInput(L, pkt(lb, [Math.round(2048 + Math.cos(a) * 1300), Math.round(2048 + Math.sin(a) * 1300)], [0, 0], 4050));
      onInput(R, pkt(rb, [0, 0], rs, 3980));
    }, [i, leftBits, rightBits, rightStick]);
    await hub.waitForTimeout(16);
  }
  await hub.evaluate(() => joy2cloudDebug.render());
  await hub.waitForTimeout(120);
}

const shot = (page, name) => page.screenshot({ path: OUT + name, type: 'jpeg', quality: 92 });

// 1. Both Joy-Con live (dark)
let hub = await openHub('dark');
await sweep(hub, (1 << 23) | (1 << 17), 1 << 2, [2048 + 500, 2048 - 200]);
await shot(hub, 'screenshot-1.jpg');

// 2. Guided stick calibration in progress (dark)
await hub.click('#recenter');
await hub.mouse.move(1270, 790); // no hover effect in the picture
await hub.evaluate(() => {
  const { L, R, pkt, onInput } = __s;
  for (let i = 0; i < 40; i++) { onInput(L, pkt(0, [2048, 2048], [0, 0], 4050)); onInput(R, pkt(0, [0, 0], [2048, 2048], 3980)); }
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const p = [Math.round(2048 + Math.cos(a) * 1400), Math.round(2048 + Math.sin(a) * 1400)];
    if (i < 44) onInput(L, pkt(0, p, [0, 0], 4050));
    if (i < 26) onInput(R, pkt(0, [0, 0], p, 3980));
    if (i === 30) R.trail = [];
  }
  L.trail = []; R.trail = [];
  joy2cloudDebug.render();
});
await hub.waitForTimeout(150);
await shot(hub, 'screenshot-2.jpg');
await hub.close();

// 3. Light theme
hub = await openHub('light');
await sweep(hub, 1 << 22, (1 << 7) | (1 << 1), [2048 - 300, 2048 + 600]);
await shot(hub, 'screenshot-3.jpg');

// Promo images: plain HTML in the extension's own type and palette.
const promo = (w, h, big) => `<!doctype html><html><head><style>
@font-face{font-family:LS;src:url(${FONT_LS});font-weight:100 900}
@font-face{font-family:BC;src:url(${FONT_BC});font-weight:700}
@font-face{font-family:LF;src:url(${FONT_LF});font-weight:100 900}
*{box-sizing:border-box}html,body{margin:0;width:${w}px;height:${h}px;background:#0b0b0c;overflow:hidden}
.wrap{position:relative;width:100%;height:100%;display:flex;align-items:center;gap:${big ? 56 : 22}px;padding:0 ${big ? 96 : 30}px}
img{width:${big ? 200 : 96}px;height:${big ? 200 : 96}px;flex:none}
h1{margin:0;color:#ece9e3;font:800 ${big ? 120 : 52}px/.85 LS;letter-spacing:-.035em;text-transform:uppercase}
p{margin:${big ? 22 : 10}px 0 0;color:#ff2e2e;font:700 ${big ? 30 : 15}px/1.15 BC;letter-spacing:.12em;text-transform:uppercase}
.sub{margin-top:${big ? 14 : 6}px;color:#c9c6bf;font:400 ${big ? 26 : 13}px/1.35 LF;letter-spacing:0;text-transform:none}
.bar{position:absolute;left:${big ? 96 : 30}px;right:${big ? 96 : 30}px;bottom:${big ? 56 : 24}px;height:${big ? 18 : 10}px;border:1px solid #ece9e3;padding:2px}
.fill{height:100%;width:72%;background:repeating-linear-gradient(90deg,#e3242b 0 ${big ? 12 : 7}px,transparent ${big ? 12 : 7}px ${big ? 16 : 10}px)}
</style></head><body><div class="wrap"><img src="${ICON}" alt=""><div>
<h1>Joy2Cloud</h1><p>Joy-Con 2 for cloud gaming</p>${big ? '<p class="sub">Connect over Bluetooth, play as an Xbox controller. No drivers.</p>' : ''}
</div><div class="bar"><div class="fill"></div></div></div></body></html>`;

for (const [name, w, h, big] of [['promo-small.png', 440, 280, false], ['promo-marquee.png', 1400, 560, true]]) {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: w, height: h });
  await p.setContent(promo(w, h, big), { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: OUT + name, omitBackground: false });
  await p.close();
}

// Store icon: 96x96 artwork centred on a transparent 128x128 canvas (store guideline).
{
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 128, height: 128 });
  const svg = readFileSync(EXT + '/icons/icon.svg', 'utf8').replace('<svg ', '<svg width="96" height="96" ');
  await p.setContent(`<html><body style="margin:0;background:transparent"><div style="padding:16px;width:96px;height:96px">${svg}</div></body></html>`);
  await p.screenshot({ path: OUT + 'store-icon-128.png', omitBackground: true, clip: { x: 0, y: 0, width: 128, height: 128 } });
  await p.close();
}

await ctx.close();
console.log('store assets written to', OUT);
