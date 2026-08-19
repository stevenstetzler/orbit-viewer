/**
 * The catalogue of NAIF kernels this repo knows how to fetch: the two
 * text kernels bundled here directly, plus the binary SPKs that are
 * far too large to check in (7.2 GB for the satellite set alone).
 *
 * Every field below was read off the *real, live* files rather than
 * transcribed from NAIF's documentation: `bytes` from a `HEAD`
 * request, and `targets`/`segmentTypes`/`etCoverage` by walking each
 * file's actual DAF summary records over HTTP range requests with
 * spiceJS's own lazy loader (a couple of 64 KiB reads per file, even
 * for the 2 GB ones). Re-derive with `node scripts/inspect-spk.mjs`.
 *
 * Plain ESM with no imports, so this is equally usable from a Node
 * script (`scripts/download-spk.mjs`, `scripts/serve-example.mjs`) and
 * from the browser demo's own module graph.
 */

export const NAIF_BASE = 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/';

/** Seconds past J2000 TDB -> approximate calendar year, for human-readable coverage. */
export function etToApproxYear(et) {
  return Math.round(2000 + et / 31557600);
}

/**
 * Every kernel, keyed by a short id.
 *
 * - `group`: 'lsk' | 'pck' | 'planetary' | 'satellite'
 * - `bundled`: checked into this repo under `kernels/` (small text kernels only)
 * - `bytes`: exact Content-Length, verified against the live server
 * - `targets`: NAIF IDs of every body the file provides, each with the
 *   center it's given relative to. Bodies listed as `rel 0`/`rel 3` are
 *   the file's own copy of the planetary chain it needs to reach the
 *   Solar System Barycenter -- meaning each satellite SPK below is
 *   *self-sufficient* for its own moons: you do not need de440 loaded
 *   alongside it to get a moon's state relative to the SSB.
 * - `unsupported`: segment types present that spiceJS can't evaluate
 *   yet (see SUPPORTED_TYPES in src/spk.js)
 */
export const KERNELS = {
  // --- Text kernels: small enough to check in, and already are. ------
  naif0012: {
    group: 'lsk',
    bundled: true,
    file: 'naif0012.tls',
    url: `${NAIF_BASE}lsk/naif0012.tls`,
    bytes: 5257,
    description: 'Leapseconds (LSK) -- required for str2et()/et2utc().',
  },
  pck00011: {
    group: 'pck',
    bundled: true,
    file: 'pck00011.tpc',
    url: `${NAIF_BASE}pck/pck00011.tpc`,
    bytes: 131226,
    description: 'Generic text PCK -- body radii (BODY<id>_RADII) and IAU_<BODY> orientation constants.',
  },

  // --- Planetary ephemerides ---------------------------------------
  de440s: {
    group: 'planetary',
    file: 'de440s.bsp',
    url: `${NAIF_BASE}spk/planets/de440s.bsp`,
    bytes: 32726016,
    description: 'DE440 "short": Sun, planets and barycenters, 1849-2150. The easy one to start with.',
    segmentTypes: [2],
    etCoverage: [-4.7658528e9, 4.7356704e9],
    targets: [
      { id: 1, center: 0, name: 'Mercury barycenter' }, { id: 2, center: 0, name: 'Venus barycenter' },
      { id: 3, center: 0, name: 'Earth-Moon barycenter' }, { id: 4, center: 0, name: 'Mars barycenter' },
      { id: 5, center: 0, name: 'Jupiter barycenter' }, { id: 6, center: 0, name: 'Saturn barycenter' },
      { id: 7, center: 0, name: 'Uranus barycenter' }, { id: 8, center: 0, name: 'Neptune barycenter' },
      { id: 9, center: 0, name: 'Pluto barycenter' }, { id: 10, center: 0, name: 'Sun' },
      { id: 199, center: 1, name: 'Mercury' }, { id: 299, center: 2, name: 'Venus' },
      { id: 301, center: 3, name: 'Moon' }, { id: 399, center: 3, name: 'Earth' },
    ],
  },
  de440: {
    group: 'planetary',
    file: 'de440.bsp',
    url: `${NAIF_BASE}spk/planets/de440.bsp`,
    bytes: 119799808,
    description: 'DE440 full: Sun, planets and barycenters, roughly 1550-2650.',
    segmentTypes: [2],
    etCoverage: [-1.4200747e10, 2.0514403e10],
    targets: [
      { id: 1, center: 0, name: 'Mercury barycenter' }, { id: 2, center: 0, name: 'Venus barycenter' },
      { id: 3, center: 0, name: 'Earth-Moon barycenter' }, { id: 4, center: 0, name: 'Mars barycenter' },
      { id: 5, center: 0, name: 'Jupiter barycenter' }, { id: 6, center: 0, name: 'Saturn barycenter' },
      { id: 7, center: 0, name: 'Uranus barycenter' }, { id: 8, center: 0, name: 'Neptune barycenter' },
      { id: 9, center: 0, name: 'Pluto barycenter' }, { id: 10, center: 0, name: 'Sun' },
      { id: 199, center: 1, name: 'Mercury' }, { id: 299, center: 2, name: 'Venus' },
      { id: 301, center: 3, name: 'Moon' }, { id: 399, center: 3, name: 'Earth' },
    ],
  },

  // --- Satellite ephemerides ---------------------------------------
  // Sizes here are the reason this repo has a range-caching proxy
  // (scripts/serve-example.mjs) rather than only a plain downloader:
  // these eight total 7.23 GB, but a single body over a single month
  // touches well under 1 MB of any of them.
  mar099: {
    group: 'satellite',
    file: 'mar099.bsp',
    url: `${NAIF_BASE}spk/satellites/mar099.bsp`,
    bytes: 1227574272,
    description: 'Mars system: Phobos and Deimos.',
    segmentTypes: [2],
    etCoverage: [-1.262e10, 1.893e10],
    targets: [
      { id: 3, center: 0, name: 'Earth-Moon barycenter' }, { id: 4, center: 0, name: 'Mars barycenter' },
      { id: 10, center: 0, name: 'Sun' }, { id: 399, center: 3, name: 'Earth' },
      { id: 401, center: 4, name: 'Phobos' }, { id: 402, center: 4, name: 'Deimos' },
      { id: 499, center: 4, name: 'Mars' },
    ],
  },
  jup365: {
    group: 'satellite',
    file: 'jup365.bsp',
    url: `${NAIF_BASE}spk/satellites/jup365.bsp`,
    bytes: 1136581632,
    description: 'Jupiter system: the four Galilean moons plus Amalthea, Thebe, Adrastea and Metis.',
    segmentTypes: [2],
    etCoverage: [-1.262e10, 6.312e9],
    targets: [
      { id: 3, center: 0, name: 'Earth-Moon barycenter' }, { id: 5, center: 0, name: 'Jupiter barycenter' },
      { id: 10, center: 0, name: 'Sun' }, { id: 399, center: 3, name: 'Earth' },
      { id: 501, center: 5, name: 'Io' }, { id: 502, center: 5, name: 'Europa' },
      { id: 503, center: 5, name: 'Ganymede' }, { id: 504, center: 5, name: 'Callisto' },
      { id: 505, center: 5, name: 'Amalthea' }, { id: 514, center: 5, name: 'Thebe' },
      { id: 515, center: 5, name: 'Adrastea' }, { id: 516, center: 5, name: 'Metis' },
      { id: 599, center: 5, name: 'Jupiter' },
    ],
  },
  sat480: {
    group: 'satellite',
    file: 'sat480.bsp',
    url: `${NAIF_BASE}spk/satellites/sat480.bsp`,
    bytes: 12621824,
    // Worth knowing before you reach for this one: despite the name it
    // carries no classic Saturnian moons at all -- just Saturn itself
    // and one unnamed small body (65304), and that body's only segment
    // is type 17, which spiceJS does not evaluate yet. Verified by
    // reading the real file's summary records, not assumed from the
    // filename. For Titan/Enceladus/etc. you want a different sat*.bsp.
    description: 'Saturn: the planet itself, plus one small body (65304) in an unsupported type-17 segment. No classic moons.',
    segmentTypes: [2, 17],
    unsupported: [{ type: 17, targets: [65304], note: 'equinoctial elements -- not in src/spk.js SUPPORTED_TYPES' }],
    etCoverage: [-1.578e9, 1.578e9],
    targets: [
      { id: 3, center: 0, name: 'Earth-Moon barycenter' }, { id: 6, center: 0, name: 'Saturn barycenter' },
      { id: 10, center: 0, name: 'Sun' }, { id: 399, center: 3, name: 'Earth' },
      { id: 699, center: 6, name: 'Saturn' },
      { id: 65304, center: 699, name: '65304 (unnamed small body)', unsupported: true },
    ],
  },
  'ura184-1': {
    group: 'satellite',
    file: 'ura184_part-1.bsp',
    url: `${NAIF_BASE}spk/satellites/ura184_part-1.bsp`,
    bytes: 2062529536,
    description: 'Uranus system, part 1: the inner small moons Cordelia through Portia.',
    segmentTypes: [2],
    etCoverage: [-3.156e9, 3.158e9],
    targets: [
      { id: 3, center: 0, name: 'Earth-Moon barycenter' }, { id: 7, center: 0, name: 'Uranus barycenter' },
      { id: 10, center: 0, name: 'Sun' }, { id: 399, center: 3, name: 'Earth' },
      { id: 706, center: 7, name: 'Cordelia' }, { id: 707, center: 7, name: 'Ophelia' },
      { id: 708, center: 7, name: 'Bianca' }, { id: 709, center: 7, name: 'Cressida' },
      { id: 710, center: 7, name: 'Desdemona' }, { id: 711, center: 7, name: 'Juliet' },
      { id: 712, center: 7, name: 'Portia' }, { id: 799, center: 7, name: 'Uranus' },
    ],
  },
  'ura184-2': {
    group: 'satellite',
    file: 'ura184_part-2.bsp',
    url: `${NAIF_BASE}spk/satellites/ura184_part-2.bsp`,
    bytes: 2062529536,
    description: 'Uranus system, part 2: Rosalind, Belinda, Puck, Perdita, Mab, Cupid.',
    segmentTypes: [2],
    etCoverage: [-3.156e9, 3.158e9],
    targets: [
      { id: 3, center: 0, name: 'Earth-Moon barycenter' }, { id: 7, center: 0, name: 'Uranus barycenter' },
      { id: 10, center: 0, name: 'Sun' }, { id: 399, center: 3, name: 'Earth' },
      { id: 713, center: 7, name: 'Rosalind' }, { id: 714, center: 7, name: 'Belinda' },
      { id: 715, center: 7, name: 'Puck' }, { id: 725, center: 7, name: 'Perdita' },
      { id: 726, center: 7, name: 'Mab' }, { id: 727, center: 7, name: 'Cupid' },
      { id: 799, center: 7, name: 'Uranus' }, { id: 75052, center: 7, name: '75052 (unnamed)' },
    ],
  },
  'ura184-3': {
    group: 'satellite',
    file: 'ura184_part-3.bsp',
    url: `${NAIF_BASE}spk/satellites/ura184_part-3.bsp`,
    bytes: 386885632,
    // The one to reach for first: it has the five *major* Uranian
    // moons, unlike parts 1-2 which are small inner/irregular bodies.
    // Also the file whose scattered DAF summary-record layout exposed
    // the structural-discovery over-fetch fixed in src/lazy/prefetch.js.
    description: 'Uranus system, part 3: the five major moons (Ariel, Umbriel, Titania, Oberon, Miranda) plus the irregulars.',
    segmentTypes: [2],
    etCoverage: [-1.262e10, 1.262e10],
    targets: [
      { id: 3, center: 0, name: 'Earth-Moon barycenter' }, { id: 7, center: 0, name: 'Uranus barycenter' },
      { id: 10, center: 0, name: 'Sun' }, { id: 399, center: 3, name: 'Earth' },
      { id: 701, center: 7, name: 'Ariel' }, { id: 702, center: 7, name: 'Umbriel' },
      { id: 703, center: 7, name: 'Titania' }, { id: 704, center: 7, name: 'Oberon' },
      { id: 705, center: 7, name: 'Miranda' }, { id: 716, center: 7, name: 'Caliban' },
      { id: 717, center: 7, name: 'Sycorax' }, { id: 718, center: 7, name: 'Prospero' },
      { id: 719, center: 7, name: 'Setebos' }, { id: 720, center: 7, name: 'Stephano' },
      { id: 721, center: 7, name: 'Trinculo' }, { id: 722, center: 7, name: 'Francisco' },
      { id: 723, center: 7, name: 'Margaret' }, { id: 724, center: 7, name: 'Ferdinand' },
      { id: 799, center: 7, name: 'Uranus' }, { id: 75051, center: 7, name: '75051 (unnamed)' },
    ],
  },
  nep105: {
    group: 'satellite',
    file: 'nep105.bsp',
    url: `${NAIF_BASE}spk/satellites/nep105.bsp`,
    bytes: 210456576,
    // Note: Nereid (802), *not* Triton (801) -- confirmed by reading
    // the real file's summary records. Triton lives in a different
    // nep*.bsp solution.
    description: 'Neptune system: Nereid (802) and Neptune itself. Does not contain Triton.',
    segmentTypes: [2],
    etCoverage: [-1.262e10, 1.262e10],
    targets: [
      { id: 3, center: 0, name: 'Earth-Moon barycenter' }, { id: 8, center: 0, name: 'Neptune barycenter' },
      { id: 10, center: 0, name: 'Sun' }, { id: 399, center: 3, name: 'Earth' },
      { id: 802, center: 8, name: 'Nereid' }, { id: 899, center: 8, name: 'Neptune' },
    ],
  },
  plu060: {
    group: 'satellite',
    file: 'plu060.bsp',
    url: `${NAIF_BASE}spk/satellites/plu060.bsp`,
    bytes: 135207936,
    description: 'Pluto system: Charon, Nix, Hydra, Kerberos, Styx, and Pluto itself.',
    segmentTypes: [2],
    etCoverage: [-6.311e9, 6.311e9],
    targets: [
      { id: 3, center: 0, name: 'Earth-Moon barycenter' }, { id: 9, center: 0, name: 'Pluto barycenter' },
      { id: 10, center: 0, name: 'Sun' }, { id: 399, center: 3, name: 'Earth' },
      { id: 901, center: 9, name: 'Charon' }, { id: 902, center: 9, name: 'Nix' },
      { id: 903, center: 9, name: 'Hydra' }, { id: 904, center: 9, name: 'Kerberos' },
      { id: 905, center: 9, name: 'Styx' }, { id: 999, center: 9, name: 'Pluto' },
    ],
  },
};

/** Kernel ids in a stable, human-sensible order (small/essential first). */
export const KERNEL_IDS = Object.keys(KERNELS);

/** @returns {string[]} ids whose `group` is any of the given groups. */
export function kernelIdsByGroup(...groups) {
  return KERNEL_IDS.filter((id) => groups.includes(KERNELS[id].group));
}

/** Binary SPKs only -- what `npm run download-spk` and the range proxy deal in. */
export const SPK_IDS = kernelIdsByGroup('planetary', 'satellite');

/** Total bytes for a set of kernel ids -- used to warn before a very large download. */
export function totalBytes(ids) {
  return ids.reduce((sum, id) => sum + (KERNELS[id]?.bytes ?? 0), 0);
}

export function formatBytes(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} kB`;
  return `${n} B`;
}

/** Resolve a kernel id, or a bare filename like "de440.bsp", to its entry. Throws a listing-aware error otherwise. */
export function resolveKernel(idOrFile) {
  if (KERNELS[idOrFile]) return { id: idOrFile, ...KERNELS[idOrFile] };
  const byFile = KERNEL_IDS.find((id) => KERNELS[id].file === idOrFile);
  if (byFile) return { id: byFile, ...KERNELS[byFile] };
  throw new Error(`Unknown kernel "${idOrFile}". Known ids: ${KERNEL_IDS.join(', ')}`);
}
