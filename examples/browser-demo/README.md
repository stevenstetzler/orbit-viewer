# Browser demo: DE440 in three.js, loaded lazily

A real, live demo of `openRemoteSpk()` (see `docs/lazy-loading.md`)
running in an actual browser: pick a real `.bsp` SPK kernel from disk,
and spiceJS reads only the byte ranges it actually needs out of it --
via `File.slice()`, never a full upload or a full parse -- to plot ten
Solar System bodies over an adjustable window around *now*, rendered
with [three.js](https://threejs.org/). Four explicit controls (Center,
Frame, Rotating, Orbit) and two per-body actions (Look, From) drive the
view, or Command+Click a body (the Windows/Super key on non-Mac
keyboards) to drop into a true-to-scale single-body-and-its-moons view
-- see "View controls: Center, Frame, Rotating, Orbit, Look, From"
below.

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
4. For each body, calls `prefetch({ target, observer: 0, etStart: et0,
   etEnd: et0 })` -- a minimal probe at the reference epoch, just
   enough to read one state. Evaluates ordinary `spkez()` once at the
   "Reference epoch" slider's current position for the body's real
   state (position, velocity), and draws its orbit-arc line as the
   exact analytic two-body ellipse that state implies (see "Orbit-arc
   shape: an exact two-body ellipse" below) -- recomputed fresh, from
   real data, every time that slider moves, along with the live marker
   position.
5. Logs how many range reads it took and how many total bytes were
   actually touched, out of the file's real size -- so you can see the
   lazy-loading savings live, not just in `perf/report.md`. Scrubbing
   the reference epoch re-prefetches incrementally, per body, only as
   far as you've actually scrubbed -- already-fetched bytes are never
   re-fetched.

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

## Orbit-arc shape: an exact two-body ellipse, or a real sampled trajectory

Earlier versions of this demo drew each orbit-arc line from *sampled
real trajectory data* -- first over one shared time window applied to
every body at once, then (after that broke down: a moon's period runs
days, a planet's runs years, Pluto's runs nearly two and a half
centuries, so no single window size was ever right for all of them)
over each body's own real orbital period specifically, with an
adaptive sampling scheme to avoid aliasing within that span. Both
needed prefetching a whole orbit's worth of data ahead of time, and
both were still just an approximation of a curve, sampled at finitely
many points.

The **Orbit** control picks between two ways of drawing that line,
and its default depends on **Center**: `Ellipse` at the Solar System
Barycenter (the whole-system default), `Trajectory` anywhere else --
auto-selected the moment Center changes, though it's still yours to
override at any time (e.g. force `Ellipse` back on while centered on
Mars, or force `Trajectory` on at the SSB, which falls back to a fixed
&plusmn;30-day window since the SSB has no orbital period of its own
to size one from).

**Ellipse** (described in the rest of this section) skips sampling a
trajectory at all: each orbit-arc line is the **exact analytic ellipse**
implied by the body's own real
state (position, velocity) and `GM` at the *current* reference epoch,
via the standard two-body orbital-mechanics identities:

```
invA = 2/r - v^2/mu                     (vis-viva -> 1/semi-major axis)
h    = r x v                            (specific angular momentum -- orbit-normal direction)
eVec = (v x h)/mu - r/|r|               (eccentricity vector -- points toward periapsis)
```

giving semi-major/-minor axis, eccentricity, and an orthonormal
in-plane basis (`pHat` toward periapsis, `qHat` completing a
right-handed frame) -- together enough to place any point on the
ellipse directly, via
[`THREE.EllipseCurve`](https://threejs.org/docs/#api/en/extras/curves/EllipseCurve)
in the body's own perifocal plane, then a single 3D rotation
(`pHat*x + qHat*y`) into the actual view. Deriving the basis from `h`/
`eVec` directly, rather than the classical inclination/node/argument-
of-periapsis angles, sidesteps their usual singularities (undefined
node for zero inclination, undefined argument of periapsis for zero
eccentricity) -- exactly the near-circular case several of this demo's
own moons are close to. `mu` uses the reduced two-body
`GM(primary) + GM(body)`, `GM` from this repo's own bundled
`kernels/gm_de440.tpc` (~12 KB, same NAIF-generic-file pattern as
`naif0012.tls`/`pck00011.tpc`), not an external API: NASA/JPL's
Small-Body Database (the obvious-looking source, given its name) only
covers asteroids and comets, not planets or natural satellites --
confirmed directly against the real API (`sstr=Mercury`, `Phobos`, and
`Charon` all come back "specified object was not found"), and some
names actively collide with real asteroids of the same name
(`sstr=Io`/`Europa` resolve to main-belt asteroids 85 Io and 52 Europa,
not Jupiter's moons) -- so it would either fail outright or silently
return the wrong object's data for every body this demo shows.

Since it's a closed curve by construction, it always looks right
regardless of how many times a fast body has actually orbited -- no
sampling density or time-span tuning needed at all, for any body, at
any eccentricity, at any epoch. This is really the *osculating* orbit
-- the instantaneous idealized two-body shape implied by the body's
real (perturbed, n-body) state at this one epoch, not a shape refined
over a whole real orbit -- recomputed fresh every time the "Reference
epoch" slider moves, so it stays honest about the actual current
trajectory rather than freezing a single snapshot. The "Reference
epoch" slider itself now has a fixed &plusmn;10-year range (no more
per-body-period-derived bounds needed, since there's no span left to
size): scrubbing it still prefetches incrementally per body, but only
as far as you've actually visited, not a whole orbit ahead of time --
verified live, screenshotted: scrubbing to the slider's own edge
(&plusmn;3650 days) still renders a clean, undistorted ellipse, not a
degraded or clipped one.

A body with no real primary to orbit -- only the Sun itself, in this
demo, since it has no single primary of its own in this two-body sense
-- gets no orbit-arc line at all (still prefetched and shown with a
live marker position, just with nothing well-defined to draw an
ellipse around).

When the current view isn't centered on a body's own real primary (the
default whole-system view centers on the SSB, not the Sun; clicking a
different planet re-centers on it instead of the Sun) its ellipse is
computed in the primary's own rest frame, then translated by the
primary's own position relative to the current view center at the
current epoch -- exact instantaneously, since both the primary and the
observer are themselves moving, so a body's ellipse lines up exactly
with its live marker only right at that epoch; still always a clean
closed curve regardless, just subtly re-angled frame to frame as you
scrub. Verified live: re-centering on Mars still renders Earth's real
heliocentric ellipse correctly, translated into Mars's own view.

**Trajectory** mode reintroduces real sampled data, deliberately --
useful specifically once the vantage point has moved off the Sun/SSB,
where the tidy ellipse of *one* body stops being the interesting shape
and what the whole system actually traces out from here (retrograde
loops and all, the same effect that makes Mars appear to loop
backwards as seen from Earth) becomes the point. Every displayed body
except Center itself is sampled directly, adaptively (`spkez(body,
Center, et, 'NONE', Frame, pool)` at as many points as its angular
motion needs to stay smooth, capped at 400 samples/body), over one
shared window `[et - P/2, et + P/2]`, where `P` is *Center's own* real
heliocentric orbital period -- reusing the same vis-viva math as the
ellipse case, just to size a sampling window instead of a closed-form
curve. Because the window is real and shared, it's also real
prefetching cost: centering on a slow-moving outer planet like Neptune
or Pluto means fetching a multi-century span for *every* other shown
body, not just an instant's worth -- worth knowing before scrubbing
around with Trajectory active on one of them.

## Bodies shown, and their real relative sizes

Sun (10), Mercury (199), Venus (299), Earth (399), Mars (4), Jupiter
(5), Saturn (6), Uranus (7), Neptune (8), Pluto (9). Mercury/Venus use
their own body IDs (DE440 carries dedicated segments for them); the
outer planets stay barycenter-based for *position* (their own offset
from the barycenter isn't separately modeled -- see `perf/README.md`),
though see "View controls" above for how their *orientation* (Frame +
Rotating) still uses the real planet. The Moon isn't in this default
list even though DE440 carries it -- at the whole-system AU scale its marker position
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

## View controls: Center, Frame, Rotating, Orbit, Look, From

Four selects/checkboxes above the legend drive the whole-system view,
all built on the same underlying idea: every position becomes
`spkez(otherBody, Center, et, 'NONE', Frame, pool)` instead of
`spkez(otherBody, 0, et, ...)` -- so e.g. centering on Earth shows a
geocentric view (Sun ~1 AU away, other planets at their true distance
from Earth, not the Sun). None of these need new prefetching for the
*system-wide* bodies' positions: every one was already prefetched
relative to the SSB, exactly the chain `spkez()` needs to compute any
pairwise state between two of them (Trajectory mode is the exception --
see "Orbit-arc shape" above).

- **Center**: which body's position is the origin -- Solar System
  Barycenter (default) or any of the ten shown bodies.
- **Frame**: which body's `IAU_<BODY>` orientation to use *if*
  Rotating is checked (via `spkez()`'s `ref` parameter, using the
  classic text-PCK orientation formula and `kernels/pck00011.tpc`'s
  real constants -- see `src/bodyOrientation.js`). Independent of
  Center -- e.g. Center=Earth with Frame=`IAU_JUPITER` is a perfectly
  ordinary "positions relative to Earth, oriented as Jupiter rotates"
  view, since `spkez()`'s frame rotation doesn't require the frame's
  center to match the target/observer IDs.
- **Rotating**: unchecked (default) uses the fixed, non-rotating
  `ECLIPJ2000` frame every system-wide view starts in; checked locks
  the view to Frame's own rotating `IAU_<BODY>` orientation instead.
  Orbit-arc lines are hidden while Rotating is checked: the frame
  itself is spinning around Frame's body every rotation period
  (Jupiter's is ~10 hours), so an "orbit" line drawn in it would just
  retrace that spin rather than show anything about the other bodies'
  real trajectories -- just not a meaningful thing to draw here. Live
  marker positions stay exact regardless.

  Note: for the outer planets, the *position* used is still the
  barycenter (no separate planet-body segment exists in DE440 for
  them), but the `IAU_<BODY>` frame is keyed to the real planet (e.g.
  `IAU_JUPITER`'s orientation constants are `BODY599_POLE_RA` etc., not
  `BODY5_...` -- confirmed against `pck00011.tpc`, which has no
  orientation data for barycenters at all).
- **Orbit**: `Ellipse` or `Trajectory` -- see "Orbit-arc shape" above.
- **Look** (per legend row): re-aims the camera at that body without
  touching Center/Frame/Rotating/Orbit at all -- purely a camera move,
  preserving the current viewing angle/distance. Stays framed on that
  body as you scrub the reference-epoch slider afterward.
- **From** (per legend row): sets Center *and* Frame to that body in
  one step (Rotating and Orbit are left as they were, except Orbit's
  own SSB-in/SSB-out auto-switch below), and clears any active Look
  target.
- **Command+Click** a body: enters "precise" single-body mode -- see
  below. All six controls above are disabled while precise mode is
  active (it's a separate feature, unaffected by any of them) and
  re-enabled on exit.

Changing Center to or from the Solar System Barycenter auto-switches
Orbit to match (`Ellipse` at the SSB, `Trajectory` anywhere else) --
just a default, not a lock: Orbit stays independently changeable
afterward.

## Command+Click: precise single-body mode

Shows *only* the clicked body and its real satellites. DE440/DE440s
are solar-system-*planetary* ephemerides, not satellite-system ones --
Earth's Moon is the only satellite actually present in that data, so
every other planet's moons come from a separate, dedicated satellite
SPK (`mar099.bsp`, `jup365.bsp`, `sat441.bsp`, `ura184_part-3.bsp`,
`nep105.bsp`, `plu060.bsp` -- see `kernels/sources.mjs`).
`sat441.bsp` carries the nine classical named Saturnian moons
(Mimas..Phoebe) plus five small inner/Lagrangian ones, but Phoebe
(609) is excluded from what's shown: at ~12.4 million km out it's
~66x farther than the closest of the other 13 (Mimas, ~188,000 km) and
~3.5x farther than the next-farthest (Iapetus, ~3.5 million km) --
verified directly against the real file -- a genuinely different class
of orbit (distant, retrograde, captured), not just a farther member of
the same regular-moon family the other 13 are; including it would blow
out the camera's auto-framing around the ones that actually matter.
NAIF also publishes `sat456.bsp` alongside `sat441.bsp` -- ~44
*irregular* outer moons, recently given real names (2025) replacing
provisional `S/2004_S_xx` designations -- but none of them have known
real radii in `kernels/pck00011.tpc`, so they're not catalogued here.
`SATELLITE_KERNEL_FOR_BODY` in
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

Precise mode uses the same analytic two-body ellipse as the
whole-system view (see "Orbit-arc shape" above) -- no separate tuning
needed for close, fast-orbiting moons vs. the whole system's
year-scale planets, since it's computed from each body's own real
state directly rather than sampled over any particular span.

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
