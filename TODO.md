# TODO

Things discussed or scoped but not implemented yet. Everything here
fails today with a clear, catchable error — never a silently wrong
answer — unless noted otherwise. See also
[spiceJS's own TODO.md](https://github.com/stevenstetzler/spiceJS/blob/main/TODO.md)
for gaps in the underlying library this viewer depends on.

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
