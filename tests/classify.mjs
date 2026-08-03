import { readFileSync } from 'fs';

// Pull the two pure functions straight out of the app so the test can
// never drift from the shipped code.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const grab = (name) => {
  const i = html.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`${name} not found`);
  let depth = 0, j = html.indexOf('{', i);
  for (let k = j; k < html.length; k++) {
    if (html[k] === '{') depth++;
    else if (html[k] === '}') { depth--; if (depth === 0) return html.slice(i, k + 1); }
  }
};
const src = grab('extendedFingers') + '\n' + grab('classify') + '\n' + grab('twoHandHeart') +
            '\nexport { classify, extendedFingers, twoHandHeart };';
const mod = await import('data:text/javascript,' + encodeURIComponent(src));
const { classify, twoHandHeart } = mod;

/* Synthetic right hand, wrist at the bottom, fingers pointing up.
   `ext` is per-finger extension 0..1; 0 curls the tip back toward the palm. */
function hand({ thumb = 0, index = 0, middle = 0, ring = 0, pinky = 0 } = {}) {
  const W = { x: 0.50, y: 0.90 };
  const lm = new Array(21);
  lm[0] = { ...W };

  // Splay each finger slightly so they don't sit on one line.
  const cols = { thumb: -0.13, index: -0.05, middle: 0.0, ring: 0.05, pinky: 0.10 };
  // Knuckles sit at a real distance from the wrist — an earlier version put
  // the MCP *on* the wrist, which collapsed the hand-size reference the
  // classifier normalises by and made every threshold meaningless.
  const put = (base, name, ext, len) => {
    const dx = cols[name];
    const stops = ext > 0.5 ? [0.35, 0.62, 0.82, 1.00]   // extended
                            : [0.35, 0.62, 0.50, 0.38];  // curled: tip pulls back
    for (let seg = 0; seg < 4; seg++) {
      const a = stops[seg];
      lm[base + seg] = { x: W.x + dx * (0.5 + a * 0.5), y: W.y - a * len };
    }
  };
  put(1, 'thumb', thumb, 0.30);
  put(5, 'index', index, 0.42);
  put(9, 'middle', middle, 0.45);
  put(13, 'ring', ring, 0.42);
  put(17, 'pinky', pinky, 0.36);

  return lm;
}

/* One-hand poses only — the heart is two-handed by design, because a
   single-hand finger heart cannot be told apart from a fist. */
const cases = [
  ['fist',  hand({})],
  ['point', hand({ index: 1 })],
  ['peace', hand({ index: 1, middle: 1 })],
  ['palm',  hand({ thumb: 1, index: 1, middle: 1, ring: 1, pinky: 1 })],
];

console.log('classify() against synthetic landmarks:\n');
let pass = 0;
for (const [want, lm] of cases) {
  const got = classify(lm);
  const ok = got === want;
  if (ok) pass++;
  console.log(`  ${want.padEnd(6)} -> ${got.padEnd(6)} ${ok ? '✓' : '✗'}`);
}

// classify() must never emit 'heart' at all now — that verdict belongs
// exclusively to the two-hand test.
const anyHeart = cases.some(([, lm]) => classify(lm) === 'heart');
console.log(`\n  classify() never returns 'heart': ${anyHeart ? '✗' : '✓'}`);

// Scale invariance: same poses, hand twice as far away.
const shrink = (lm) => lm.map((p) => ({ x: 0.5 + (p.x - 0.5) * 0.45, y: 0.9 + (p.y - 0.9) * 0.45 }));
console.log('\n  at half size (hand further from lens):');
for (const [want, lm] of cases) {
  const got = classify(shrink(lm));
  console.log(`    ${want.padEnd(6)} -> ${got.padEnd(6)} ${got === want ? '✓' : '✗'}`);
}

console.log(`\n${pass}/${cases.length} base cases pass`);

/* ── two-hand heart ────────────────────────────────────────────────────
   Two mirrored hands: thumbs meeting low (the point), index tips meeting
   high (over the top), everything else curled. */
function heartPair({ thumbGap = 0.02, indexGap = 0.02, span = 0.16, flip = false } = {}) {
  const mk = (side) => {
    const lm = hand({});                          // curled base pose
    const s = side;                               // -1 left hand, +1 right
    // Wrists out to the sides and low.
    lm[0] = { x: 0.5 + s * 0.18, y: 0.86 };
    lm[9] = { x: 0.5 + s * 0.14, y: 0.74 };       // middle knuckle → hand scale
    const pointY = flip ? 0.60 : 0.76;            // thumbs (heart's point)
    const topY   = flip ? 0.76 : 0.60;            // index tips (over the top)
    lm[4] = { x: 0.5 + s * thumbGap / 2, y: pointY };
    lm[8] = { x: 0.5 + s * indexGap / 2, y: topY };
    return lm;
  };
  const a = mk(-1), b = mk(+1);
  // Push the contacts apart to hit the requested span.
  const shift = (span - 0.16) / 2;
  a[8].y -= shift; b[8].y -= shift;
  a[4].y += shift; b[4].y += shift;
  return [a, b];
}

console.log('\ntwoHandHeart():\n');
const twoCases = [
  ['proper heart',              heartPair(),                            true],
  ['hands pressed flat',        heartPair({ span: 0.03 }),              false],
  ['thumbs far apart',          heartPair({ thumbGap: 0.60 }),          false],
  ['index tips far apart',      heartPair({ indexGap: 0.80 }),          false],
  ['upside down (point up)',    heartPair({ flip: true }),              false],
];
let tPass = 0;
for (const [label, [a, b], want] of twoCases) {
  const got = twoHandHeart(a, b);
  const ok = got === want;
  if (ok) tPass++;
  console.log(`  ${label.padEnd(24)} -> ${String(got).padEnd(5)} ${ok ? '✓' : `✗ wanted ${want}`}`);
}

// Two ordinary hands must never read as a heart — both stacked (degenerate)
// and genuinely side by side.
const shift = (lm, dx) => lm.map((p) => ({ x: p.x + dx, y: p.y }));
const plain = (o) => hand(o);
const open = { thumb: 1, index: 1, middle: 1, ring: 1, pinky: 1 };

const negatives = [
  ['two fists, stacked',   [plain({}), plain({})]],
  ['two fists, apart',     [shift(plain({}), -0.16), shift(plain({}), 0.16)]],
  ['two open palms',       [shift(plain(open), -0.16), shift(plain(open), 0.16)]],
  ['peace + peace',        [shift(plain({ index:1, middle:1 }), -0.16),
                            shift(plain({ index:1, middle:1 }), 0.16)]],
];
let nPass = 0;
for (const [label, [a, b]] of negatives) {
  const got = twoHandHeart(a, b);
  if (!got) nPass++;
  console.log(`  ${label.padEnd(24)} -> ${String(got).padEnd(5)} ${!got ? '✓' : '✗ false positive'}`);
}

console.log(`\n${tPass}/${twoCases.length} shape cases, ${nPass}/${negatives.length} negatives pass`);
