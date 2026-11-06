// Renders the app icons (PNG) from public/icon.svg. Run once after changing the logo:
//   node scripts/make-icons.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const svg = fs.readFileSync(path.join(__dirname, '..', 'public', 'icon.svg'), 'utf8');
const out = (n) => path.join(__dirname, '..', 'public', n);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const shot = async (size, pad, bg, file) => {
    await p.setViewportSize({ width: size, height: size });
    const inner = Math.round(size * (1 - 2 * pad));
    await p.setContent(`<html><body style="margin:0;background:${bg};display:grid;place-items:center;width:${size}px;height:${size}px">
      <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg', `<svg width="${inner}" height="${inner}"`)}</div></body></html>`);
    await p.screenshot({ path: out(file), omitBackground: bg === 'transparent' });
  };
  await shot(192, 0.04, '#16191C', 'pwa-192.png');
  await shot(512, 0.04, '#16191C', 'pwa-512.png');
  await shot(512, 0.16, '#16191C', 'pwa-maskable-512.png'); // safe zone for round / squircle masks
  await shot(180, 0.08, '#16191C', 'apple-touch-icon.png');
  await b.close();
  console.log('icons written');
})();
