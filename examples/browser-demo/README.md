# Browser demo: DE440 in three.js, loaded lazily

A real, live demo of `openRemoteSpk()` (see `docs/lazy-loading.md`)
running in an actual browser: pick a real `.bsp` SPK kernel from disk,
and spiceJS reads only the byte ranges it actually needs out of it --
via `File.slice()`, never a full upload or a full parse -- to plot
eleven Solar System bodies over an adjustable window around *now*,
rendered with [three.js](https://threejs.org/).

## Running it

This needs to be served over `http://` or `https://`, not opened as a
`file://` URL (ES module imports and `fetch()`-backed relative asset
loads -- the leapseconds kernel -- don't work under `file://`). From
the repo root:

```sh
npx http-server -p 8080
# or: python3 -m http.server 8080
```

Then open **http://localhost:8080/examples/browser-demo/** in a
browser.

## Getting a kernel file

The page has a **"Download de440s.bsp (~32 MB)"** button (hardcoded to
the real NAIF address,
`https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440s.bsp`)
that triggers your browser's own native download -- not a `fetch()`,
so it isn't affected by CORS (see "Why not just fetch it by URL?"
below). `de440.bsp` (~114 MB, covers roughly 1550-2650, vs. de440s's
1849-2150) works identically -- the whole point of `openRemoteSpk()`
is that the file's total size barely matters, since only a small
fraction of it around *now* is ever actually read.
`crossval/dss17.bsp` (a tiny 7 KB kernel committed to this repo) also
loads, but it only has ground-station segments, not planetary ones, so
nothing will plot -- use it only to sanity-check that the page loads
without errors.

## What it does

1. Picks up the file via `<input type="file">` -- the browser keeps
   the actual bytes local; nothing is uploaded anywhere.
2. Loads `kernels/naif0012.tls` (leapseconds, this repo's own bundled
   copy of the real NAIF file) via `load()` to get a real UTC "now"
   reference epoch through `str2et()`.
3. Opens the picked file with `openRemoteSpk(file.name, { fileLength:
   file.size, resolveRange })`, where `resolveRange` is just
   `file.slice(start, end).arrayBuffer()` -- the same lazy-fetch
   machinery `docs/lazy-loading.md` describes for a real network URL,
   here reading from local disk instead of over HTTP.
4. Calls `prefetch({ target, observer: 0, etStart, etEnd })` once per
   body for the current time window (the "Time window" slider, &plusmn;1
   day up to &plusmn;10 years -- default &plusmn;30 days), then
   evaluates ordinary `spkez()` at up to 240 sample epochs to draw each
   body's orbit arc *around the "Reference epoch" slider's current
   position* (not frozen at the moment the kernel was opened), plus its
   live marker position, every time that slider moves.
5. Logs how many range reads it took and how many total bytes were
   actually touched, out of the file's real size -- so you can see the
   lazy-loading savings live, not just in `perf/report.md`. Widening
   the time window re-prefetches incrementally -- already-fetched bytes
   are never re-fetched, so e.g. going from &plusmn;30 to &plusmn;365
   days only reads the *new* bytes that wider window needs (a few
   hundred KB more, not a second full pass).

## Why not just `fetch()` it by URL?

`naif.jpl.nasa.gov` sends no `Access-Control-Allow-Origin` header on
any response (verified directly -- plain `GET`, `Range` `GET`, and the
CORS preflight `OPTIONS` request all come back without it). That means
a browser blocks `fetch()` reading *any* part of the response --
headers or body -- for a cross-origin request, full stop; there's no
way around this with retries or caching, since caching a response
doesn't change whether JS is allowed to read its bytes. The **"Try
loading it directly"** button (next to the download button) makes this
concrete: it attempts `openRemoteSpk()` straight against the real NAIF
URL and shows you the resulting error live. The only thing that
*isn't* blocked by CORS is a plain browser-native download (the
download button, or just visiting the URL directly) -- because that's
a top-level navigation the browser handles itself, never exposing
bytes to page JS -- which is exactly why this demo's real loading path
is "download once, then pick the file."

## Why the default view uses ECLIPJ2000, not plain J2000

DE440's segments are natively stored in "J2000", which despite the
name is the mean-*equator*-at-J2000 frame (EME2000/ICRF) -- tilted by
Earth's ~23.4-degree obliquity relative to the ecliptic, not aligned
with it. Rendering that frame directly makes the (near-coplanar)
planetary orbits look visibly inclined, which is real but not the
usual "looking down at the solar system" view people expect by
default. The default (non-body-locked) view instead rotates every
position into `ECLIPJ2000` -- J2000 rotated onto the ecliptic plane, a
fixed rotation with no time-dependence -- via `spkez()`'s own `ref`
parameter (the same one `examples/spk.mjs` already demonstrates).
Verified directly: Earth's own Z-coordinate (which effectively
*defines* the ecliptic plane) is ~57 million km in native J2000 but
only ~30 thousand km in ECLIPJ2000, a ~2000x reduction, at a sample
epoch checked against the real `de440.bsp`.

## Orbit-arc span follows the reference epoch

Each body's orbit-arc line spans &plusmn;the "Time window" value
around wherever the "Reference epoch" slider is currently pointing,
not a span fixed at the moment the kernel was opened -- drag that
slider and every arc redraws around the new epoch (clamped to the
edges of the actual prefetched range, so this never needs new
network/file reads). This makes "Time window" do double duty: how much
gets prefetched *and* how much trajectory each arc traces around your
current view -- want to see just the last/next few days around some
specific moment instead of the whole prefetched span? Narrow it.

## Bodies shown, and their real relative sizes

Sun (10), Mercury (199), Venus (299), Earth (399), Moon (301), Mars (4),
Jupiter (5), Saturn (6), Uranus (7), Neptune (8), Pluto (9). Mercury/
Venus use their own body IDs (DE440 carries dedicated segments for
them); the outer planets stay barycenter-based for *position* (their
own offset from the barycenter isn't separately modeled -- see
`perf/README.md`), though see "Centering the view" below for how their
*orientation* still uses the real planet.

Marker sizes are real physical body radii -- `BODY<id>_RADII` from
`kernels/pck00011.tpc`, read via `bodyValues()` (spiceJS's
`bodvrd_c`/`bodvcd_c` equivalent -- the modern name for what CSPICE
historically called `bodvar_c`/`BODVAR`), not hand-picked constants.
They're *not* rendered at the same km-per-scene-unit scale as orbital
positions, though: at that scale every planet is many orders of
magnitude smaller than a screen pixel (Earth's radius is
~1/23,000th of its orbital distance) -- true-to-both-scales rendering
is exactly why real orrery visualizations pick one scale or the other,
never both. A square-root mapping is used for marker size instead of a
linear one: it preserves the real *ordering* and relative proportion
between bodies (Jupiter clearly, correctly bigger than Earth; Earth
bigger than the Moon; the Sun clearly biggest of all) while
compressing the real ~585x min/max radius spread (Pluto vs. the Sun)
enough that the smallest bodies stay visible on screen and the Sun's
marker doesn't grow large enough to swallow Mercury's orbit -- verified
directly: the chosen scale puts the Sun's marker just inside Mercury's
real perihelion distance, with margin.

## Centering the view

Click a body in the "Bodies shown" legend to re-center the whole scene
on it -- every position becomes `spkez(otherBody, clickedBody, et)`
instead of `spkez(otherBody, 0, et)`, so e.g. clicking Earth shows a
geocentric view (Sun ~1 AU away, other planets at their true distance
from Earth, not the Sun). This needs no new prefetching: every body
was already prefetched relative to the SSB, which is exactly the chain
`spkez()` needs to compute *any* pairwise state between two of them.

**Alt/Option+Click** goes further: it also locks the view's
orientation to that body's own rotating `IAU_<BODY>` frame (via
`spkez()`'s `ref` parameter, using the classic text-PCK orientation
formula and `kernels/pck00011.tpc`'s real constants -- see
`src/bodyOrientation.js`) instead of the fixed, non-rotating
`ECLIPJ2000` frame every other view uses. Orbit-arc lines are hidden while a
rotating frame is active: this demo's fixed sample budget (tens of
points across the time window) is far coarser than most bodies' own
rotation periods (Jupiter's is ~10 hours), so a connect-the-dots line
through those samples would alias into a meaningless tangle -- each
individual sampled *position* is still exact, only a sparse *line*
through them isn't meaningful in a fast-rotating frame. The live
marker positions (as the "Reference epoch" slider moves) stay exact
regardless. Click the active body again (with the same modifier) to
reset back to the Solar System Barycenter / J2000 default.

Note: for the outer planets, the *position* used is still the
barycenter (no separate planet-body segment exists in DE440 for them),
but the `IAU_<BODY>` frame is keyed to the real planet (e.g. `IAU_JUPITER`'s
orientation constants are `BODY599_POLE_RA` etc., not `BODY5_...` --
confirmed against `pck00011.tpc`, which has no orientation data for
barycenters at all). `spkez()`'s frame rotation doesn't require the
frame's center to match the target/observer IDs, so this is a
perfectly ordinary "shown at the barycenter's position, oriented as
the planet actually rotates" view -- not an approximation glued on for
this demo specifically.

## Notes

- Positions are converted from km to AU and then to a fixed scene
  scale (4.2 units/AU) so the whole range from Mercury to Pluto is
  visible at once; this is a display choice, not something spiceJS
  itself does.
- three.js is loaded from a CDN (unpkg, pinned to 0.169.0) via an
  import map -- swap that for a local copy if you need this to work
  fully offline.
- Clicking "Try loading it directly" logs a browser-level network
  error to devtools (something like `net::ERR_CONNECTION_RESET` or a
  CORS policy warning, depending on your network) in addition to the
  page's own explanation in the status log -- that's the browser
  itself reporting the blocked request, not a bug in this demo.
