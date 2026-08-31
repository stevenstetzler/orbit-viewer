# TODO

Things discussed or scoped but not implemented yet. Everything here
fails today with a clear, catchable error — never a silently wrong
answer — unless noted otherwise. See also
[spiceJS's own TODO.md](https://github.com/stevenstetzler/spiceJS/blob/main/TODO.md)
for gaps in the underlying library this viewer depends on.

## Solar system view (`solar-system/`)

- **[#4](https://github.com/stevenstetzler/orbit-viewer/issues/4) Timescale
  issue when fetching a Horizons body.** A Horizons SPK request for e.g.
  Ceres comes back covering `1899 DEC 31 23:59:18.816` to
  `2099 DEC 31 23:58:50.816` instead of the requested 1900-01-01 to
  2100-01-01 — the fetched body's marker then disappears when the
  reference epoch is scrubbed to the 2100 end of the slider, since it's
  past the SPK's own validity range. Likely cause: `HORIZONS_START`/
  `HORIZONS_STOP` (`solar-system/index.html`) are plain calendar strings
  passed straight through to Horizons' `START_TIME`/`STOP_TIME` via
  `buildHorizonsSpkUrl()` (`scripts/horizonsSpk.mjs`) with no explicit
  time-system qualifier; since `CENTER=SUN` isn't geocentric, Horizons'
  default interpretation of an unqualified date there is plausibly TDB,
  not UTC — offset from the naive UTC calendar date by roughly the
  TDB-UTC delta at each end of the range, which is consistent with the
  ~41s/~69s gaps reported. Needs confirming directly against the real
  API (same discipline `horizonsSpk.mjs`'s own doc comment already
  applies to its other Horizons quirks) before committing to a fix:
  1. Re-issue the DES= SPK request with the exact params this app sends
     and inspect the returned SPK's real coverage bounds/comments to
     confirm which scale Horizons applied by default.
  2. Pick one uniform timescale for the whole app (TDB is the natural
     choice — `str2et()`/`spkez()` etc. already work in ET) and make
     `buildHorizonsSpkUrl()` send an explicit, unambiguous time-system
     suffix on `START_TIME`/`STOP_TIME` instead of relying on Horizons'
     default.
  3. Align `HORIZONS_START`/`HORIZONS_STOP` with `kernelStartEt`/
     `kernelStopEt` (`str2et('1900-01-01T00:00:00')` /
     `str2et('2100-01-01T00:00:00')`) so the Horizons fetch window and
     the reference-epoch slider's own bounds agree to sub-second
     precision.
  4. Add a check (script or documented manual step) that a freshly
     fetched Horizons body's SPK coverage actually reaches both ends of
     the 1900-2100 slider range, so this doesn't silently regress.

- **[#3](https://github.com/stevenstetzler/orbit-viewer/issues/3) Find and
  use images for the major and minor planets.** Body markers are
  currently plain `THREE.SphereGeometry` + flat-color
  `MeshStandardMaterial` (`ensureMarkers()`, `solar-system/index.html`)
  — no texture mapping.
  1. Source freely-licensed texture maps for the Sun, 8 planets, and
     (where reasonably available) major moons — e.g. NASA/JPL's Solar
     System texture sets, USGS Astrogeology, or Björn Jónsson's maps;
     confirm redistribution license before bundling.
  2. Decide bundling vs. runtime fetch: bundling scaled-down (~1-2K)
     textures under the repo (mirroring how `kernels/` bundles its own
     data, with a similar provenance note) keeps the app
     offline-capable; a CDN fetch keeps the repo lighter. Pick one and
     document the tradeoff.
  3. Wire per-body texture loading into `ensureMarkers()`: swap the flat
     `MeshStandardMaterial({color})` for `{map: texture}` via
     `THREE.TextureLoader`, loaded once per body slug, falling back to
     today's flat-color sphere for any body with no known texture
     (custom/Horizons-fetched bodies, minor planets, unresolved
     satellites, ...).
  4. Handle the Sun specially — it's currently rendered emissive
     (`emissiveIntensity: 1.2`) rather than lit like the planets, so a
     surface albedo map alone won't look right without adjusting that.
  5. Add attribution for whichever texture set is chosen (README.md, or
     a `kernels/README.md`-style provenance note).
  6. Check whether the same `ensureMarkers()`-style code path is shared
     with other pages (`examples/browser-demo/`, the per-body templates)
     that should pick up the same treatment.

- **[#2](https://github.com/stevenstetzler/orbit-viewer/issues/2) Prefetch
  over the whole time range.** Today, `beginSession()` only probes each
  body at the initial reference epoch (`prefetchBodyProbe(..., et0)`),
  and `updateSceneForOffset()` widens a body's own prefetched interval
  one epoch at a time as the slider scrubs
  (`ensureBodyCoverage(b, et, et, ...)`) — so every new part of the
  timeline the user scrubs to costs a fresh network round trip. Per the
  two-step routine described in the issue:
  1. Once the initial scene render (`updateSceneForOffset(0)`) completes,
     kick off a background pass calling `ensureBodyCoverage(b,
     kernelStartEt, kernelStopEt, ...)` for every non-fully-prefetched
     body, covering the entire 1900-2100 session range rather than just
     the currently-viewed epoch.
  2. Make it non-blocking, and check `ensureBodyCoverage()` for
     duplicate in-flight requests when the user scrubs to an epoch the
     background pass hasn't reached yet — dedupe/join rather than
     double-fetch the same range.
  3. Surface background-prefetch progress in the existing status log (or
     a small indicator) so ongoing network activity after the initial
     load reads as expected, not as something stuck.
  4. Validate the actual byte cost of a full 1900-2100 prefetch for the
     default body set (`RangeCache`'s block-coalescing in
     `scripts/rangeCache.mjs` already has a measurement table for a
     narrower query to extend this from) before deciding whether it
     should run in one shot per body or be chunked/throttled for slow
     connections.
  5. Note whether this applies only to `solar-system/index.html` or
     should extend to other pages using the same probe-then-widen
     pattern (`examples/browser-demo/`, per-body templates).
  6. Abort the background prefetch if the user navigates away or loads a
     different kernel mid-flight, so it doesn't leak requests into a
     session no longer on screen.

## Browser demo (`examples/browser-demo/`)

- **Trajectory-mode resolution for very-high-loop-count bodies.**
  Each body's arc now gets a sample budget scaled to how many loops
  its window implies (`arcSampleBudget()`, ~24 points/loop target),
  but it's still clamped to a 2000-sample ceiling for cost reasons —
  Neptune viewed from Earth in Sidereal mode (~164 implied loops)
  still lands around ~12 points/loop, short of the target density. A
  higher ceiling, or a genuinely adaptive/simplification-based scheme
  (sample densely then simplify, rather than a fixed per-body point
  budget) would improve this further, at real added render/compute
  cost — see the "Trajectory" section of `examples/browser-demo/README.md`
  for the measured numbers this trade-off is based on.
- **Saturn's irregular moons** (`sat456.bsp`, ~44 bodies, recently
  given real names) aren't usable in precise mode: none have known
  real radii in `pck00011.tpc`, so they can't be rendered to scale the
  way the catalogued `sat441.bsp` moons are. Revisit if a future PCK
  release adds radii for them.
- **Custom kernel loading doesn't chain through a second custom
  kernel with insufficient coverage of its own.** "Add a custom
  kernel" (see `examples/browser-demo/README.md`) registers a custom
  kernel's segments into the same pool the primary kernel uses, so a
  custom body can be positioned relative to (or used as Center for)
  any of the ten built-in bodies -- including a heliocentric
  (Sun-relative) or other externally-anchored small-body/spacecraft
  kernel, a chain spanning multiple hops fully contained within the
  custom file itself, and a custom kernel whose own valid interval is
  nowhere near "now" (`prefetchCustomBody()`'s hop-by-hop fallback,
  `examples/browser-demo/index.html`, widening whichever already-known
  body's own coverage the chain resolves through via
  `ensureBodyCoverage()`, not just probing it once at session start).
  What's *not* handled: a custom body expressed relative to a body
  that's itself a *different* custom-kernel body whose own already-
  prefetched interval doesn't cover the window needed -- that fails to
  prefetch with a clear error rather than being silently stitched
  together (custom bodies have no `.remote` to widen further once
  loaded, by design -- their own interval is fetched in full up front).
