/**
 * Dev server for examples/browser-demo (and the smaller curated pages
 * built on the same lazy-loading machinery -- /solar-system/,
 * /<body>/, etc., see the root README's own table) -- static files
 * plus a *range-caching kernel proxy*, which is what makes any of them
 * usable against multi-gigabyte kernels without downloading them first.
 *
 *   npm run serve-example              # http://localhost:8080
 *   npm run serve-example -- --port 9000
 *   npm run serve-example -- --block-bytes 262144
 *
 * What it serves:
 *
 * 1. The repo, statically, from `/` -- so the demo page at
 *    /examples/browser-demo/ can import ../../src/browser.js and fetch
 *    ../../kernels/naif0012.tls as ordinary same-origin URLs. This also
 *    covers /solar-system/ and /solar-system/trajectory/ (real, literal
 *    files on disk) with no further routing needed -- but NOT /<body>/
 *    or /<body>/trajectory/, which have no literal file of their own
 *    (see matchBodyRoute() below, matched explicitly before falling
 *    through to this).
 *
 * 2. `/kernels/remote/<file>.bsp` -- a proxy in front of NAIF that
 *    honours HTTP Range requests and caches what it fetches into a
 *    sparse local file (see rangeCache.mjs). This solves two problems
 *    at once:
 *
 *    - **CORS.** naif.jpl.nasa.gov sends no Access-Control-Allow-Origin
 *      on any response, so a browser can never `fetch()` it
 *      cross-origin, cached or not. Through this proxy the kernel is
 *      same-origin, so `openRemoteSpk('/kernels/remote/de440.bsp')`
 *      just works -- no download step, no file picker.
 *    - **Size.** Nothing is downloaded ahead of time. The browser asks
 *      for the few hundred KB its query actually needs, the proxy
 *      fetches only the blocks covering those bytes, and they stay on
 *      disk for next time. A 2 GB kernel costs a couple of MB to use.
 *
 * 3. `/horizons/resolve?sstr=...` and `/horizons/spk?spkid=...&start=
 *    ...&stop=...` -- the two-step small-body lookup (see
 *    horizonsSpk.mjs): `resolve` queries JPL's Small-Body Database to
 *    turn whatever the user typed into an exact SPK-ID (or an
 *    ambiguous-match list, or a not-found message, for the browser to
 *    handle), `spk` then fetches that object's trajectory SPK from
 *    Horizons and relays the raw bytes back same-origin. Same CORS
 *    reasoning as (2) above -- neither ssd-api.jpl.nasa.gov nor
 *    ssd.jpl.nasa.gov sends Access-Control-Allow-Origin. Unlike (2),
 *    `spk` *is* cached now (see handleHorizonsSpk()) -- one whole SPK
 *    per `spkid` in `kernels/cache/horizons/`, not a byte-range cache
 *    the way (2) is (a real small-body/comet SPK is small enough --
 *    tens to hundreds of KB -- that caching the whole thing per
 *    request is simpler and just as effective as ranging into it would
 *    be).
 *
 * 4. `/<body>/` and `/<body>/trajectory/` (`<body>` one of
 *    examples/shared/bodies.js's own BODIES slugs, e.g. `/earth/`,
 *    `/jupiter/trajectory/`) -- one shared template each
 *    (examples/shared/templates/body/, .../body-trajectory/) rather
 *    than one physical file per body: matchBodyRoute() below matches
 *    the URL directly (there's no literal `earth/index.html` on disk
 *    for (1) above to find), and the template's own client script
 *    reads `location.pathname` at load time to know which body it's
 *    actually showing.
 *
 * 5. `/close-approach/data` -- proxies (and, in memory, caches --
 *    see handleCloseApproachData()) JPL's Close-Approach Data API for
 *    /close-approach/'s own sortable table. Same CORS reasoning as (3).
 *
 * Block size: `--block-bytes` defaults to 64 KiB, matching the block
 * size `src/lazy/remoteFile.js` uses in the browser, so the proxy
 * fetches upstream exactly what the page asked for. Raising it trades
 * bytes for round trips at a poor rate here (measured: 1 MiB blocks
 * cost 10x the bytes to save 8 of 23 requests -- see the table on
 * DEFAULT_BLOCK_BYTES in rangeCache.mjs). Either way you pay once,
 * since the cache is permanent.
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RangeCache, parseRangeHeader, DEFAULT_BLOCK_BYTES } from './rangeCache.mjs';
import { KERNELS, SPK_IDS, formatBytes } from '../kernels/sources.mjs';
import { resolveSbdbObject, fetchHorizonsSpk } from './horizonsSpk.mjs';
import { fetchCloseApproachData } from './closeApproach.mjs';
import { BODIES, bodySlug } from '../examples/shared/bodies.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(REPO_ROOT, 'kernels', 'cache');
const HORIZONS_CACHE_DIR = path.join(CACHE_DIR, 'horizons');
const PROXY_PREFIX = '/kernels/remote/';
const HORIZONS_RESOLVE_PREFIX = '/horizons/resolve';
const HORIZONS_SPK_PREFIX = '/horizons/spk';
const CLOSE_APPROACH_DATA_PREFIX = '/close-approach/data';

// /<body>/ and /<body>/trajectory/ -- one page per BODIES entry (see
// examples/shared/bodies.js's own bodySlug()), served from a single
// shared template each rather than one physical file per body: the
// template's own client-side script reads `location.pathname` to know
// which body it's showing (see examples/shared/templates/body/index.html
// and .../body-trajectory/index.html). handleStatic() only ever resolves
// a literal path on disk, so these two routes are matched explicitly in
// the request handler below, before falling through to it.
const BODY_SLUGS = new Set(BODIES.map(bodySlug));
const BODY_TEMPLATE_PATH = path.join(REPO_ROOT, 'examples', 'shared', 'templates', 'body', 'index.html');
const BODY_TRAJECTORY_TEMPLATE_PATH = path.join(REPO_ROOT, 'examples', 'shared', 'templates', 'body-trajectory', 'index.html');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.md': 'text/markdown; charset=utf-8',
  '.tls': 'text/plain; charset=utf-8',
  '.tpc': 'text/plain; charset=utf-8',
  '.tm': 'text/plain; charset=utf-8',
  '.bsp': 'application/octet-stream',
  '.bpc': 'application/octet-stream',
};

function parseArgs(argv) {
  const opts = { port: 8080, blockBytes: DEFAULT_BLOCK_BYTES };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') opts.port = Number(argv[++i]);
    else if (argv[i] === '--block-bytes') opts.blockBytes = Number(argv[++i]);
    else if (argv[i] === '--help' || argv[i] === '-h') opts.help = true;
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  console.log('usage: npm run serve-example -- [--port 8080] [--block-bytes 1048576]');
  process.exit(0);
}

// One RangeCache per kernel, created on first request for it.
const caches = new Map();
/** Kernels reachable through the proxy, keyed by the filename in the URL. */
const proxyable = new Map(SPK_IDS.map((id) => [KERNELS[id].file, { id, ...KERNELS[id] }]));

function cacheFor(entry) {
  let cache = caches.get(entry.file);
  if (!cache) {
    cache = new RangeCache({
      url: entry.url,
      cachePath: path.join(CACHE_DIR, entry.file),
      blockBytes: opts.blockBytes,
      expectedBytes: entry.bytes,
      log: (msg) => console.log(`  [cache] ${msg}`),
    });
    caches.set(entry.file, cache);
  }
  return cache;
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'access-control-allow-origin': '*',
  });
  res.end(text);
}

/** GET/HEAD /kernels/remote/<file> -- the range-caching proxy. */
async function handleProxy(req, res, url) {
  const file = decodeURIComponent(url.pathname.slice(PROXY_PREFIX.length));
  const entry = proxyable.get(file);
  if (!entry) {
    return sendJson(res, 404, {
      error: `No such kernel: ${file}`,
      available: [...proxyable.keys()],
      hint: 'Kernels are declared in kernels/sources.mjs.',
    });
  }

  const cache = cacheFor(entry);
  try {
    await cache.open();
  } catch (err) {
    console.error(`  [proxy] ${file}: ${err.message}`);
    return sendJson(res, 502, { error: `Upstream failed: ${err.message}`, url: entry.url });
  }

  const baseHeaders = {
    'accept-ranges': 'bytes',
    'content-type': MIME['.bsp'],
    'access-control-allow-origin': '*',
    'access-control-expose-headers': 'content-range, content-length, accept-ranges',
    'cache-control': 'no-cache',
  };

  if (req.method === 'HEAD') {
    res.writeHead(200, { ...baseHeaders, 'content-length': cache.fileLength });
    return res.end();
  }

  const range = parseRangeHeader(req.headers.range, cache.fileLength);
  if (!range) {
    // No (or unusable) Range header: this would mean materialising the
    // whole kernel, which for these files is up to 2 GB. Refuse rather
    // than silently doing it -- every lazy path sends a Range, so this
    // only trips on a deliberate whole-file GET.
    return sendJson(res, 416, {
      error: 'This proxy serves ranged reads only.',
      reason: `${file} is ${formatBytes(cache.fileLength)}; a whole-file GET would download all of it.`,
      hint: `Send a Range header (openRemoteSpk() does), or run \`npm run download-spk ${entry.id}\` for a full local copy.`,
    });
  }

  const body = await cache.read(range.start, range.end);
  res.writeHead(206, {
    ...baseHeaders,
    'content-length': body.byteLength,
    'content-range': `bytes ${range.start}-${range.start + body.byteLength - 1}/${cache.fileLength}`,
  });
  res.end(body);
}

/** GET /kernels/remote/ -- what's available, and how much of each is cached. */
async function handleProxyIndex(res) {
  const entries = [...proxyable.values()].map((entry) => {
    const cache = caches.get(entry.file);
    return {
      id: entry.id,
      file: entry.file,
      url: `${PROXY_PREFIX}${entry.file}`,
      upstream: entry.url,
      bytes: entry.bytes,
      size: formatBytes(entry.bytes),
      description: entry.description,
      targets: entry.targets,
      cached: cache && cache.bitmap
        ? { blocks: cache.populatedBlocks(), fetchedBytes: cache.stats.upstreamBytes }
        : null,
    };
  });
  sendJson(res, 200, { kernels: entries });
}

/**
 * GET /horizons/resolve?sstr=<query> -- resolves a user-typed object
 * identifier to a real SPK-ID via JPL's Small-Body Database (see
 * resolveSbdbObject()). Always 200 + JSON with a `status` field for
 * any *legitimate* SBDB outcome (`found`/`ambiguous`/`not-found` --
 * see horizonsSpk.mjs's own doc comment for each shape) -- those
 * aren't proxy failures, just results the browser is expected to
 * branch on. Only a genuine transport failure (SBDB unreachable) gets
 * a non-200.
 */
async function handleHorizonsResolve(req, res, url) {
  const sstr = url.searchParams.get('sstr');
  if (!sstr) {
    return sendJson(res, 400, { error: 'sstr query parameter is required.' });
  }

  console.log(`  [horizons] resolving "${sstr}" via SBDB...`);
  let result;
  try {
    result = await resolveSbdbObject(sstr);
  } catch (err) {
    console.error(`  [horizons] resolve "${sstr}": ${err.message}`);
    return sendJson(res, 502, { error: err.message });
  }

  console.log(`  [horizons] resolve "${sstr}": ${result.status}` +
    (result.status === 'found' ? ` (spkid ${result.spkid})` : ''));
  sendJson(res, 200, result);
}

/**
 * Path pair for a `spkid`'s Horizons cache entry: the fetched SPK
 * bytes themselves (`<spkid>.bsp`) and a small sidecar JSON recording
 * the exact `[start, stop]` date-string range actually requested to
 * produce them -- Horizons' SPK response carries no such metadata
 * itself, only "here's an SPK," so this is the only record of what it
 * covers. `start`/`stop` are always `YYYY-MM-DD` (the browser's own
 * `<input type="date">` fields guarantee this, per the HTML spec), so
 * they sort chronologically as plain strings -- no date parsing needed
 * anywhere in this cache.
 */
function horizonsCachePaths(spkid) {
  const safeId = String(spkid).replace(/[^A-Za-z0-9_-]/g, '_') || 'unknown';
  return {
    bsp: path.join(HORIZONS_CACHE_DIR, `${safeId}.bsp`),
    meta: path.join(HORIZONS_CACHE_DIR, `${safeId}.json`),
  };
}

/** `{ bytes, start, stop }` for `spkid`'s cached SPK, or `null` if there isn't one (or it's incomplete/corrupt -- treated the same as no cache, not an error). */
async function readHorizonsCache(spkid) {
  const { bsp, meta } = horizonsCachePaths(spkid);
  try {
    const [bytes, metaRaw] = await Promise.all([fs.readFile(bsp), fs.readFile(meta, 'utf8')]);
    const { start, stop } = JSON.parse(metaRaw);
    if (typeof start !== 'string' || typeof stop !== 'string') return null;
    return { bytes, start, stop };
  } catch {
    return null;
  }
}

async function writeHorizonsCache(spkid, bytes, start, stop) {
  const { bsp, meta } = horizonsCachePaths(spkid);
  await fs.mkdir(HORIZONS_CACHE_DIR, { recursive: true });
  await fs.writeFile(bsp, bytes);
  await fs.writeFile(meta, JSON.stringify({ start, stop }));
}

/**
 * GET /horizons/spk?spkid=<id>&start=<date>&stop=<date> -- fetches
 * the trajectory SPK for an already-resolved `spkid` (from
 * /horizons/resolve above) via Horizons. Success: raw SPK bytes,
 * same-origin, `application/octet-stream`. Failure (ineligible
 * object, bad time range, or Horizons itself unreachable): `4xx` JSON
 * `{ error }`, Horizons' own message verbatim -- already specific and
 * actionable, not worth re-wrapping.
 *
 * Cached per `spkid` (horizonsCachePaths()/readHorizonsCache()/
 * writeHorizonsCache() above), in `kernels/cache/horizons/`:
 *
 * - The requested `[start, stop]` fits entirely inside what's already
 *   cached for this `spkid` -- serve the cached bytes directly, no
 *   Horizons request at all.
 * - Otherwise (no cache yet, or the request reaches outside it on
 *   either end) -- fetch a *fresh* SPK over the union of the two
 *   ranges (`min(cachedStart, start) .. max(cachedStop, stop)`, plain
 *   string min/max -- see horizonsCachePaths()'s own comment), and
 *   overwrite the cache with it. Always the *union*, not just the
 *   missing gap: Horizons has no way to splice two separate SPKs
 *   together into one, and a single wider request is exactly as cheap
 *   as a narrow one from Horizons' own side.
 */
async function handleHorizonsSpk(req, res, url) {
  const spkid = url.searchParams.get('spkid');
  const start = url.searchParams.get('start');
  const stop = url.searchParams.get('stop');
  if (!spkid || !start || !stop) {
    return sendJson(res, 400, { error: 'spkid, start, and stop query parameters are all required.' });
  }

  const cached = await readHorizonsCache(spkid);
  let bytes;
  if (cached && start >= cached.start && stop <= cached.stop) {
    console.log(`  [horizons] spkid ${spkid}: serving cached SPK (${cached.start} .. ${cached.stop}, ` +
      `covers requested ${start} .. ${stop}) -- no Horizons request needed.`);
    bytes = cached.bytes;
  } else {
    const fetchStart = cached && cached.start < start ? cached.start : start;
    const fetchStop = cached && cached.stop > stop ? cached.stop : stop;
    if (cached) {
      console.log(`  [horizons] spkid ${spkid}: cached range (${cached.start} .. ${cached.stop}) doesn't cover ` +
        `requested (${start} .. ${stop}) -- re-fetching the union, ${fetchStart} .. ${fetchStop}...`);
    } else {
      console.log(`  [horizons] fetching SPK for spkid ${spkid} (${fetchStart} .. ${fetchStop})...`);
    }
    try {
      ({ bytes } = await fetchHorizonsSpk({ spkid, startTime: fetchStart, stopTime: fetchStop }));
    } catch (err) {
      console.error(`  [horizons] spkid ${spkid}: ${err.message}`);
      return sendJson(res, 502, { error: err.message });
    }
    try {
      await writeHorizonsCache(spkid, bytes, fetchStart, fetchStop);
    } catch (err) {
      console.error(`  [horizons] spkid ${spkid}: couldn't write cache (${err.message}) -- serving the fetched SPK anyway.`);
    }
  }

  console.log(`  [horizons] spkid ${spkid}: ${formatBytes(bytes.byteLength)}.`);
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-length': bytes.byteLength,
    'access-control-allow-origin': '*',
    'cache-control': 'no-cache',
  });
  res.end(bytes);
}

// In-memory cache for the CAD API's own response -- it's a bounded,
// slow-changing dataset (new/refined close approaches, not a live feed),
// so refetching it on every /close-approach/ page load would just be
// slower for no benefit. Kept in memory (not on disk, unlike the SPK
// caches above) since it's cheap to refetch on a server restart and
// small enough (~1000s of rows) that there's no real cost either way.
let closeApproachCache = null; // { data, fetchedAt } once populated
const CLOSE_APPROACH_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/** GET /close-approach/data -- proxies (and caches) the CAD API query /close-approach/'s own table is built from. */
async function handleCloseApproachData(req, res) {
  const fresh = closeApproachCache && Date.now() - closeApproachCache.fetchedAt < CLOSE_APPROACH_CACHE_TTL_MS;
  if (fresh) {
    return sendJson(res, 200, closeApproachCache.data);
  }
  console.log('  [close-approach] fetching close-approach data from the CAD API...');
  let data;
  try {
    data = await fetchCloseApproachData();
  } catch (err) {
    console.error(`  [close-approach] ${err.message}`);
    if (closeApproachCache) {
      console.error('  [close-approach] serving the last successful fetch instead (stale).');
      return sendJson(res, 200, closeApproachCache.data);
    }
    return sendJson(res, 502, { error: err.message });
  }
  console.log(`  [close-approach] ${data.count} close approaches.`);
  closeApproachCache = { data, fetchedAt: Date.now() };
  sendJson(res, 200, data);
}

/** Serves one file's bytes as `text/html`, the same headers handleStatic() itself uses for an ordinary page. */
async function serveHtmlFile(res, filePath) {
  const body = await fs.readFile(filePath);
  res.writeHead(200, {
    'content-type': MIME['.html'],
    'content-length': body.byteLength,
    'cache-control': 'no-cache',
  });
  res.end(body);
}

/**
 * Matches `/<body>/` or `/<body>/trajectory/` for a known BODIES slug
 * (`sun`, `earth`, `jupiter`, ...) -- returns `'body'`/`'body-trajectory'`
 * (which template to serve) or `null`. Doesn't require a trailing slash
 * itself; the caller 302-redirects to add one, matching handleStatic()'s
 * own directory convention, since neither route is a real directory on
 * disk for handleStatic() to find and redirect on its own.
 */
function matchBodyRoute(pathname) {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 1 && BODY_SLUGS.has(segments[0])) return 'body';
  if (segments.length === 2 && segments[1] === 'trajectory' && BODY_SLUGS.has(segments[0])) return 'body-trajectory';
  return null;
}

async function handleStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const filePath = path.join(REPO_ROOT, rel);

  // Never serve outside the repo, whatever the path contains.
  if (!filePath.startsWith(REPO_ROOT + path.sep) && filePath !== REPO_ROOT) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      res.writeHead(302, { location: `${url.pathname.replace(/\/$/, '')}/` }).end();
      return;
    }
    const body = await fs.readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'content-length': body.byteLength,
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(`Not found: ${rel}`);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  try {
    if (url.pathname === PROXY_PREFIX || url.pathname === PROXY_PREFIX.slice(0, -1)) {
      await handleProxyIndex(res);
    } else if (url.pathname.startsWith(PROXY_PREFIX)) {
      await handleProxy(req, res, url);
    } else if (url.pathname === HORIZONS_RESOLVE_PREFIX) {
      await handleHorizonsResolve(req, res, url);
    } else if (url.pathname === HORIZONS_SPK_PREFIX) {
      await handleHorizonsSpk(req, res, url);
    } else if (url.pathname === CLOSE_APPROACH_DATA_PREFIX) {
      await handleCloseApproachData(req, res);
    } else if (matchBodyRoute(url.pathname) && !url.pathname.endsWith('/')) {
      // No trailing slash (e.g. /earth, /earth/trajectory) -- redirect to
      // add one, same as handleStatic() does for a real directory.
      res.writeHead(302, { location: `${url.pathname}/` }).end();
    } else if (matchBodyRoute(url.pathname) === 'body') {
      await serveHtmlFile(res, BODY_TEMPLATE_PATH);
    } else if (matchBodyRoute(url.pathname) === 'body-trajectory') {
      await serveHtmlFile(res, BODY_TRAJECTORY_TEMPLATE_PATH);
    } else {
      await handleStatic(req, res, url);
    }
  } catch (err) {
    console.error(`  [error] ${req.method} ${url.pathname}: ${err.stack ?? err.message}`);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(`Server error: ${err.message}`);
  }
});

server.listen(opts.port, () => {
  const total = SPK_IDS.reduce((n, id) => n + KERNELS[id].bytes, 0);
  console.log(`spiceJS example server on http://localhost:${opts.port}`);
  console.log(`  demo:        http://localhost:${opts.port}/examples/browser-demo/`);
  console.log(`  curated:     http://localhost:${opts.port}/solar-system/ , /solar-system/trajectory/ , /<body>/ , /<body>/trajectory/ , /close-approach/`);
  console.log(`  kernel list: http://localhost:${opts.port}${PROXY_PREFIX}`);
  console.log(`  horizons:    http://localhost:${opts.port}${HORIZONS_RESOLVE_PREFIX}?sstr=... , ` +
    `${HORIZONS_SPK_PREFIX}?spkid=...&start=...&stop=...`);
  console.log(`  proxying ${SPK_IDS.length} kernels (${formatBytes(total)} upstream) into ${path.relative(REPO_ROOT, CACHE_DIR)}/`);
  console.log(`  block size ${formatBytes(opts.blockBytes)} -- only blocks actually requested are ever fetched.`);
});

async function shutdown() {
  console.log('\nclosing caches...');
  for (const cache of caches.values()) {
    const { upstreamRequests, upstreamBytes, servedRequests, servedBytes } = cache.stats;
    if (servedRequests) {
      console.log(`  ${path.basename(cache.cachePath)}: served ${servedRequests} ranged reads ` +
        `(${formatBytes(servedBytes)}) using ${upstreamRequests} upstream fetches (${formatBytes(upstreamBytes)})`);
    }
    await cache.close();
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
