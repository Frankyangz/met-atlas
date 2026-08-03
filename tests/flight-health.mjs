import { chromium } from 'playwright';

/* One harness, four properties, asserted together.

   Each detector I wrote previously was blind to the next bug:
     Â· the distance-based pop detector could not see a mirror (distance is
       preserved by mirroring)
     Â· the flicker detector could not see the pile (those were legitimate
       re-placements, not thrash)
     Â· the "visible" counter read material.opacity, but FOG FADES COLOUR,
       NOT ALPHA â€” it reported 48 visible works on a blank screen.
   Checking them in one pass is what stops fixing one from breaking another. */

const FOG_NEAR = 40, FOG_FAR = 70;
const seenOf = (dist, opacity) =>
  opacity * Math.max(0, Math.min(1, (FOG_FAR - dist) / (FOG_FAR - FOG_NEAR)));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message.slice(0, 180)));

await page.goto('http://localhost:3002/', { waitUntil: 'load' });
await page.waitForTimeout(26000);
console.log('loaded:', await page.textContent('#status-text'), '\n');

await page.evaluate(({ FOG_NEAR, FOG_FAR }) => {
  window.__H = { bands: {}, minSeen: 1e9, births: [], jumps: {}, t0: performance.now() };
  const prev = new Map();
  const seenOf = (d, o) => o * Math.max(0, Math.min(1, (FOG_FAR - d) / (FOG_FAR - FOG_NEAR)));

  window.__hw = setInterval(() => {
    const c = window.__atlas.camera;
    const pos = window.__atlas.tilePos();
    const op = window.__atlas.tileOpacity();

    // visible-count low-water mark: fog-aware AND frustum-aware. A work
    // behind the camera is unseeable regardless of opacity or fog depth â€”
    // ignoring that reported "popping" for works placed out of sight.
    let vis = 0;
    for (const t of op) if (t.onScreen && seenOf(t.dist, t.opacity) > 0.15) vis++;
    window.__H.minSeen = Math.min(window.__H.minSeen, vis);
    window.__H.onScreenNow = vis;

    for (let i = 0; i < pos.length; i++) {
      const t = pos[i];
      const dz = Math.abs(t.z - c.z), dx = Math.abs(t.x - c.x);
      const k = Math.floor(dz / 10) * 10;
      (window.__H.bands[k] ||= { sum: 0, n: 0 });
      window.__H.bands[k].sum += dx;
      window.__H.bands[k].n++;

      const w = prev.get(t.i);
      if (w) {
        const moved = Math.hypot(t.x - w.x, t.y - w.y, t.z - w.z);
        if (moved > 5) {
          window.__H.jumps[t.i] = (window.__H.jumps[t.i] || 0) + 1;
          // Only counts as a pop if it landed inside the actual frustum.
          const o = op[i];
          const dist = Math.hypot(dx, t.y - c.y, dz);
          window.__H.births.push((o && o.onScreen) ? +seenOf(dist, 1).toFixed(3) : 0);
        }
      }
      prev.set(t.i, { x: t.x, y: t.y, z: t.z });
    }
  }, 30);
}, { FOG_NEAR, FOG_FAR });

const reset = () => page.evaluate(() =>
  Object.assign(window.__H, { bands: {}, minSeen: 1e9, births: [], jumps: {}, t0: performance.now() }));

async function wheelFor(dir, n) {
  await page.mouse.move(700, 400);
  for (let i = 0; i < n; i++) { await page.mouse.wheel(0, dir * 400); await page.waitForTimeout(60); }
  await page.waitForTimeout(2000);
}

/* A steady drag in one direction, at a speed a hand can actually produce:
   repeated ~90px strokes. The earlier version alternated Â±320px every
   100ms, which is a violent shake no user performs and which flings the
   camera laterally faster than any field could refill. */
async function panFor(strokes, settle = 900) {
  for (let s = 0; s < strokes; s++) {
    await page.mouse.move(1100, 430);
    await page.mouse.down();
    for (let i = 0; i < 6; i++) { await page.mouse.move(1100 - i * 90, 430); await page.waitForTimeout(30); }
    await page.mouse.up();
    await page.waitForTimeout(settle);        // people look between strokes
  }
  await page.waitForTimeout(2000);
}

let failures = 0;
async function report(label) {
  const H = await page.evaluate(() => ({ ...window.__H, elapsed: (performance.now() - window.__H.t0) / 1000 }));
  console.log(`â”€â”€ ${label} â”€â”€`);

  /* Refuse to pass on no data. The first run of this harness reported
     "ALL CHECKS PASS" against a page whose script had a syntax error and
     never executed: every counter sat at its initial value and every
     comparison trivially succeeded. A harness that passes when it measured
     nothing is worse than no harness. */
  if (!Object.keys(H.bands).length || H.minSeen === 1e9) {
    failures++;
    console.log('   âœ— NO DATA COLLECTED â€” page is not running; all checks void\n');
    await reset();
    return;
  }

  // 1. no pile: near bands must not collapse relative to far bands
  const keys = Object.keys(H.bands).map(Number).sort((a, b) => a - b);
  const mean = (k) => H.bands[k] ? H.bands[k].sum / H.bands[k].n : null;
  const near = mean(0), far = keys.filter((k) => k >= 30).map(mean).filter(Boolean);
  const farAvg = far.length ? far.reduce((a, b) => a + b, 0) / far.length : null;
  console.log('   spread by depth: ' + keys.map((k) => `${k}u:${mean(k).toFixed(1)}`).join('  '));
  if (near != null && farAvg) {
    const ratio = near / farAvg;
    const ok = ratio > 0.40;
    if (!ok) failures++;
    console.log(`   no pile:    near/far spread ratio ${ratio.toFixed(2)} ${ok ? 'âœ“' : 'âœ— COLLAPSING'}`);
  }

  // 2. never empty
  const okVis = H.minSeen > 8;
  if (!okVis) failures++;
  console.log(`   not empty:  fewest works on screen ${H.minSeen} ${okVis ? 'âœ“' : 'âœ— EMPTY'}`);

  // 3. no pop at birth
  const worst = H.births.length ? Math.max(...H.births) : 0;
  const okPop = worst < 0.15;
  if (!okPop) failures++;
  console.log(`   no pop:     worst visibility at birth ${worst.toFixed(2)} (${H.births.length} births) ${okPop ? 'âœ“' : 'âœ— POPPING'}`);

  // 4. no flicker
  const counts = Object.values(H.jumps);
  const rate = counts.length ? Math.max(...counts) / Math.max(1, H.elapsed) : 0;
  const okFl = rate < 2;
  if (!okFl) failures++;
  console.log(`   no flicker: busiest tile ${rate.toFixed(2)} re-placements/s ${okFl ? 'âœ“' : 'âœ— THRASHING'}\n`);
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


