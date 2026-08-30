# Code structure

Two layers, each usable independently of the other:

1. **[The Horizons/CAD caching and translation layer](#1-horizonscad-caching--translation-layer)**
   (`scripts/horizonsSpk.mjs`, `scripts/closeApproach.mjs`, and part of
   `scripts/serve-example.mjs`) -- turns a typed name/designation, or a
   request for real close-approach events, into a real trajectory SPK
   or dataset a browser can consume. Server-side (Node) only; doesn't
   depend on `spicejs` at all.
2. **[The visualization layer](#2-visualization-layer-threejs)**
   (`examples/`, `solar-system/`, `close-approach/`) -- renders real
   trajectories and orbit ellipses in the browser with `three.js`.
   Depends on `spicejs` (not part of this repo -- see
   [github.com/stevenstetzler/spiceJS](https://github.com/stevenstetzler/spiceJS))
   directly -- every browser page loads it from spiceJS's own
   version-tagged GitHub Release (`window.spicejs`, not an npm import;
   see "Depends on `spicejs` directly" below for why) -- and on layer 1
   over HTTP (fetches `/horizons/*`, `/close-approach/data`).

Layer 2 is the only one that depends on the other -- it calls layer 1
over plain HTTP (`/horizons/*`, `/close-approach/data`). Layer 1 is a
standalone Node proxy that never imports `spicejs` -- it relays SPK
bytes Horizons already produced, without parsing them itself.

This repo used to be one layer of a three-layer split inside
[spiceJS](https://github.com/stevenstetzler/spiceJS) itself (that
repo's own `modules.md` called this "layer 3"); it now lives here,
depending on spiceJS's public package the same way any other
application would, rather than importing a sibling `src/` directly --
as an npm/git dependency (`spicejs`, resolved via `node_modules/spicejs`
-- see `package.json`) for the Node-only tooling under `scripts/`, and
as a released, minified browser bundle for every page layer 2 itself
serves (see below).

A worked example of both layers at once is at the
[bottom of this file](#how-the-two-fit-together-one-request-end-to-end).

## 1. Horizons/CAD caching & translation layer

Two things a browser can't do on its own, both solved server-side:
neither of JPL's APIs used here (`ssd-api.jpl.nasa.gov`,
`ssd.jpl.nasa.gov`) sends `Access-Control-Allow-Origin`, so a page can
never `fetch()` them directly; and regenerating the same object's SPK
from Horizons on every request would be wasteful when the result
rarely changes. This layer is pure Node, with **no dependency on
`spicejs` at all** -- it never parses or evaluates SPK bytes itself,
just resolves, fetches, caches, and relays what JPL's own APIs already
produce.

- **`scripts/horizonsSpk.mjs`** -- `resolveSbdbObject(sstr)` (JPL's
  Small-Body Database: turns a typed name/designation into an exact
  SPK-ID, or an ambiguous-match list, or a not-found message) and
  `fetchHorizonsSpk({ spkid, startTime, stopTime })` (fetches that
  object's real trajectory SPK -- segment type 21, see spiceJS's
  `src/math/differenceArray.js` -- from Horizons, base64-decoded to
  raw bytes).
- **`scripts/closeApproach.mjs`** -- `fetchCloseApproachData()`: JPL's
  Close-Approach Data API, a fixed query (`dist-max=2LD`,
  `date-min=1900-01-01`, `diameter=true`) for `/close-approach/`'s own
  table.
- **The caching/serving glue in `scripts/serve-example.mjs`** --
  `handleHorizonsResolve`/`handleHorizonsSpk` (the latter backed by a
  real on-disk cache, one whole SPK + a `{start, stop}` sidecar per
  `spkid` in `kernels/cache/horizons/`, re-fetching the *union* of what's
  cached and what's newly requested whenever they don't already
  overlap) and `handleCloseApproachData` (an in-memory, 1-hour-TTL
  cache -- the dataset is bounded and slow-changing, so there's no
  reason to hit JPL on every page load).

**Endpoints exposed** (same-origin, so no CORS problem for the browser):

| Endpoint | Backed by |
| --- | --- |
| `GET /horizons/resolve?sstr=...` | `resolveSbdbObject()` |
| `GET /horizons/spk?spkid=...&start=...&stop=...` | `fetchHorizonsSpk()` + the on-disk cache |
| `GET /close-approach/data` | `fetchCloseApproachData()` + the in-memory cache |

**Consumed by** `examples/shared/horizonsClient.js` (layer 2's own thin
client wrapper for the first two endpoints -- see
[`examples/shared/api.md`](examples/shared/api.md#horizonsclientjs))
and directly, via plain `fetch()`, by `/close-approach/`'s own table
code for the third.

## 2. Visualization layer (three.js)

Renders real trajectories -- analytic ellipses and real sampled state
vectors alike -- from live kernel data, in the browser, with
`three.js`. Two generations of this exist side by side, deliberately:

- **`examples/browser-demo/`** -- the original, full-featured demo:
  every control exposed (Center, Frame, Rotating, Orbit mode, Period,
  Position/Radius scale), custom-kernel upload, Horizons search,
  Command+Click "precise mode." A single, self-contained
  `index.html` on purpose, so there's always one place every feature
  is exercised at once -- see its own
  [README](examples/browser-demo/README.md) for the full rundown.
- **The curated pages** -- fixed configurations built on
  `examples/shared/`'s extracted API (scale math, orbit/trajectory
  sampling, prefetch, satellite resolution, the Horizons client, and
  one small DOM-touching exception -- the "Reference epoch"
  text/datetime/UTC-TAI controls, `examples/shared/epochInput.js` --
  full reference in [`examples/shared/api.md`](examples/shared/api.md)):
  `solar-system/index.html`, `solar-system/trajectory/index.html`,
  `examples/shared/templates/body/index.html` and
  `.../body-trajectory/index.html` (served at `/<body>/` and
  `/<body>/trajectory/` for any of the ten built-in bodies -- there's
  no literal file per body; `scripts/serve-example.mjs` routes a known
  slug to the shared template), and `close-approach/index.html`.
  `examples/browser-demo/index.html` deliberately does **not** import
  from `examples/shared/` -- it stays independent, not refactored to
  share this code (its own copy of `epochInput.js`'s widget is kept in
  sync by hand for the same reason).

**Depends on `spicejs` directly** -- every page loads a version-tagged
[GitHub Release](https://github.com/stevenstetzler/spiceJS/releases) of
`spicejs.global.min.js` via a plain `<script src="...">` tag (classic,
not a module), attaching everything spiceJS exports onto `window.spicejs`
-- `str2et`/`et2utcCalendar`/`spkez`/`bodyValues`/`prop2b`/`openRemoteSpk`/
`openRemoteFile`/`discoverSpkBodies`/`prefetchSpkQuery`/`prefetchSpkBodySegment`,
all read off `window.spicejs` (`const { load, ... } = window.spicejs;`),
never `import`ed as an ES module. That's deliberate, not stylistic:
GitHub's release-asset CDN doesn't send `Access-Control-Allow-Origin`,
and a module script's `import` always fetches in CORS mode, so a
cross-origin `import ... from '<release URL>'` fails outright -- a
classic `<script src>` has no such requirement. The classic script tag
is placed before every page's own `<script type="module">` (each of
which transitively imports `examples/shared/kernelSession.js`, which
is where most of `window.spicejs` actually gets read), so it's always
populated first -- module scripts only ever run after the document has
finished parsing, strictly after any earlier synchronous `<script>` --
**and on layer 1 over HTTP**, via `examples/shared/horizonsClient.js`
and `/close-approach/data`.

**Served by `scripts/serve-example.mjs`**, which -- beyond layer 1's
own endpoints -- also: serves the whole repo statically (own
`examples/shared/*.js`, its curated pages, `kernels/*.tls`/`.tpc` --
`spicejs` itself is fetched from its own GitHub Release, not served
from here), proxies and range-caches the large remote SPKs at
`/kernels/remote/<file>.bsp` (`scripts/rangeCache.mjs` -- the
server-side mirror of `spicejs`'s own `src/lazy/remoteFile.js`
in-browser caching), and routes `/<body>/`/`/<body>/trajectory/` to
their shared templates. `scripts/download-spk.mjs`/`scripts/inspect-spk.mjs`
are kernel-catalogue tooling this layer's proxy and `kernels/sources.mjs`
both lean on -- these two are the one place `spicejs` is still consumed
as an ordinary npm dependency (`node_modules/spicejs`, an
`import ... from 'spicejs'` ES-module import) rather than the release
bundle, since they're Node CLIs, not browser pages.

## How the two fit together: one request, end to end

A user on `/close-approach/` clicks a table row for a real close
approach:

1. **Layer 2** (`close-approach/index.html`) computes that approach's
   own epoch from the row's Julian date, moves the reference-epoch
   slider there, and calls `examples/shared/horizonsClient.js`'s
   `resolveHorizonsObject(des)`.
2. **Layer 1** (`/horizons/resolve`, `scripts/horizonsSpk.mjs`) resolves
   that designation to a real SPK-ID via JPL's Small-Body Database.
3. **Layer 2** calls `fetchHorizonsSpk({ spkid, start, stop })` for the
   approach date ±1 day.
4. **Layer 1** (`/horizons/spk`) serves it from `kernels/cache/horizons/`
   if already cached, or fetches it fresh from Horizons (and caches it)
   otherwise -- either way, real SPK bytes come back.
5. **Layer 2** hands those bytes to `examples/shared/kernelSession.js`'s
   `discoverSpkBodies()`/`prefetchCustomBody()`, which register the
   segment into the same kernel pool Earth/Moon already live in.
6. **`spicejs`** (`src/spk.js`'s `spkez()`, called both directly and
   through `examples/shared/orbitMath.js`'s `computeOrbitState()`)
   evaluates the object's real position relative to Earth at whatever
   epoch is being drawn.
7. **Layer 2** converts each position to scene units
   (`examples/shared/scale.js`) and hands the resulting points to
   `three.js` as one `THREE.Line` -- see
   [`examples/shared/api.md`](examples/shared/api.md#rendering-a-trajectory-putting-it-together)
   for that last step in full.
