import { chromium } from 'playwright';

/* One harness, five properties, asserted together.

   Every separate detector written for this project was blind to the next
   bug, which is why they are combined here:
     - a distance-based pop detector cannot see a mirrored position
     - material.opacity reports a work visible when fog has erased it,
       because fog fades COLOUR, not alpha
     - containsPoint misses a large near work because it tests centres
     - reading position and opacity from two differently-filtered calls
       compares one plane against another */

const FOG_NEAR = 40, FOG_FAR = 70;
const seenOf = (dist, opacity) =>
  opacity * Math.max(0, Math.min(1, (FOG_FAR - dist) / (FOG_FAR - FOG_NEAR)));

const URL = process.argv[2] || 'http://localhost:3002/';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message.slice(0, 180)));

await page.goto(URL, { waitUntil: 'load' });
await page.waitForTimeout(28000);
console.log('loaded:', await page.textContent('#status-text'), '\n');

await page.evaluate(({ FOG_NEAR, FOG_FAR }) => {
  window.__H = { bands: {}, minSeen: 1e9, births: [], jumps: {}, dupes: 0, t0: performance.now() };
  const prev = new Map();
  const seenOf = (d, o) => o * Math.max(0, Math.min(1, (FOG_FAR - d) / (FOG_FAR - FOG_NEAR)));

  // ONE source per sample, so position and appearance describe the same plane.
  window.__hw = setInterval(() => {
    const c = window.__atlas.camera;
    const pos = window.__atlas.tilePos();

    let vis = 0;
    const onScreenIds = [];
    for (const t of pos) {
      const d = Math.hypot(t.x - c.x, t.y - c.y, t.z - c.z);
      if (t.live && t.onScreen && seenOf(d, t.opacity) > 0.15) { vis++; onScreenIds.push(t.id); }
    }
    window.__H.minSeen = Math.min(window.__H.minSeen, vis);

    // Same work visible twice at once is what "don't repeat the vase" means.
    const seen = new Set();
    for (const id of onScreenIds) {
      if (seen.has(id)) { window.__H.dupes++; break; }
      seen.add(id);
    }

    for (const t of pos) {
      const dz = Math.abs(t.z - c.z), dx = Math.abs(t.x - c.x);
      if (t.live) {
        const k = Math.floor(dz / 10) * 10;
        (window.__H.bands[k] ||= { sum: 0, n: 0 });
        window.__H.bands[k].sum += dx;
        window.__H.bands[k].n++;
      }
      const w = prev.get(t.i);
      if (w) {
        const moved = Math.hypot(t.x - w.x, t.y - w.y, t.z - w.z);
        if (moved > 5) {
          window.__H.jumps[t.i] = (window.__H.jumps[t.i] || 0) + 1;
          // Real opacity, not 1: planes fade in from zero, and assuming
          // full opacity calls a dissolve a pop.
          const dist = Math.hypot(dx, t.y - c.y, dz);
          window.__H.births.push(t.onScreen ? +seenOf(dist, t.opacity).toFixed(3) : 0);
        }
      }
      prev.set(t.i, { x: t.x, y: t.y, z: t.z });
    }
  }, 30);
}, { FOG_NEAR, FOG_FAR });

const reset = () => page.evaluate(() => Object.assign(window.__H,
  { bands: {}, minSeen: 1e9, births: [], jumps: {}, dupes: 0, t0: performance.now() }));

async function wheelFor(dir, n) {
  await page.mouse.move(700, 400);
  for (let i = 0; i < n; i++) { await page.mouse.wheel(0, dir * 400); await page.waitForTimeout(60); }
  await page.waitForTimeout(2000);
}

async function panFor(strokes) {
  for (let s = 0; s < strokes; s++) {
    await page.mouse.move(1100, 430);
    await page.mouse.down();
    for (let i = 0; i < 6; i++) { await page.mouse.move(1100 - i * 90, 430); await page.waitForTimeout(30); }
    await page.mouse.up();
    await page.waitForTimeout(900);
  }
  await page.waitForTimeout(2000);
}

let failures = 0;
async function report(label) {
  const H = await page.evaluate(() => ({ ...window.__H, elapsed: (performance.now() - window.__H.t0) / 1000 }));
  console.log(`-- ${label} --`);

  // Refuse to pass on no data: an early version reported ALL PASS against
  // a page whose script had a syntax error and never ran.
  if (!Object.keys(H.bands).length || H.minSeen === 1e9) {
    failures++;
    console.log('   x NO DATA COLLECTED - page is not running; checks void\n');
    await reset();
    return;
  }

  const keys = Object.keys(H.bands).map(Number).sort((a, b) => a - b);
  const mean = (k) => H.bands[k] ? H.bands[k].sum / H.bands[k].n : null;
  const near = mean(0), far = keys.filter((k) => k >= 30).map(mean).filter(Boolean);
  const farAvg = far.length ? far.reduce((a, b) => a + b, 0) / far.length : null;
  if (near != null && farAvg) {
    const ratio = near / farAvg, ok = ratio > 0.40;
    if (!ok) failures++;
    console.log(`   no pile:    near/far spread ${ratio.toFixed(2)} ${ok ? 'OK' : 'x COLLAPSING'}`);
  }

  const okVis = H.minSeen > 8;
  if (!okVis) failures++;
  console.log(`   not empty:  fewest on screen ${H.minSeen} ${okVis ? 'OK' : 'x EMPTY'}`);

  const worst = H.births.length ? Math.max(...H.births) : 0;
  const okPop = worst < 0.15;
  if (!okPop) failures++;
  console.log(`   no pop:     worst visibility at birth ${worst.toFixed(2)} (${H.births.length} births) ${okPop ? 'OK' : 'x POPPING'}`);

  const counts = Object.values(H.jumps);
  const rate = counts.length ? Math.max(...counts) / Math.max(1, H.elapsed) : 0;
  const okFl = rate < 2;
  if (!okFl) failures++;
  console.log(`   no flicker: busiest ${rate.toFixed(2)}/s ${okFl ? 'OK' : 'x THRASHING'}`);

  const dupePct = H.dupes / Math.max(1, H.elapsed * 33) * 100;
  const okDupe = dupePct < 25;
  if (!okDupe) failures++;
  console.log(`   no dupes:   frames with a repeated work ${dupePct.toFixed(0)}% ${okDupe ? 'OK' : 'x REPEATING'}\n`);
  await reset();
}

await reset();
await wheelFor(-1, 110); await report('FORWARD');
await page.screenshot({ path: 'health-forward.png' });

await reset();
await wheelFor(1, 110); await report('BACKWARD');
await page.screenshot({ path: 'health-backward.png' });

await reset();
await panFor(5); await report('PANNING');
await page.screenshot({ path: 'health-panning.png' });

console.log(failures === 0 ? 'ALL CHECKS PASS' : `${failures} CHECK(S) FAILED`);
console.log('errors:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
