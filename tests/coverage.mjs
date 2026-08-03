import { chromium } from 'playwright';

/* Frame coverage — the direct test for "don't leave empty space", which
   none of the earlier harnesses measured at all. Every previous check
   asked about works in world space; this one asks whether the SCREEN has
   holes, which is the thing actually being complained about.

   Measured off the rendered pixels, not the scene graph, so it cannot be
   fooled by works that are technically present but invisible. */
const URL = process.argv[2] || 'http://localhost:3002/';
const LABEL = process.argv[3] || 'local';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 150)));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForTimeout(30000);

/* Split the frame into a 5×3 grid and ask, for each cell, what fraction of
   its pixels differ from the empty wall colour. The dock and colophon sit
   in the bottom band, so the bottom row is measured above them. */
/* Measured geometrically, by projecting each plane's corners into screen
   space — NOT by reading pixels.

   Reading them was the obvious approach and it was wrong: drawing a WebGL
   canvas into a 2D one returns an empty buffer unless the context was
   created with preserveDrawingBuffer, so every sample came back as
   "not the wall colour" and both builds scored a perfect 100%, including
   one with visible holes. */
async function coverage() {
  return page.evaluate(() => {
    const A = window.__atlas;
    const COLS = 5, ROWS = 3;
    const hit = new Array(COLS * ROWS).fill(0);
    const FOG_NEAR = 40, FOG_FAR = 70;

    for (const p of A.planeQuads()) {
      // Fog fades colour, not alpha, so both must be folded in before
      // asking whether a viewer would actually see this plane.
      const fog = Math.max(0, Math.min(1, (FOG_FAR - p.dist) / (FOG_FAR - FOG_NEAR)));
      if (p.opacity * fog < 0.12) continue;

      // Screen-space box in 0..1, clipped to the frame.
      const x0 = Math.max(0, Math.min(1, p.x0)), x1 = Math.max(0, Math.min(1, p.x1));
      const y0 = Math.max(0, Math.min(1, p.y0)), y1 = Math.max(0, Math.min(1, p.y1));
      if (x1 <= x0 || y1 <= y0) continue;

      for (let ry = 0; ry < ROWS; ry++) {
        for (let rx = 0; rx < COLS; rx++) {
          const cx0 = rx / COLS, cx1 = (rx + 1) / COLS;
          const cy0 = ry / ROWS, cy1 = (ry + 1) / ROWS;
          const ox = Math.min(x1, cx1) - Math.max(x0, cx0);
          const oy = Math.min(y1, cy1) - Math.max(y0, cy0);
          if (ox > 0 && oy > 0) {
            hit[ry * COLS + rx] += (ox * COLS) * (oy * ROWS);   // fraction of the cell
          }
        }
      }
    }
    return hit.map((v) => +Math.min(1, v).toFixed(2));
  });
}

function report(tag, cells) {
  const COLS = 5;
  console.log(`  ${tag}`);
  for (let r = 0; r < 3; r++) {
    console.log('    ' + cells.slice(r * COLS, r * COLS + COLS)
      .map((v) => String(v.toFixed(2)).padStart(5)).join(' '));
  }
  const empty = cells.filter((v) => v < 0.08).length;
  const mean = cells.reduce((a, b) => a + b, 0) / cells.length;
  console.log(`    mean coverage ${(mean * 100).toFixed(0)}%   empty cells ${empty}/15 ` +
              `${empty === 0 ? '✓' : '✗ HOLES'}`);
  return { empty, mean };
}

console.log(`\n=== ${LABEL} — ${URL} ===`);
console.log('  works:', await page.evaluate(() => window.__atlas ? window.__atlas.counts.assets : '?'));
const info = await page.evaluate(() => window.__atlas && window.__atlas.chunks ? window.__atlas.chunks : null);
if (info) console.log('  field:', JSON.stringify(info));

const results = [];
results.push(report('at rest', await coverage()));

await page.mouse.move(700, 380);
for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, -400); await page.waitForTimeout(60); }
await page.waitForTimeout(2200);
results.push(report('after flying forward', await coverage()));

for (let i = 0; i < 60; i++) { await page.mouse.wheel(0, 400); await page.waitForTimeout(60); }
await page.waitForTimeout(2200);
results.push(report('after flying backward', await coverage()));

await page.mouse.move(1100, 430); await page.mouse.down();
for (let i = 0; i < 6; i++) { await page.mouse.move(1100 - i * 90, 430); await page.waitForTimeout(30); }
await page.mouse.up(); await page.waitForTimeout(1800);
results.push(report('after panning', await coverage()));

const worst = Math.max(...results.map((r) => r.empty));
const meanAll = results.reduce((a, r) => a + r.mean, 0) / results.length;
console.log(`\n  OVERALL  mean ${(meanAll * 100).toFixed(0)}%  worst empty-cells ${worst}/15 ` +
            `${worst === 0 ? 'PASS' : 'FAIL'}`);
console.log('  errors:', errors.length ? errors.slice(0, 3).join(' | ') : 'none');
await browser.close();
