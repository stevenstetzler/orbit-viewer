# orbit-viewer

This is a solar system / orbit viewer tool based on the DE440 planetary ephemeris. It relies on the [spiceJS](https://github.com/stevenstetzler/spiceJS) library for reading and using [NAIF SPK](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/req/spk.html) files.

This work is inspired / derivative of other orbit viewer tools and software created by:
- The [Solar System Dynamics](https://ssd.jpl.nasa.gov/ov/) group at the Jet Propulsion Lab
- [The Minor Planet Center](https://data.minorplanetcenter.net/db_search/show_orbit?utf8=%E2%9C%93&number=1&designation=&name=Ceres&epoch=2025-11-21.0&peri=73.2997407&m=231.53981&node=80.2496372&incl=10.5878873&e=0.079576366&a=2.76561565562755&commit=Interactive+Orbit+Sketch)
- The [NAIF Cosmographia](https://naif.jpl.nasa.gov/naif/cosmographia.html) team

among others.

## Install and run

```sh
git clone https://github.com/stevenstetzler/orbit-viewer.git
cd orbit-viewer
npm install             # pulls in spicejs (github:stevenstetzler/spiceJS)
npm run serve-example   # http://localhost:8080
```

Then open **http://localhost:8080/examples/browser-demo/**. This
serves the repo *and* a local proxy that streams NAIF kernels on
demand via HTTP range requests (so even a multi-gigabyte kernel costs
a few hundred KB to open) — the demo detects the proxy and auto-loads
`de440s` through it, so the page opens already showing the live Solar
System, no click needed.

The demo plots ten Solar System bodies with three.js: explicit view
controls (Center, Frame, Rotating, Orbit, Period, Position scale,
Radius scale) and per-body actions (Look, From) drive the whole-system
view, Command+Click a body for a true-to-scale single-body-and-its-moons
view, or load your own `.bsp` -- or fetch one live from
[JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) by name or
designation -- to add extra bodies (asteroids, comets, spacecraft,
even unbound flyby/escape trajectories) onto the live session, each
rendered with the same real orbit-ellipse (or, if unbound, open-arc)
treatment as the ten built-in bodies. See
[`examples/browser-demo/README.md`](examples/browser-demo/README.md)
for the full feature rundown.

Several smaller, curated pages built on top of the same lazy-loading
machinery -- each a fixed configuration rather than the full explorer's
every-control-exposed design, all bounded to `de440s`'s 1900-2100
range. Every "Bodies shown" row gets a **Look** button (re-aims the
camera at that body, tracking it as the reference epoch scrubs); the
two `*/trajectory/` pages also get a **From** button per row (changes
the observer everything else is positioned relative to):

| Page | Shows |
| --- | --- |
| `/solar-system/` | The ten built-in bodies, viewed from the Sun, orbit ellipses only. Includes a JPL Horizons search box for adding asteroids/comets, always fetched over the full 1900-2100 range. |
| `/solar-system/trajectory/` | The same view, but every orbit line is a real sampled trajectory instead of an idealized ellipse, and View From lets you re-center on any displayed body (not just the Sun). Supports uploading a local `.bsp` to add its own trajectory. |
| `/<body>/` (e.g. `/earth/`, `/jupiter/`) | A true-to-scale (Linear position, Linear radius) view of one body and its known natural satellites, viewed from and looking at that body. |
| `/<body>/trajectory/` | The same single-body system, with each satellite's orbit line a real sampled trajectory, View From to re-center on any satellite (the central body's own line then mirrors whichever satellite is the observer), and support for adding a custom trajectory (e.g. a spacecraft) to that system. |
| `/close-approach/` | Earth + Moon, with a sortable, searchable table (designation, distance in lunar distances, date, H, diameter) of every real close approach within 2 lunar distances since 1900, from [JPL's Close-Approach Data API](https://ssd-api.jpl.nasa.gov/doc/cad.html). Click a row to jump the reference epoch to that approach (restricting the epoch slider to the object's own &plusmn;1-day fetched span) and fetch its real trajectory from Horizons -- only one such object is shown at a time, so selecting a new one replaces whichever was there before. |

`<body>` is any of `sun`, `mercury`, `venus`, `earth`, `mars`,
`jupiter`, `saturn`, `uranus`, `neptune`, `pluto` -- see
`examples/shared/bodies.js`'s `bodySlug()`. These page *shapes* share
their non-UI logic (scale math, orbit/trajectory sampling, prefetch,
satellite resolution, the Horizons client) via plain ES modules under
`examples/shared/` -- see [`examples/shared/api.md`](examples/shared/api.md)
for what's in them -- imported by each page rather than copy-pasted --
`examples/browser-demo/index.html` itself stays a single self-contained
file, deliberately not refactored to share this code.

Downloading a whole kernel for offline use, instead of streaming
byte ranges through the proxy above:

```sh
npm run download-spk -- --list  # what's available, and what's already here
npm run download-spk -- de440s
```

See [`kernels/README.md`](kernels/README.md) for the full kernel
catalogue, real sizes, and caveats found by reading the actual files
(e.g. Saturn's moons being split across two NAIF kernels). See
[`deploy.md`](deploy.md) for running this for other people (a real
production deployment, reverse-proxy config, subpath deployment) and
live-measured bandwidth per view.

## Documentation

| Topic | Where |
| --- | --- |
| Install, run, and deploy — plus live-measured bandwidth per view | [`deploy.md`](deploy.md) |
| Code structure — the two layers here and how they fit together | [`modules.md`](modules.md) |
| Kernel catalogue, sizes, caveats | [`kernels/README.md`](kernels/README.md) |
| Browser demo — full feature rundown | [`examples/browser-demo/README.md`](examples/browser-demo/README.md) |
| Visualization API — the shared modules behind the curated demo pages | [`examples/shared/api.md`](examples/shared/api.md) |
| Not yet implemented | [`TODO.md`](TODO.md) |

For the underlying SPICE library this viewer is built on — kernel
reading, time/frame conversion, trajectory evaluation — see
[spiceJS](https://github.com/stevenstetzler/spiceJS) and its own docs.

## Acknowledgements

The [NAIF SPICE Toolkit](https://naif.jpl.nasa.gov/naif/toolkit.html)
and its [unofficial GitHub mirror](https://github.com/OpenSpace/Spice)
were used as the behavioral reference for [spiceJS](https://github.com/stevenstetzler/spiceJS),
the library this viewer depends on. `kernels/naif0012.tls` is NAIF's
own publicly distributed leapseconds kernel, included here as a
bundled fixture.
