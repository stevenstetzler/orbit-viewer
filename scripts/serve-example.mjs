/**
 * Dev server for examples/browser-demo -- static files plus a
 * *range-caching kernel proxy*, which is what makes the demo usable
 * against multi-gigabyte kernels without downloading them first.
 *
 *   npm run serve-example              # http://localhost:8080
 *   npm run serve-example -- --port 9000
 *   npm run serve-example -- --block-bytes 262144
 *
 * Two things it serves:
 *
 * 1. The repo, statically, from `/` -- so the demo page at
 *    /examples/browser-demo/ can import ../../src/browser.js and fetch
 *    ../../kernels/naif0012.tls as ordinary same-origin URLs.
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
 * 3. `/horizons/spk?command=...&start=...&stop=...` -- fetches a
 *    small-body/comet trajectory SPK from the JPL Horizons API on the
 *    browser's behalf (see horizonsSpk.mjs) and relays the raw bytes
 *    back same-origin. Same CORS reasoning as (2) above --
 *    ssd.jpl.nasa.gov sends no Access-Control-Allow-Origin either --
 *    but no caching (each request is a distinct object/time-range
 *    combination, not a range within one large fixed file).
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
import { fetchHorizonsSpk } from './horizonsSpk.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(REPO_ROOT, 'kernels', 'cache');
const PROXY_PREFIX = '/kernels/remote/';
const HORIZONS_PREFIX = '/horizons/spk';

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
 * GET /horizons/spk?command=<object>&start=<date>&stop=<date> -- see
 * horizonsSpk.mjs for the actual Horizons query/quirks. Success:
 * raw SPK bytes, same-origin, `application/octet-stream`. Failure
 * (bad/ambiguous/ineligible object, or Horizons itself unreachable):
 * `4xx` JSON `{ error }`, Horizons' own message verbatim -- already
 * specific and actionable (which record didn't match, why, etc.), not
 * worth re-wrapping.
 */
async function handleHorizons(req, res, url) {
  const command = url.searchParams.get('command');
  const start = url.searchParams.get('start');
  const stop = url.searchParams.get('stop');
  if (!command || !start || !stop) {
    return sendJson(res, 400, { error: 'command, start, and stop query parameters are all required.' });
  }

  console.log(`  [horizons] fetching SPK for "${command}" (${start} .. ${stop})...`);
  let bytes;
  try {
    ({ bytes } = await fetchHorizonsSpk({ command, startTime: start, stopTime: stop }));
  } catch (err) {
    console.error(`  [horizons] "${command}": ${err.message}`);
    return sendJson(res, 502, { error: err.message });
  }

  console.log(`  [horizons] "${command}": ${formatBytes(bytes.byteLength)}.`);
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-length': bytes.byteLength,
    'access-control-allow-origin': '*',
    'cache-control': 'no-cache',
  });
  res.end(bytes);
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
    } else if (url.pathname === HORIZONS_PREFIX) {
      await handleHorizons(req, res, url);
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
  console.log(`  kernel list: http://localhost:${opts.port}${PROXY_PREFIX}`);
  console.log(`  horizons:    http://localhost:${opts.port}${HORIZONS_PREFIX}?command=...&start=...&stop=...`);
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
