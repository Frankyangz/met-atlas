# Met Atlas

An infinite 3D canvas for The Metropolitan Museum of Art's open collection.
Fly through a field of public-domain works, click one to travel to it, filter
and cluster by what the records actually contain — drop in your own photos to
explore them the same way — and, if you like, steer it with your hands.

**One HTML file. No framework, no build step, no dependencies to install.**

### → [met-atlas.vercel.app](https://met-atlas.vercel.app)

![Met Atlas](docs/preview.png)

> The Met rate-limits aggressively. If the canvas is slow to fill on a first
> visit, that is the museum's WAF, not the app — see below for how it is
> handled. A reload usually clears it.

---

## Why this was harder than it looks

The visuals are the easy part. Almost all of the work went into three
constraints that only appear once you actually build against the API.

### 1. The image host answers `OPTIONS` with CORS and `GET` without it

WebGL refuses to texture from an image that isn't CORS-clean, and this project
additionally reads pixels back to derive a colour palette the Met doesn't
provide. So `images.metmuseum.org` has to be CORS-clean.

It looks like it is:

```
OPTIONS https://images.metmuseum.org/...   →  Access-Control-Allow-Origin: *
GET     https://images.metmuseum.org/...   →  (no such header)
```

That header is a red herring. Images are *simple requests* — browsers never
preflight them — so the `OPTIONS` response never applies. Every image is
routed through an image proxy that re-serves it CORS-clean, which is also what
makes client-side colour extraction possible at all.

### 2. The API is N+1, behind a WAF that fails invisibly

`/search` and `/objects` return bare `objectID`s. Every single image costs one
further request. The collection also sits behind an Imperva WAF that starts
refusing well below the documented "80 requests per second".

The refusal is the interesting part. Sometimes it's a `403` carrying an HTML
challenge page. More often it returns a response with the CORS header simply
**absent**, which the browser blocks before any JavaScript can read a status —
`fetch` just rejects, indistinguishable from the network dropping.

So the client:

- asks for far less (measured 92% usable yield, so oversampling 1.6× was waste — now 1.25×)
- paces requests in small batches with jittered backoff
- treats *a run of consecutive rejections* as the signal, since no single one is legible
- caches normalised records in `localStorage`, including "fetched, unusable" verdicts
- keeps the last good visit and **replays it if a cold load is blocked**, so a
  first-time visitor never lands on an empty canvas through no fault of their own

### 3. Depth has to be earned on a light background

A dark field can fade works toward black and they recede while still glowing.
On a warm gallery-white ground, fading toward the background *erases* them. So
depth comes from three other places: every work sits on a dark mount board
that reads as a shadow up close and a receding shape at distance; the field is
tight enough that works overlap; and the fog range ends exactly at the field's
back plane, so works are born the colour of the wall and emerge as they
approach.

### 4. Moving things around a camera is the wrong model

The first field recycled a fixed pool of 60 planes, repositioning each one as
the camera passed it. Every serious visual bug in this project came from that
single decision — works piling onto the camera axis, planes flickering between
two positions, images appearing in plain sight instead of emerging from the
fog, large empty regions in frame. Each was a repositioning bug wearing a
different hat, and each fix broke something else.

The field is now **deterministic and chunked**. Space divides into cubes, and a
chunk's contents are a pure function of its coordinates — so works are
*created and destroyed* at chunk boundaries and never moved. That property
removes the whole class of bug rather than another instance of it.

The unlock was a **reference-counted texture cache keyed by asset id**. Sharing
textures across planes means 270 planes cost the same memory as the ~45 works
actually loaded; without it, 270 unshared 560px textures would be roughly
200 MB. Density stopped being expensive.

Measured against the previous build: frame coverage **40% → 72–80%**, empty
grid cells **7 → 2**, planes **60 → 270**, at 60fps.

One more subtlety worth recording. Loading used to make the entire field pulse
about twenty times. Each arriving batch of works rebuilt the field, and a
rebuild reset every plane's fade to zero — so the field dissolved and returned
once per batch. The cause was that a plane chose its work with
`assets[slot % assets.length]`, and `assets.length` changed with every batch,
re-pointing every slot at something different. Holding that divisor at the
*expected* final count instead means a plane's work never changes once
assigned, and slots whose work has not arrived simply stay blank and fill in.
Rebuilds during a load: **25 → 0**.

---

## What it does

- **Explore** — drag to pan, scroll to fly, WASD/arrows, click a work to fly to it
- **Wall label** — full museum record: credit line, accession number, dimensions,
  culture, and whether it is *on view right now and in which gallery*
- **Filter** — date range, colour (computed from image pixels), keyword facets
  derived from what actually loaded. Non-matching works dim rather than vanish,
  so a narrow filter shows matches *in context* instead of emptying the field.
- **Cluster** — regroup the field by department, century, classification or colour
- **Your own photos** — drag a folder onto the page, or pick files. They become
  an ordinary source alongside the departments, so filtering, clustering and
  focus flight all work on them. **Nothing is uploaded**: files are decoded and
  downscaled in the browser and handed to WebGL as same-origin blobs, so no
  server sees them and a refresh clears them. Being same-origin they also skip
  the image proxy entirely, which is what lets colour extraction read their
  pixels directly.
- **Starred** — keep works between visits; click one to fly back to it
- **Gestures** — MediaPipe hand tracking: point to pan, palm to fly, fist to stop,
  peace to focus, two-hand heart to star. Lazy-loaded; the camera is never
  requested until you ask.
- **Gallery sound** — optional public-domain track with a live Web Audio
  frequency visualiser

---

## Stack

Three.js r169 via CDN import map · MediaPipe Tasks-Vision (lazy) · Web Audio ·
The Met Collection API · vanilla everything else.

## Run it

```bash
npx serve . -p 3002
```

Then open <http://localhost:3002>. There is nothing to install or build.

## Tests

Browser automation under `tests/`, run against a local server:

```bash
cd tests && npm install && node flight-health.mjs
```

- `flight-health.mjs` — asserts five field properties **in one pass**, flying
  forward, backward and panning: works never pile onto the camera axis, the
  field is never empty, nothing appears in plain sight, no plane thrashes
  between positions, and no work is on screen twice.
- `coverage.mjs` — splits the viewport into a grid and measures what fraction
  of cells hold a visible work. This is the direct test for "don't leave empty
  space", which nothing else measured.
- `classify.mjs` — unit-tests the gesture classifier against synthetic hand
  landmarks, with no camera required.

The single-harness design is deliberate. Written as separate checks, each one
was blind to the next bug — a distance-based detector can't see a mirrored
position, which is exactly how a flicker survived a passing pop-in test.

Two measurement traps worth knowing, because both produced confidently wrong
numbers before being caught:

- **`material.opacity` is not visibility.** Fog fades *colour*, not alpha, so a
  fully-fogged work still reports opacity 1. A visibility check has to be
  fog-aware and frustum-aware, or it will report 48 visible works on a blank
  screen.
- **A mean is not a per-item measurement.** Mean field opacity dips whenever new
  planes join at zero, which looks identical to the whole field flashing. Only
  tracking each plane individually distinguishes "something new arrived" from
  "everything went dark".

---

## Still to improve

Written down honestly rather than left for someone else to find.

- **A work can appear twice in one frame.** The field holds 270 planes drawn
  from a pool of roughly 45 works, so each appears about six times across the
  space and occasionally two land in view together — measured at about 20% of
  frames. Spatial separation makes it rare rather than absent. Fixing it
  properly means either a much larger pool, which costs API requests the WAF
  will not give, or making placement pool-aware.
- **Accessibility.** A WebGL canvas with no keyboard-navigable alternative and
  nothing for a screen reader. A parallel list view of the same records would
  fix it and isn't hard. This is the most valuable thing left undone.
- **Untested on a physical phone.** The layout is responsive and touch gestures
  are implemented, but "responsive in a resized desktop browser" is not the
  same claim.
- **First load can be slow** when the Met is throttling. The fallback keeps the
  canvas populated, but a genuinely cold visitor may wait.
- **Imported photos are session-only.** Deliberate, and stated in the panel
  before you drop anything in. Starring one keeps a small embedded thumbnail so
  the entry survives a reload, but the photo itself is gone until re-imported —
  the starred rail says so rather than pretending otherwise. Persisting them
  properly means IndexedDB, and reading real capture dates means an EXIF
  parser; neither is hard, both were out of scope.

---

## Credits

An independent project, **not affiliated with The Metropolitan Museum of Art.**

- Records via the [Met Collection API](https://metmuseum.github.io/); all works
  shown are public domain.
- Gallery sound: Erik Satie, *Gymnopédie No. 1*, performed by Agathe Laforge,
  public domain via [Musopen](https://musopen.org/).
- Application code MIT.

The infinite-canvas *concept* was inspired by
[beneb85/visual-atlas](https://github.com/beneb85/visual-atlas). This is an
independent implementation against a different collection, whose API turned
out to impose very different constraints — the CORS asymmetry, the N+1, and the
WAF behaviour above are all specific to The Met.
