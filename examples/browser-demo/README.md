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
   body's orbit arc, plus its live position as the "Reference epoch"
   slider moves.
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
- Clicking "Try loading it directly" logs a browser-level network
  error to devtools (something like `net::ERR_CONNECTION_RESET` or a
  CORS policy warning, depending on your network) in addition to the
  page's own explanation in the status log -- that's the browser
  itself reporting the blocked request, not a bug in this demo.
