# Browser demo: DE440 in three.js, loaded lazily

A real, live demo of `openRemoteSpk()` (see `docs/lazy-loading.md`)
running in an actual browser: pick a real `.bsp` SPK kernel from disk,
and spiceJS reads only the byte ranges it actually needs out of it --
via `File.slice()`, never a full upload or a full parse -- to plot
eleven Solar System bodies over a &plusmn;30 day window around *now*,
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

Download a real SPK kernel from NAIF, e.g.:

- [`de440s.bsp`](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440s.bsp)
  (~32 MB, covers 1849-2150 -- the easy one to start with)
- [`de440.bsp`](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440.bsp)
  (~114 MB, covers roughly 1550-2650)

Either works identically from the demo's point of view -- the whole
point of `openRemoteSpk()` is that the file's total size barely
matters, since only a small fraction of it around *now* is ever
actually read. `crossval/dss17.bsp` (a tiny 7 KB kernel committed to
this repo) also loads, but it only has ground-station segments, not
planetary ones, so nothing will plot -- use it only to sanity-check
that the page loads without errors.

## What it does

1. Picks up the file via `<input type="file">` -- the browser keeps
   the actual bytes local; nothing is uploaded anywhere.
2. Loads `kernels/naif0012.tls` (leapseconds) via `load()` to get a
   real UTC "now" reference epoch through `str2et()`.
3. Opens the picked file with `openRemoteSpk(file.name, { fileLength:
   file.size, resolveRange })`, where `resolveRange` is just
   `file.slice(start, end).arrayBuffer()` -- the same lazy-fetch
   machinery `docs/lazy-loading.md` describes for a real network URL,
   here reading from local disk instead of over HTTP.
4. Calls `prefetch({ target, observer: 0, etStart, etEnd })` once per
   body for the &plusmn;30 day window, then evaluates ordinary
   `spkez()` at 61 sample epochs to draw each body's orbit arc, plus
   its live position as the time slider moves.
5. Logs how many range reads it took and how many total bytes were
   actually touched, out of the file's real size -- so you can see the
   lazy-loading savings live, not just in `perf/report.md`.

## Bodies shown

Sun (10), Mercury (1), Venus (2), Earth (399), Moon (301), Mars (4),
Jupiter (5), Saturn (6), Uranus (7), Neptune (8), Pluto (9) -- outer
bodies (Mercury through Pluto barycenters, except Earth/Moon
themselves) use their barycenter IDs, matching how DE440 actually
stores them (see `perf/README.md`).

## Notes

- Positions are converted from km to AU and then to a fixed scene
  scale (4.2 units/AU) so the whole range from Mercury to Pluto is
  visible at once; this is a display choice, not something spiceJS
  itself does.
- three.js is loaded from a CDN (unpkg, pinned to 0.169.0) via an
  import map -- swap that for a local copy if you need this to work
  fully offline.
- If a browser's devtools console shows a CORS error while trying to
  fetch a `.bsp` directly from `naif.jpl.nasa.gov` by URL: that's
  expected and unrelated to this demo -- NAIF's server doesn't send
  `Access-Control-Allow-Origin`, so browsers can't `fetch()` it
  cross-origin. That's exactly why this demo uses a local file picker
  (no CORS involved) rather than a URL text box.
