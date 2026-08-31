# Kernels

`naif0012.tls`, `pck00011.tpc`, and `gm_de440.tpc` are small text
kernels checked in directly (leapseconds, planetary orientation
constants, and GM mass parameters — used throughout the viewer for
time conversion, body radii, and orbital-period sizing).

Everything else — the binary SPK ephemerides — is fetched from NAIF on
demand. `sources.mjs` is the catalogue: URLs, exact sizes, and the full
list of bodies each file provides. Those fields were read off the *real*
files (`npm run inspect-spk -- --check` re-verifies them against the
live server), not transcribed from documentation.

## Why nothing binary is checked in

The ten SPKs in the catalogue total **8.0 GB**:

| kernel | size | contents |
| --- | --- | --- |
| `de440s` | 32.7 MB | Sun, planets, barycenters, 1849-2150 |
| `de440` | 119.8 MB | Sun, planets, barycenters, ~1550-2650 |
| `mar099` | 1.23 GB | Phobos, Deimos |
| `jup365` | 1.14 GB | Io, Europa, Ganymede, Callisto + 4 inner moons |
| `sat441` | 661.6 MB | Mimas..Phoebe + Helene, Telesto, Calypso, Methone, Polydeuces |
| `ura184-1` | 2.06 GB | Uranus inner small moons (Cordelia..Portia) |
| `ura184-2` | 2.06 GB | Uranus: Rosalind, Belinda, Puck, Perdita, Mab, Cupid |
| `ura184-3` | 386.9 MB | Uranus major moons (Ariel, Umbriel, Titania, Oberon, Miranda) |
| `nep105` | 210.5 MB | Nereid + Neptune (**not** Triton) |
| `plu060` | 135.2 MB | Charon, Nix, Hydra, Kerberos, Styx, Pluto |

A single body over a single month touches well under a megabyte of any
of them. So the default path fetches byte ranges, not files -- that's
what `spicejs`'s `openRemoteSpk()` is for.

## Getting kernel data

**Preferred -- no download at all:**

```sh
npm run serve-example
```

Serves the repo at <http://localhost:8080> *and* proxies every kernel in
the catalogue at `/kernels/remote/<file>.bsp`, honouring HTTP Range
requests and caching what it fetches into `cache/` as a sparse file. The
browser demo detects this automatically and offers one-click loading.
Measured on the real `de440s.bsp` for the demo's own startup query: 23
ranged reads, **1.47 MB fetched of 32.7 MB**, and a second run fetches
nothing at all.

Because it's same-origin, this also sidesteps the fact that
`naif.jpl.nasa.gov` sends no `Access-Control-Allow-Origin` header --
a browser can never `fetch()` it cross-origin directly.

**When you want a whole file** (offline use, or handing it to spiceypy
or CSPICE, which can't do ranged reads):

```sh
npm run download-spk -- --list        # what's available / already here
npm run download-spk -- de440s        # one kernel
npm run download-spk -- --group satellite --yes
```

Downloads land in `cache/` too, and resume if interrupted.

## `cache/`

Gitignored. Holds both whole downloads and the proxy's sparse
range-cache (each `<file>.bsp` paired with a `<file>.bsp.blocks` bitmap
recording which blocks are real). Sparse files mean the apparent size is
the full kernel size while actual disk use is only what was fetched --
in one measured session, 4.95 GB of apparent kernels cost **22 MB** of
real disk. Delete the directory any time; it all refetches on demand.

`cache/horizons/` is a separate, much smaller cache: one whole SPK per
small-body/comet fetched from [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/)
through the demo's own "Fetch from JPL Horizons" (`<spkid>.bsp` plus a
`<spkid>.json` sidecar recording the date range it covers) -- see
[`examples/browser-demo/README.md`](../examples/browser-demo/README.md#fetching-a-kernel-from-jpl-horizons)
for how a re-request that only partly overlaps what's cached gets
merged into a single wider re-fetch instead of a second, separate file.

## Caveats found by reading the real files

- **Saturn's moons are split across two NAIF files, and only one is in
  this catalogue.** `sat441.bsp` (here) has the nine classical named
  moons plus five small inner/Lagrangian ones, all with real
  `BODY<id>_RADII` data. `sat456.bsp` (not catalogued) has ~44
  *irregular* outer moons instead -- recently given real names (2025),
  replacing provisional `S/2004_S_xx` designations -- but none of them
  have known real radii in `pck00011.tpc`, so they're not usable the
  same way. An older `sat480.bsp` (superseded here, see git history)
  had neither: just Saturn itself and one small body in an unsupported
  type-17 segment.
- **`nep105` has Nereid (802), not Triton (801).**
- **Each satellite SPK is self-sufficient for chaining.** They all carry
  their own copies of the Sun, Earth, EMB and their planet's barycenter
  relative to the SSB, so you can get a moon's state relative to the SSB
  from that one file, without `de440` loaded alongside it.
