# Visualization API

Plain ES modules, under `examples/shared/`, that hold the non-UI logic
behind the curated demo pages -- `/solar-system/`, `/solar-system/trajectory/`,
`/<body>/`, `/<body>/trajectory/`, `/close-approach/` (see the root
[README](../../README.md#running-the-example-website--visualization-tool)
for what each page shows). Every function here is pure/parametrized: none
of them hold onto a page's own session state, read the DOM, or touch
three.js -- a page imports what it needs, keeps its own `demo` object
(the loaded kernel, the current bodies, the current reference epoch),
and wires the results into its own scene. That's what makes the same
math work unmodified whether a page is drawing ellipses around the Sun,
real sampled moon trajectories around a planet, or a close-approach
object flying past Earth.

One deliberate exception: [`epochInput.js`](epochInput.js) *does* touch
the DOM -- it mounts the calendar/JD text entry + datetime-local picker
+ UTC/TAI toggle every curated page's "Reference epoch" section has, and
those are the same handful of `<input>`s and event listeners on all
five pages. Sharing that one small, self-contained UI widget avoids five
near-identical copies without pulling any of the *math* modules below
into touching the DOM.

`examples/browser-demo/index.html` -- the original, full-featured demo
this module set was extracted from -- is **not** built on this API. It
stays a single, self-contained file on purpose, so there's always one
place every feature is exercised at once; see its own
[README](../browser-demo/README.md) for the fuller version of most of
the reasoning summarized here.

## Module map

| Module | What it's for |
| --- | --- |
| [`constants.js`](constants.js) | Shared numeric constants -- scale factors, sample-count budgets, body IDs. |
| [`bodies.js`](bodies.js) | The ten built-in bodies, their known satellite kernels, and satellite-manifest lookup. |
| [`scale.js`](scale.js) | Converts km positions/radii into Three.js scene units. |
| [`orbitMath.js`](orbitMath.js) | Two-body orbit geometry (for ellipses) and real-trajectory sampling. |
| [`kernelSession.js`](kernelSession.js) | Loading text kernels, structurally scanning a kernel's own body list, and the lazy prefetch strategy every body's data follows. |
| [`horizonsClient.js`](horizonsClient.js) | The two network calls behind "fetch a body from JPL Horizons." |
| [`epochInput.js`](epochInput.js) | The "Reference epoch" text/datetime/UTC-TAI controls (DOM-touching -- see the exception noted above). |

None of them import three.js or touch the DOM; a page's own `<script>`
does that part (see [Rendering a trajectory](#rendering-a-trajectory-putting-it-together)
below for how the pieces actually get turned into a `THREE.Line`).

## Body objects, and the fields every function here expects

There's no class here -- a "body" is just a plain object, and different
functions read different fields off it. A page builds these up as it
resolves each body (see [`kernelSession.js`](#kernelsessionjs) below);
the fields that recur throughout this API are:

| Field | Set by | Meaning |
| --- | --- | --- |
| `target` | caller | The NAIF ID `spkez()` etc. use for this body. |
| `bodyId` | caller | The real physical body's NAIF ID (radii/orientation/GM lookups) -- differs from `target` for an outer-planet barycenter. |
| `primaryId` | `prefetchBodyProbe()` / `resolveOneSatellite()` | The body this one orbits (`null` for the Sun, or a page's own fixed central body). |
| `remote` | `prefetchBodyProbe()` | The `{ pool, prefetch() }` this body's data comes from -- absent once a body is `fullyPrefetched` (see below). |
| `dataStart` / `dataEnd` | `prefetchBodyProbe()`, grown by `ensureBodyCoverage()` | The ET range actually prefetched so far. |
| `coverageStart` / `coverageEnd` | set directly by a page (custom/Horizons bodies), or by `resolveOneSatellite()` | The body's own **real, fixed** coverage bound, if narrower than the session's overall range. Checked by `bodyHasCoverageAt()`. Absent means "covered whenever the session's own reference-epoch range allows." |
| `meanRadiusKm` | `meanRadiusKmFor()` (cached on first call) | `null` if this body has no real `RADII` data. |

A custom or Horizons-fetched body is additionally marked
`fullyPrefetched: true` once its own whole interval has been prefetched
up front -- every page's own `updateSceneForOffset()`-equivalent skips
calling `ensureBodyCoverage()` on a body like this, since there's
nothing more to fetch.

## `constants.js`

Numeric constants shared by the rest of this API and by the pages that
use it -- scale factors (`AU_KM`, `SCENE_UNITS_PER_AU`, `POSITION_LINEAR_SCALE`,
`POSITION_SQRT_SCALE`, `RADIUS_SCENE_SCALE`, `PRECISE_BODY_RADIUS_UNITS`),
sample-count budgets for trajectory mode (`ARC_MAX_SAMPLES`,
`ARC_MAX_SAMPLES_ABSOLUTE_CEILING`, `ARC_MIN_SAMPLES`, `ARC_SAMPLES_PER_LOOP`,
`TRAJECTORY_STEP_EPSILON_KM`, `TRAJECTORY_FALLBACK_HALF_SPAN_DAYS`),
custom-body sampling (`CUSTOM_TRAJECTORY_RESOLUTION_SECONDS`,
`CUSTOM_TRAJECTORY_MAX_SAMPLES`), the ellipse point count
(`ORBIT_ELLIPSE_SEGMENTS`), and a few well-known NAIF IDs (`SSB`,
`SUN_TARGET`, `EARTH_TARGET`) plus the default inertial frame
(`INERTIAL_FRAME = 'ECLIPJ2000'`). See the file itself for each value
and a one-line reason; none of them are arbitrary -- they're the same
numbers `examples/browser-demo/index.html` converged on across several
rounds of live-data tuning.

## `bodies.js`

```js
export const BODIES: Array<{ target, bodyId, name, color, fallbackRadius, iauFrame }>
```
The ten built-in bodies (Sun + nine planets/barycenters).

```js
bodySlug(b) -> string          // "Jupiter (barycenter)" -> "jupiter"
bodyBySlug(slug) -> body|null  // reverse lookup into BODIES
```

```js
export const SATELLITE_KERNEL_FOR_BODY: { [bodyId]: { kernelId, centerId?, only? } }
export const SATELLITE_COLORS: number[]
satellitesFromManifest(kernelId, centerId, excludeIds, only) -> Array<{ target, bodyId, name, color, iauFrame }>
```
`satellitesFromManifest()` reads `kernels/sources.mjs`'s own
live-verified manifest -- no data fetch, just static catalogue data --
for every real satellite of a body. `resolveSatellitesFor()` (in
`kernelSession.js`) is what actually turns these candidates into
prefetched bodies.

## `scale.js`

```js
scalePosition(posKm: [x,y,z], mode: 'linear'|'sqrt') -> [x,y,z]   // scene units
scaleRadius(b, mode: 'linear'|'sqrt', anchorKm, pool) -> number   // scene units
meanRadiusKmFor(b, pool) -> number|null
smallestKnownRadiusKm(bodies, pool) -> number|null
makeScale({ positionMode, radiusMode, radiusAnchorKm, pool }) -> { posToScene(posKm), markerRadius(b) }
buildCurrentScale(positionMode, radiusMode, bodies, pool, onFallback?) -> same shape as makeScale()
```

`makeScale()` is what a page actually calls once, then uses everywhere:
`scale.posToScene(positionKm)` for every marker/ellipse/trajectory
point, `scale.markerRadius(b)` for every sphere's radius. Two things
worth knowing before using it directly:

- **`'sqrt'` mode** compresses distance (or size) so the whole solar
  system fits on screen at once -- this is the whole-system default
  (`positionMode: 'linear', radiusMode: 'sqrt'`): true linear AU
  distances, but a sqrt-compressed marker size so Mercury doesn't
  vanish next to the Sun.
- **`positionMode: 'linear', radiusMode: 'linear'` is a special case**,
  not just two independent linear factors: `makeScale()` ties them to
  *one shared* km-to-scene-unit factor anchored to `radiusAnchorKm`
  (typically the smallest body actually shown -- `buildCurrentScale()`
  computes this for you via `smallestKnownRadiusKm()`). This is what
  makes a `/<body>/` page's "true-to-scale" view actually true to
  scale: a moon's real size *and* its real orbital distance both come
  out in the same physical proportion, not two numbers picked
  independently. Passing two *different* factors here (the naive
  approach) was tried once and put a Linear-radius Sun bigger than
  Mercury's own orbit -- see `makeScale()`'s own doc comment.

## `orbitMath.js`

This is the module that actually answers "where does the orbit line
go" -- both for an analytic ellipse and for a real sampled trajectory.
Every vector in and out is a plain `[x, y, z]` array (no three.js), so
it's usable from a plain Node script too.

```js
computeOrbitState(targetId, primaryId, et, pool)
  -> { r, v, mu, e, invA, pHat, qHat, hHat }
```
The core two-body physics: `targetId`'s real (osculating) state
relative to `primaryId` at `et`, plus the conserved quantities an
ellipse (or an open hyperbolic/parabolic arc) is built from. `invA > 0`
means bound (draw a closed ellipse); `invA <= 0` means unbound (draw an
open arc instead -- see [below](#rendering-a-trajectory-putting-it-together)).
Throws only for a genuinely degenerate case (rectilinear orbit, or a
GM lookup failure for `primaryId` itself) -- an unbound orbit is a
normal, non-throwing return, by design, so a caller doesn't need a
separate code path just to detect it.

```js
periodFromEllipse({ a, mu }) -> seconds        // Kepler's third law
siderealPeriodSeconds(targetId, et, pool) -> seconds
```
`siderealPeriodSeconds()` is a body's real period **around the SSB**,
approximated with the Sun's own GM as primary -- correct for a planet,
wrong for a moon (use `computeOrbitState()` directly against the
planet as `primaryId` for that -- see `/<body>/trajectory/`'s own
`satellitePeriodSeconds()` helper, a page-local ~10-line wrapper, for
the pattern). Throws for the Sun itself (no well-defined period) and
for a genuinely unbound state.

```js
trajectoryWindowForBody(centerBody, body, et, pool, periodMode, kernelStartEt, kernelStopEt, log?)
  -> [etStart, etEnd]
```
Sizes a body's trajectory-mode sampling window to one real lap: its own
sidereal period (`periodMode: 'sidereal'`), or its *synodic* period
relative to `centerBody` (`periodMode: 'synodic'`, i.e. how long until
the relative geometry repeats). Handles the Sun as a special case when
it isn't the observer (its motion mirrors `centerBody`'s own orbit
exactly) and falls back to a fixed window if a period can't be
determined. Always clamped to `[kernelStartEt, kernelStopEt]` -- a
body's real period can reach past the loaded kernel's own coverage even
when `et` itself can't.

```js
sampleArcAdaptive(target, observer, et0, et1, frame, pool, maxSamples?) -> Array<{ et, position }>
arcSampleBudget(windowSpanSeconds, centerPeriodSeconds, referencePeriodSeconds) -> number
```
`sampleArcAdaptive()` walks `[et0, et1]` with a **curvature-based**
step (finer where the relative trajectory bends more, coarser on
straight stretches), always reaching `et1` within `maxSamples`.
`arcSampleBudget()` computes that `maxSamples` scaled to how many
"laps" the observer implies within the window, and to how much
faster/slower the observer is than `referencePeriodSeconds` (Earth's
own period, the density target this whole scheme was calibrated
against). **Both of these are heliocentric**: `sampleArcAdaptive()`'s
own step-sizing measures curvature relative to the *Sun* no matter what
`observer` is, so it needs the Sun's own SPK coverage prefetched for
every sampled instant -- confirmed the hard way building `/<body>/trajectory/`,
where centering on a moon (not the Sun) made this throw "no loaded SPK
segment" until a Sun probe was added even though the Sun is never
displayed there. If a page's observer is never the Sun and there's no
reason to prefetch Sun coverage, sample uniformly instead (see
`customBodySampleCount()` below, or `/<body>/trajectory/`'s own
`sampleSatelliteTrajectory()` for a ~10-line plain uniform sampler).

```js
customBodySampleCount(intervalStartEt, intervalEndEt) -> integer
```
Just the point *count* -- how many evenly-spaced samples a whole
interval needs for ~1-minute real resolution
(`CUSTOM_TRAJECTORY_RESOLUTION_SECONDS`), capped at
`CUSTOM_TRAJECTORY_MAX_SAMPLES` so a multi-year interval degrades to a
coarser step instead of demanding an enormous line. The actual
uniform-sampling loop (evenly spaced `spkez()` calls across the
interval, `n` from this function) is short enough that every caller
just writes it inline rather than this module exporting a sampler of
its own -- see [Rendering a trajectory](#rendering-a-trajectory-putting-it-together)
below for that loop. Used for every custom/Horizons body's own
trajectory (whose whole real interval, not one periodic lap, is what
gets drawn) and for a real satellite's own orbit around its planet
(`/<body>/trajectory/`'s own `sampleSatelliteTrajectory()`).

## `kernelSession.js`

The lazy-loading and prefetch machinery -- same "probe now, widen on
demand" strategy `examples/browser-demo/index.html` uses, factored out
so the same body-tracking fields (`dataStart`/`dataEnd`/`coverageStart`/
`coverageEnd`/`remote`, see [above](#body-objects-and-the-fields-every-function-here-expects))
work identically everywhere.

```js
await loadLeapseconds(log?)
await loadPlanetaryConstants(pool, log?)
await loadGravitationalParameters(pool, log?)
```
Load this repo's own bundled text kernels (`naif0012.tls`, `pck00011.tpc`,
`gm_de440.tpc`) -- called once per session, before anything else.

```js
bodyHasCoverageAt(b, et) -> boolean
```
Whether `b` has real data at `et` -- checked before every position
query or trajectory draw, so a body outside its own known interval can
be hidden cleanly (marker invisible, no arc) instead of failing loudly.

```js
await discoverSpkBodies(remoteFile) -> Map<target, { target, center, etStart, etEnd, types }>
```
A **structural** scan of a DAF's summary records -- every body it
carries and its real coverage, with no position data fetched. Used to
populate a "review bodies before adding" list, and to set a resolved
body's own `coverageStart`/`coverageEnd`.

```js
await ensureBodyCoverage(b, etStart, etEnd, { counters?, log? })
await prefetchBodyProbe(remote, body, primaryId, et0)
await prefetchCustomBody(remoteFile, pool, target, etStart, etEnd, { systemBodies?, counters?, log? })
```
`prefetchBodyProbe()` is the minimal first fetch for a standard body
(just enough to read its state at `et0`); `ensureBodyCoverage()` widens
that range later, only fetching what isn't covered yet.
`prefetchCustomBody()` is the one for a body from a *different* file
(a local upload or a Horizons fetch) -- it chains that file's segments
into the *same* pool the primary kernel's bodies live in (so a custom
body can be positioned relative to, or observed from, anything else in
the session), trying the fast path first and falling back to a manual
hop-by-hop walk toward the SSB for a heliocentric small-body kernel.
`systemBodies`, if given, lets that walk stop early at any body already
known to the session -- widening its existing coverage instead of
searching the (usually much smaller) custom file for a segment it
doesn't have. **A Horizons-fetched small-body SPK is always Sun-centered**
(`scripts/horizonsSpk.mjs` always requests `CENTER=SUN`), so a page
whose observer is never the Sun still needs a Sun *probe* in
`systemBodies` for this to resolve -- see `/close-approach/`'s own
`demo.sunStub`, probed but never displayed, for the pattern.

```js
await openSatelliteRemote(entry, pool, openRemoteFileFn, log?) -> remote-like object
await resolveOneSatellite(primaryRemote, parentSpec, candidate, mapping, { et0, proxyCatalogue, satelliteRemotes, openRemoteFileFn, log? }) -> body|null
await resolveSatellitesFor(spec, satelliteKernelForBody, primaryRemote, opts) -> body[]
```
`resolveSatellitesFor()` is the one a page actually calls: every known
satellite of `spec` (from `SATELLITE_KERNEL_FOR_BODY`/`satellitesFromManifest()`),
each resolved via `resolveOneSatellite()` -- which tries the
already-loaded primary kernel first (covers Earth's Moon, bundled in
`de440s`), then opens (or reuses, via the caller-owned `satelliteRemotes`
map) the satellite kernel `SATELLITE_KERNEL_FOR_BODY` points to.
Failures (no local proxy running, kernel doesn't have this body) return
`null` for that one satellite rather than aborting the whole list.

## `horizonsClient.js`

```js
await resolveHorizonsObject(sstr) -> { status: 'found', spkid, fullname, shortname } | { status: 'ambiguous', candidates } | { status: 'not-found', message }
await fetchHorizonsSpk({ spkid, start, stop }) -> ArrayBuffer
formatBytesShort(bytes) -> string   // "1.4 MB"
safeFileFragment(label, fallback) -> string   // for a synthetic filename
```
The two-step "fetch a body from JPL Horizons" flow, proxied through
this repo's own dev server (`scripts/horizonsSpk.mjs` -- neither
`ssd-api.jpl.nasa.gov` nor `ssd.jpl.nasa.gov` sends
`Access-Control-Allow-Origin`, so this can't be called directly from a
browser). `resolveHorizonsObject()` turns whatever a user typed (or a
close-approach table's own `des`) into a real SPK-ID; `fetchHorizonsSpk()`
then fetches that object's actual trajectory SPK, server-cached per
`spkid` in `kernels/cache/horizons/` (see the root
[README](../../README.md)'s own kernels section). The returned bytes
feed straight into `discoverSpkBodies()`/`prefetchCustomBody()` above,
exactly like a locally-uploaded `.bsp` would -- there's no separate
code path for where the bytes came from.

## `epochInput.js`

```js
mountEpochControls(container, { getEt0, getCurrentEt, getOffsetBounds, setOffsetDays, log? }) -> { refresh(), setEnabled(enabled) }
```
Mounts the "Reference epoch" text entry (calendar or `JD ...`) +
datetime-local picker + UTC/TAI checkbox into `container`, wired to a
page's existing `timeSlider`/`updateSceneForOffset(offsetDays)` pair --
`setOffsetDays()` is expected to move `timeSlider.value` and re-run the
page's own scene update, same as the slider's own `input` listener
already does. Every entered epoch is turned into ET via `str2et()` (a
`" TDB"`/`" TDT"` label in the text itself always wins over the TAI
checkbox, exactly like `str2et()`'s own label handling); a bare TAI
value (no label, checkbox checked) goes through `taiToEt()` instead,
which needs no leapseconds kernel at all (see `src/time/deltet.js`).
Call the returned `refresh()` once per `updateSceneForOffset()` tick
(right where it already updates `timeLabel`) so these controls always
show whatever last moved the reference epoch, from any source -- the
slider, "Look At", loading a new kernel, or these controls themselves.
Call `setEnabled(true)` alongside `timeSlider.disabled = false`.

## Rendering a trajectory: putting it together

Neither this module set nor `examples/browser-demo/index.html` ever
draws a trajectory as *many small straight segments the caller
manually strings together and hopes look curved* -- every line is
built from real physics (an exact ellipse, or real sampled state
vectors) and handed to three.js as one `THREE.Line`. Two shapes, both
using `orbitMath.js` plus whatever `scale.posToScene()` a page is
currently using:

**An ellipse** (the default for the ten standard bodies, and for a
bound custom/Horizons body):

```js
// `b` is the plain body object being drawn (has its own .color, .target,
// .primaryId) -- distinct from computeOrbitState()'s returned `state`.
const state = computeOrbitState(b.target, b.primaryId, et, pool);
if (state.invA > 0) {
  const a = 1 / state.invA;
  const semiMinor = a * Math.sqrt(Math.max(0, 1 - state.e * state.e));
  // A THREE.EllipseCurve in the orbital plane's own (pHat, qHat) basis,
  // offset so the focus (not the center) sits at the origin -- exactly
  // where computeOrbitState()'s own r/v were measured from.
  const curve = new THREE.EllipseCurve(-a * state.e, 0, a, semiMinor, 0, 2 * Math.PI, false, 0);
  const points = curve.getPoints(ORBIT_ELLIPSE_SEGMENTS).map((p) =>
    new THREE.Vector3(...scale.posToScene([
      state.pHat[0] * p.x + state.qHat[0] * p.y,
      state.pHat[1] * p.x + state.qHat[1] * p.y,
      state.pHat[2] * p.x + state.qHat[2] * p.y,
    ]))
  );
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: b.color })
  );
}
```
This is recomputed fresh every time the reference epoch moves -- an
ellipse is cheap enough (one `spkez()` call) that there's no reason to
cache it, and recomputing keeps it honest about the body's real,
perturbed (n-body) motion rather than freezing one epoch's shape
forever.

**An unbound orbit** (`state.invA <= 0` -- only possible for a
custom/Horizons body; no built-in body is ever unbound relative to its
own primary): no closed curve exists, so propagate the same state
analytically instead, via `prop2b()` (`src/prop2b.js`, exported from
`src/browser.js` -- a universal-variable two-body propagator that
handles parabolic/hyperbolic orbits the same way it handles elliptical
ones):

```js
const pvinit = [...state.r, ...state.v];
const n = customBodySampleCount(b.coverageStart, b.coverageEnd);
const points = [];
for (let i = 0; i < n; i++) {
  const sampleEt = b.coverageStart + (b.coverageEnd - b.coverageStart) * (i / (n - 1));
  const [x, y, z] = prop2b(state.mu, pvinit, sampleEt - et);
  points.push(new THREE.Vector3(...scale.posToScene([x, y, z])));
}
```

**A real sampled trajectory** (trajectory mode, for a standard body --
one lap of its own period around whatever's currently the observer):

```js
const window = trajectoryWindowForBody(centerBody, b, et, pool, 'sidereal', kernelStartEt, kernelStopEt, log);
const centerPeriod = /* siderealPeriodSeconds(observerTarget, et, pool), or null if it throws */;
const earthPeriod = siderealPeriodSeconds(EARTH_TARGET, et, pool);
const maxSamples = arcSampleBudget(window[1] - window[0], centerPeriod, earthPeriod);
const samples = sampleArcAdaptive(b.target, observerTarget, window[0], window[1], INERTIAL_FRAME, pool, maxSamples);
const points = samples.map((s) => new THREE.Vector3(...scale.posToScene(s.position)));
```
Remember `sampleArcAdaptive()`'s own Sun-relative curvature dependency
(see [`orbitMath.js`](#orbitmathjs) above) -- this shape is only
correct when the Sun's own coverage is also kept prefetched across
`window`, which is why every heliocentric trajectory page widens the
Sun's coverage to the union of every displayed body's own window, not
just the current observer's.

**A custom/Horizons body's own trajectory, or a satellite's real orbit
around its planet** (both: real data, plain uniform sampling, no
curvature step -- see `customBodySampleCount()`'s own doc comment for
why *not* `sampleArcAdaptive()` here):

```js
const n = customBodySampleCount(b.coverageStart, b.coverageEnd);
const points = [];
for (let i = 0; i < n; i++) {
  const sampleEt = b.coverageStart + (b.coverageEnd - b.coverageStart) * (i / (n - 1));
  const { position } = spkez(b.target, observerTarget, sampleEt, 'NONE', INERTIAL_FRAME, pool);
  points.push(new THREE.Vector3(...scale.posToScene(position)));
}
```
Pages cache this array (keyed by whatever the current observer is,
since positions are relative to it) rather than resampling every
reference-epoch tick -- the underlying data doesn't depend on the
current epoch at all, only on which body/observer/frame is being
drawn.
