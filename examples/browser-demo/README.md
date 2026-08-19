# Browser demo: DE440 in three.js, loaded lazily

A real, live demo of `openRemoteSpk()` (see `docs/lazy-loading.md`)
running in an actual browser: pick a real `.bsp` SPK kernel from disk,
and spiceJS reads only the byte ranges it actually needs out of it --
via `File.slice()`, never a full upload or a full parse -- to plot ten
Solar System bodies over an adjustable window around *now*, rendered
with [three.js](https://threejs.org/). Click a body to re-center the
view on it, in either a fixed or that body's own rotating frame, or
Command+Click it (the Windows/Super key on non-Mac keyboards) to drop
into a true-to-scale single-body-and-its-moons view -- see "Click,
Control+Click, Alt/Option+Click, Command+Click" below.

## Running it

From the repo root:

```sh
npm run serve-example
```

Then open **http://localhost:8080/examples/browser-demo/**.

That server does two things: serves the repo statically, and proxies
every kernel in `kernels/sources.mjs` at `/kernels/remote/<file>.bsp`
with HTTP Range support and an on-disk sparse cache. The page detects
the proxy automatically and shows a **"Load from the local kernel
proxy"** list at the top -- click any kernel and it loads immediately,
fetching only the byte ranges the query touches (measured: 23 ranged
reads, 1.47 MB of `de440s.bsp`'s 32.7 MB, and nothing at all on a
reload). No download step, and no CORS problem, because the kernel is
now same-origin.

Any static server works too -- the page needs `http://`/`https://`
rather than `file://` for ES modules and relative `fetch()`, but
nothing more:

```sh
npx http-server -p 8080
# or: python3 -m http.server 8080
```

Without the proxy you just won't see the kernel list, and load a `.bsp`
through the file picker instead.

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
   evaluates ordinary `spkez()` at however many sample epochs each
   body's own real angular rate calls for (see "Orbit-arc sampling"
   below) to draw its orbit arc *around the "Reference epoch" slider's
   current position* (not frozen at the moment the kernel was opened),
   plus its live marker position, every time that slider moves.
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

## Orbit-arc span follows the reference epoch, loading more data as needed

Each body's orbit-arc line spans a **constant** &plusmn;the "Time
window" value around wherever the "Reference epoch" slider is
currently pointing, not a span fixed at the moment the kernel was
opened. Since the reference epoch can sit anywhere within &plusmn;the
window around *now*, the arc's own span (&plusmn;window around *that*
epoch) can reach up to 2x the window away from *now* at the slider's
own extremes -- so dragging it there calls `prefetch()` again,
incrementally (already-covered bytes are never re-fetched), extending
how far the file has been read rather than clipping the arc short.
This makes "Time window" do double duty: how much gets prefetched
around *now* by default, and how much trajectory each arc traces
around wherever you're currently looking. In practice this extension
is often free: DE440's own densely-packed Chebyshev records mean a
window's initial fetch frequently already covers well beyond a 2x
extension (verified directly -- a &plusmn;30-day window scrubbed to its
edge needed zero new bytes for the real `de440.bsp`); a genuinely new
fetch only showed up when testing a much wider &plusmn;10-year window
scrubbed to *its* edge (7 new range reads, 0.79 MB).

## Orbit-arc sampling

Each body's orbit-arc line is sampled **adaptively**, based on that
body's own real angular rate, not a fixed point count spread evenly
across the arc's time span. A fixed count is only right by accident,
when the span happens to be within about an order of magnitude of the
body's own orbital period -- which is all whole-system arcs are, at
the default &plusmn;30-day window. It breaks in both directions once
that's not true: a fast-moving body over a span covering many of its
own orbits gets *too few* samples (verified live, screenshotted:
Jupiter's Galilean moons -- 1.8-16.7 day periods -- rendered as a
tangled, self-intersecting "spirograph" over a 60-day precise-mode
span at a fixed ~60-sample budget; the same failure hits the
whole-system view too, for different bodies -- Mercury's 88-day period
means a &plusmn;10-year window traces almost 40 orbits), while a
slow-moving body over a narrow span gets *too many*, wasted spread
uselessly thin.

Instead, each arc starts from a small number of evenly-spaced seed
points, then repeatedly bisects whichever consecutive pair of points
currently sweeps the widest angle (as seen from the observer) until
every gap is under a fixed angular threshold or a hard sample cap is
hit. This needs no orbital period and no extra GM kernel: specific
angular momentum (`r &times; v`) is exactly conserved for two-body
motion, so measuring the actual angle swept between two sampled points
-- rather than assuming a fixed time step -- naturally puts more
points where a body is moving fast (near periapsis) and fewer where
it's slow (near apoapsis), for any body, at any span-to-period ratio,
with no per-body tuning. (Real solar system motion is n-body, not
exactly two-body, but the perturbations are negligible at the
timescales that matter for a smooth-looking line.)

## Bodies shown, and their real relative sizes

Sun (10), Mercury (199), Venus (299), Earth (399), Mars (4), Jupiter
(5), Saturn (6), Uranus (7), Neptune (8), Pluto (9). Mercury/Venus use
their own body IDs (DE440 carries dedicated segments for them); the
outer planets stay barycenter-based for *position* (their own offset
from the barycenter isn't separately modeled -- see `perf/README.md`),
though see "Alt/Option+Click" below for how their *orientation* still
uses the real planet. The Moon isn't in this default list even though
DE440 carries it -- at the whole-system AU scale its marker position
is visually indistinguishable from Earth's own (they'd overlap
completely); **Command+Click Earth** (see below) to see it at a scale
where it's actually visible.

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

## Click, Control+Click, Alt/Option+Click, Command+Click

Every legend row supports four click variants, all built on the same
underlying idea: every position becomes `spkez(otherBody, clickedBody,
et, 'NONE', someFrame, pool)` instead of `spkez(otherBody, 0, et, ...)`
-- so e.g. clicking Earth shows a geocentric view (Sun ~1 AU away,
other planets at their true distance from Earth, not the Sun). None of
these need new prefetching for the *system-wide* bodies: every one was
already prefetched relative to the SSB, exactly the chain `spkez()`
needs to compute any pairwise state between two of them.

- **Click** / **Control+Click** (the same thing): centers on that
  body, in the fixed, non-rotating `ECLIPJ2000` frame every other
  system-wide view uses.
- **Alt/Option+Click**: centers on that body, locked instead to its
  own rotating `IAU_<BODY>` frame (via `spkez()`'s `ref` parameter,
  using the classic text-PCK orientation formula and
  `kernels/pck00011.tpc`'s real constants -- see
  `src/bodyOrientation.js`). Orbit-arc lines are hidden while a
  rotating frame is active: the frame itself is spinning around the
  clicked body every rotation period (Jupiter's is ~10 hours), so an
  "orbit" line drawn in it would just retrace that spin rather than
  show anything about the other bodies' real trajectories -- not a
  sampling problem (see "Orbit-arc sampling" below), just not a
  meaningful thing to draw here. Live marker positions stay exact
  regardless.

  Note: for the outer planets, the *position* used is still the
  barycenter (no separate planet-body segment exists in DE440 for
  them), but the `IAU_<BODY>` frame is keyed to the real planet (e.g.
  `IAU_JUPITER`'s orientation constants are `BODY599_POLE_RA` etc., not
  `BODY5_...` -- confirmed against `pck00011.tpc`, which has no
  orientation data for barycenters at all). `spkez()`'s frame rotation
  doesn't require the frame's center to match the target/observer IDs,
  so this is a perfectly ordinary "shown at the barycenter's position,
  oriented as the planet actually rotates" view.
- **Command+Click**: enters "precise" single-body mode -- see below.

Click the active body again with the same modifier to go back to the
Solar System Barycenter / `ECLIPJ2000` default.

## Command+Click: precise single-body mode

Shows *only* the clicked body and its real satellites. DE440/DE440s
are solar-system-*planetary* ephemerides, not satellite-system ones --
Earth's Moon is the only satellite actually present in that data, so
every other planet's moons come from a separate, dedicated satellite
SPK (`mar099.bsp`, `jup365.bsp`, `ura184_part-3.bsp`, `nep105.bsp`,
`plu060.bsp` -- see `kernels/sources.mjs`; `sat480.bsp` genuinely has
none of Saturn's classic moons, so Saturn honestly reports "no
satellite data" in precise mode). `SATELLITE_KERNEL_FOR_BODY` in
`index.html` maps each planet to the satellite kernel that carries its
moons -- the actual moon list for each is read live from
`kernels/sources.mjs`'s own catalogue (`satellitesFromManifest()`),
the same manifest `scripts/inspect-spk.mjs` builds by reading the real
files, not hand-duplicated.

Entering precise mode tries what's already loaded first (covers
Earth's Moon for free, since it's bundled in de440/de440s already open
as the main kernel), and only falls back to fetching the mapped
satellite kernel -- through the local proxy's range cache, same as
every other lazy fetch in this demo -- if the clicked body's moons
aren't already available. Every other body is hidden from the 3D scene
(the "Bodies shown" legend stays fully populated and clickable, so you
can jump straight to a different body's view without backing out
first). A satellite kernel opened this way is kept open and reused for
the rest of the session -- switching back and forth between, say,
Jupiter and Mars fetches `jup365.bsp` and `mar099.bsp` each exactly
once, verified live: Jupiter fetches `jup365.bsp` (8 moons: the four
Galilean plus Amalthea/Thebe/Adrastea/Metis) only on the *first*
Command+Click, Mars fetches `mar099.bsp` (Phobos + Deimos) only on its
first Command+Click, and returning to Jupiter shows all 8 moons again
with no new fetch.

Precise mode uses the same adaptive orbit-arc sampling as the
whole-system view (see "Orbit-arc sampling" above) -- no separate
tuning needed for close, fast-orbiting moons vs. the whole system's
year-scale planets, since the sampler measures each body's own real
angular rate directly rather than assuming one. Jupiter's four
innermost, fastest moons (7-16 hour periods) still show some faceting
at the sampler's hard cap in a very wide window -- their live marker
positions stay exact regardless, same distinction already drawn for
rotating-frame arcs above.

The scale changes too: instead of the whole-system AU-anchored scale
(where every body's true radius would be sub-pixel), precise mode uses
one linear km-to-scene-unit factor anchored to the clicked body's own
real radius (`BODY<id>_RADII`) -- so both the body's size *and* its
satellite's orbital distance are rendered genuinely true-to-scale
relative to each other, which is exactly the trade-off this whole-system
default view can't afford to make. The camera automatically reframes
around the real extent of what's now shown (a lone body's own radius,
or out past its farthest satellite's orbit) -- verified live: Mars
(no satellite data) frames as a comfortably-sized lone sphere; Earth +
Moon frames with the Moon's real, distant orbit fully visible.

Click the `#viewStatus` bar (or the active body again with Command/Meta) to
leave precise mode.

## Notes

- Whole-system positions are converted from km to AU and then to a
  fixed scene scale (4.2 units/AU) so the whole range from Mercury to
  Pluto is visible at once; precise mode uses a different, real-radius-
  anchored scale instead (see "Command+Click" above). Both are display
  choices, not something spiceJS itself does.
- three.js is loaded from a CDN (unpkg, pinned to 0.169.0) via an
  import map -- swap that for a local copy if you need this to work
  fully offline.
- Clicking "Try loading it directly" logs a browser-level network
  error to devtools (something like `net::ERR_CONNECTION_RESET` or a
  CORS policy warning, depending on your network) in addition to the
  page's own explanation in the status log -- that's the browser
  itself reporting the blocked request, not a bug in this demo.
