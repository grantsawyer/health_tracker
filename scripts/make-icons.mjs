// Generates the app icon from one definition: public/icon.svg (favicon), public/apple-touch-icon.png,
// docs/social-preview.png (GitHub repo Settings → Social preview). Run: node scripts/make-icons.mjs
// The in-app mark (src/ui/BrandMark.tsx) uses the same SQUIRCLE / HEART values; keep them in sync.
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

/** Superellipse |x|^5 + |y|^5 = 1 (the usual app-icon squircle) on a 64 grid, full bleed. */
function squircle(size = 64, n = 5, steps = 96) {
  const r = size / 2, pts = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t);
    pts.push([r + r * Math.sign(c) * Math.abs(c) ** (2 / n), r + r * Math.sign(s) * Math.abs(s) ** (2 / n)]);
  }
  return "M" + pts.map(([x, y]) => `${+x.toFixed(2)} ${+y.toFixed(2)}`).join("L") + "Z";
}
export const SQUIRCLE = squircle();
// Same heart as Icon.heart (24 grid, bbox centre 12, 11.5), scaled ×2 and centred at (32, 32.5):
// half a unit below the middle, because the heart's weight sits in its lobes.
export const HEART = "M20.5 8.5c0 5-8.5 11-8.5 11S3.5 13.5 3.5 8.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 8.5 2.5Z";
const HEART_TRANSFORM = "translate(8 9.5) scale(2)";
const BG = "#46d6cb", INK = "#141518";

const icon = (bg = BG, ink = INK) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path fill="${bg}" d="${SQUIRCLE}"/>` +
  `<path fill="none" stroke="${ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ` +
  `transform="${HEART_TRANSFORM}" d="${HEART}"/></svg>`;

if (process.argv[2] === "--print") { console.log(SQUIRCLE); process.exit(0); }

writeFileSync("public/icon.svg", icon() + "\n");

const browser = await chromium.launch({ channel: "chrome" });
const shot = async (html, w, h, path) => {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(`<body style="margin:0">${html}</body>`);
  await page.screenshot({ path, omitBackground: true });
  await page.close();
};
// iOS masks touch icons itself, so this one is a full-bleed square.
await shot(`<div style="width:180px;height:180px;background:${BG};display:grid;place-items:center">` +
  `<svg viewBox="0 0 24 24" width="100" height="100" style="transform:translateY(2px)"><path fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="${HEART}"/></svg></div>`,
  180, 180, "public/apple-touch-icon.png");
await shot(`<div style="width:1280px;height:640px;background:#141518;display:flex;align-items:center;justify-content:center;gap:56px;font-family:Figtree,-apple-system,system-ui,sans-serif">` +
  `<div style="width:240px;height:240px">${icon().replace("<svg ", '<svg width="240" height="240" ')}</div>` +
  `<div style="color:#f1f3f5;font-size:84px;font-weight:700;letter-spacing:-0.02em">Health Tracker</div></div>`,
  1280, 640, "docs/social-preview.png");
await browser.close();
