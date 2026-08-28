/**
 * Kernel/session bookkeeping shared by the curated demo pages: loading
 * the bundled text kernels, structurally scanning a kernel's own real
 * body/coverage list (no data fetch), the "probe now, widen on demand"
 * prefetch strategy each of the ten standard bodies uses, and real
 * satellite resolution (SATELLITE_KERNEL_FOR_BODY). Extracted from
 * `examples/browser-demo/index.html` -- see that file's own comments
 * for the fuller "why" behind each piece.
 *
 * Every body object these functions touch is a plain object carrying
 * (at least) `target`; the fields below are the shared convention every
 * page's own session state builds on:
 *   - `dataStart`/`dataEnd`: the ET range actually prefetched so far
 *     (grows via ensureBodyCoverage() as the reference epoch scrubs).
 *   - `coverageStart`/`coverageEnd`: the body's own REAL, fixed
 *     coverage bound, if narrower than the session's overall kernel
 *     range (set for a custom/Horizons body, or a resolved satellite
 *     from a kernel that doesn't span the whole session window) --
 *     `null`/absent means "covered whenever the session's own reference
 *     epoch range allows" (true for the ten standard bodies, whose
 *     coverage is exactly what beginSession()'s own kernel-range
 *     bounds the reference-epoch slider to in the first place).
 *   - `remote`: whichever remote-like `{ pool, prefetch() }` object this
 *     body's data actually comes from -- absent for a body that's
 *     already fully prefetched over its own fixed interval up front
 *     (a custom/Horizons body), which never needs ensureBodyCoverage()
 *     again.
 */
import { load, spkez } from '../../src/browser.js';
import { prefetchSpkQuery, prefetchSpkBodySegment } from '../../src/lazy/prefetch.js';
import { parseFileRecord, parseDaf, readWords, FILE_RECORD_BYTES } from '../../src/daf.js';
import { SSB, INERTIAL_FRAME } from './constants.js';
import { satellitesFromManifest } from './bodies.js';

export async function loadLeapseconds(log = () => {}) {
  const url = new URL('../../kernels/naif0012.tls', import.meta.url).href;
  await load(url);
  log(`Leapseconds kernel loaded from ${url}`);
}

export async function loadPlanetaryConstants(pool, log = () => {}) {
  const url = new URL('../../kernels/pck00011.tpc', import.meta.url).href;
  await load(url, pool);
  log(`Planetary orientation constants loaded from ${url}`);
}

export async function loadGravitationalParameters(pool, log = () => {}) {
  const url = new URL('../../kernels/gm_de440.tpc', import.meta.url).href;
  await load(url, pool);
  log(`Gravitational parameters loaded from ${url}`);
}

/**
 * Whether `b` has any real data at `et` -- `false` means "don't even
 * try to query this body right now," so it can be hidden cleanly
 * instead of erroring. Only a body with a `coverageStart`/`coverageEnd`
 * narrower than the session's own reference-epoch range can actually
 * answer `false`; every other body is assumed in range unconditionally.
 */
export function bodyHasCoverageAt(b, et) {
  if (b.coverageStart == null || b.coverageEnd == null) return true;
  return et >= b.coverageStart && et <= b.coverageEnd;
}

/**
 * Structurally scans a DAF's own summary records for every body it
 * carries -- target, declared center, real [etStart, etEnd] coverage
 * (unioned across however many segments that target has) -- with no
 * position/state data actually fetched. Returns `Map<target, { target,
 * center, etStart, etEnd, types: Set<segmentType> }>`.
 */
export async function discoverSpkBodies(remoteFile) {
  const WORDS_PER_RECORD = FILE_RECORD_BYTES / 8;
  await remoteFile.ensureRange(0, FILE_RECORD_BYTES);
  const fileRecord = parseFileRecord(remoteFile.buffer);
  let recordNumber = fileRecord.fward;
  const visited = new Set();
  while (recordNumber !== 0) {
    if (visited.has(recordNumber)) throw new Error(`summary record chain loops at ${recordNumber}`);
    visited.add(recordNumber);
    const startByte = (recordNumber - 1) * FILE_RECORD_BYTES;
    await remoteFile.ensureRange(startByte, startByte + FILE_RECORD_BYTES);
    const addr = (recordNumber - 1) * WORDS_PER_RECORD + 1;
    recordNumber = Math.round(readWords(remoteFile.buffer, fileRecord.littleEndian, addr, addr)[0]);
  }

  const daf = parseDaf(remoteFile.buffer);
  const bodies = new Map();
  for (const summary of daf.summaries) {
    const [target, center, , type] = summary.ic;
    const [begin, end] = summary.dc;
    let b = bodies.get(target);
    if (!b) {
      b = { target, center, etStart: begin, etEnd: end, types: new Set() };
      bodies.set(target, b);
    } else {
      b.etStart = Math.min(b.etStart, begin);
      b.etEnd = Math.max(b.etEnd, end);
    }
    b.types.add(type);
  }
  return bodies;
}

/**
 * Widens `b`'s own prefetched range to cover `[etStart, etEnd]`, a
 * no-op if it already does. `counters`/`log`, if given, report newly
 * fetched bytes the same way every page's own status log does.
 */
export async function ensureBodyCoverage(b, etStart, etEnd, { counters = null, log = () => {} } = {}) {
  if (etStart >= b.dataStart && etEnd <= b.dataEnd) return;
  const newStart = Math.min(b.dataStart, etStart);
  const newEnd = Math.max(b.dataEnd, etEnd);
  const before = counters ? { ...counters } : null;
  await b.remote.prefetch({ target: b.target, observer: SSB, etStart: newStart, etEnd: newEnd });
  b.dataStart = newStart;
  b.dataEnd = newEnd;
  if (counters) {
    const deltaRequests = counters.requestCount - before.requestCount;
    const deltaBytes = counters.bytesRead - before.bytesRead;
    if (deltaRequests > 0) {
      log(`  Extended prefetch for ${b.name}: ${deltaRequests} new range read${deltaRequests === 1 ? '' : 's'}, ${(deltaBytes / 1e6).toFixed(2)} MB.`);
    }
  }
}

/** Minimal prefetch for one body: just enough to read its state at `et0`. Records `body.primaryId`/`.remote`/`.dataStart`/`.dataEnd`. */
export async function prefetchBodyProbe(remote, body, primaryId, et0) {
  await remote.prefetch({ target: body.target, observer: SSB, etStart: et0, etEnd: et0 });
  body.primaryId = primaryId;
  body.remote = remote;
  body.dataStart = et0;
  body.dataEnd = et0;
}

/**
 * Prefetches `target`'s own chain to the SSB within a *custom* SPK file
 * (`remoteFile`) not otherwise known to this session, registering its
 * segments into the shared `pool` a standard body's own segments
 * already live in (so it can be positioned relative to, or used as an
 * observer for, any of them). Tries the fast path (prefetchSpkQuery(),
 * which already knows how to chain through segments in `pool`) first,
 * then falls back to a manual hop-by-hop walk through `remoteFile`
 * itself for a body chained via a center this session doesn't already
 * know how to reach (e.g. a heliocentric small-body kernel).
 * `systemBodies`, if given, is consulted at each hop so a chain that
 * bottoms out at an already-known body (any of the ten standard ones,
 * or a previously resolved satellite/custom body) doesn't need its own
 * segment fetched from `remoteFile` at all.
 */
export async function prefetchCustomBody(remoteFile, pool, target, etStart, etEnd, { systemBodies = [], counters = null, log = () => {} } = {}) {
  try {
    await prefetchSpkQuery(remoteFile, pool, { target, observer: SSB, etStart, etEnd });
    return;
  } catch {
    // Falls through to the hop-by-hop fallback below.
  }

  let current = target;
  const visited = new Set();
  const MAX_CHAIN_HOPS = 20; // mirrors src/lazy/prefetch.js's own MAX_CHAIN_HOPS (NAIF's CHLEN, spkgeo.f)
  for (let hop = 0; hop < MAX_CHAIN_HOPS && current !== SSB; hop++) {
    if (visited.has(current)) {
      throw new Error(`prefetchCustomBody: circular center chain detected -- body ${current} is its own ancestor`);
    }
    visited.add(current);

    const known = systemBodies.find((b) => b.target === current);
    if (known) {
      if (known.remote) {
        await ensureBodyCoverage(known, etStart, etEnd, { counters, log });
      } else if (etStart < known.dataStart || etEnd > known.dataEnd) {
        throw new Error(
          `prefetchCustomBody: body ${current}'s own interval [${known.dataStart}, ${known.dataEnd}] doesn't ` +
            `cover [${etStart}, ${etEnd}] needed to chain body ${target} to the Solar System Barycenter`
        );
      }
      break;
    }

    await prefetchSpkBodySegment(remoteFile, pool, { bodyId: current, etStart, etEnd });
    const segs = pool.getSpkSegments(current);
    current = segs[segs.length - 1].center;
  }

  spkez(target, SSB, (etStart + etEnd) / 2, 'NONE', INERTIAL_FRAME, pool); // throws clearly if the chain still doesn't resolve
}

/**
 * Opens a satellite kernel (`entry`, from the local proxy's own
 * catalogue) through `openRemoteFile`, discovers its real per-body
 * coverage (discoverSpkBodies(), structural only), and returns a
 * `{ remoteFile, pool, discovered, prefetch }` remote-like object --
 * `discovered` is this kernel's own `Map<target, {etStart, etEnd, ...}>`,
 * used to set each resolved satellite's `coverageStart`/`coverageEnd`
 * (see bodyHasCoverageAt()) so a satellite whose own kernel doesn't
 * span the whole session window just hides outside it, rather than
 * shrinking the session's own reference-epoch range the way an earlier
 * design (examples/browser-demo/index.html's narrowKernelRange()) did
 * -- these pages fix their own timespan up front (1900-2100), so a
 * narrower satellite kernel is the body's own limitation, not the
 * session's.
 */
export async function openSatelliteRemote(entry, pool, openRemoteFileFn, log = () => {}) {
  log(`  Fetching ${entry.file} (${entry.size}) through the local proxy...`);
  const remoteFile = await openRemoteFileFn(entry.url);
  let discovered = new Map();
  try {
    discovered = await discoverSpkBodies(remoteFile);
  } catch (err) {
    log(`  -> couldn't determine ${entry.file}'s own real time coverage (${err.message}).`);
  }
  return {
    remoteFile,
    pool,
    discovered,
    prefetch: ({ target, etStart, etEnd }) => prefetchCustomBody(remoteFile, pool, target, etStart, etEnd, { log }),
  };
}

/**
 * Resolves one satellite `candidate` (from satellitesFromManifest()) to
 * a real, prefetched body -- or `null`, having already logged why --
 * trying (1) whatever's already loaded in `primaryRemote` (covers
 * Earth's Moon in the ordinary case), then (2) the satellite kernel
 * `mapping` points to, opened through the local proxy
 * (`satelliteRemotes`, a `Map<kernelId, remote>` the caller owns and
 * reuses across calls so each kernel is only fetched once per session).
 */
export async function resolveOneSatellite(primaryRemote, parentSpec, candidate, mapping, { et0, proxyCatalogue, satelliteRemotes, openRemoteFileFn, log = () => {} }) {
  const body = { ...candidate };
  try {
    await prefetchBodyProbe(primaryRemote, body, parentSpec.target, et0);
    return body;
  } catch {
    // Not in the primary kernel -- try the mapped satellite kernel below.
  }

  if (!proxyCatalogue || !proxyCatalogue.has(mapping.kernelId)) {
    log(`  -> ${candidate.name} isn't in the loaded kernel, and no local proxy is running to fetch ${mapping.kernelId}.bsp from.`);
    return null;
  }
  let satRemote = satelliteRemotes.get(mapping.kernelId);
  if (!satRemote) {
    try {
      satRemote = await openSatelliteRemote(proxyCatalogue.get(mapping.kernelId), primaryRemote.pool, openRemoteFileFn, log);
      satelliteRemotes.set(mapping.kernelId, satRemote);
    } catch (err) {
      log(`  -> couldn't open ${mapping.kernelId}.bsp for ${candidate.name} (${err.message})`);
      return null;
    }
  }
  const discoveredBody = satRemote.discovered.get(candidate.target);
  if (discoveredBody) {
    body.coverageStart = discoveredBody.etStart;
    body.coverageEnd = discoveredBody.etEnd;
  }
  try {
    await prefetchBodyProbe(satRemote, body, parentSpec.target, et0);
    return body;
  } catch (err) {
    log(`  -> couldn't prefetch ${candidate.name} (${err.message})`);
    return null;
  }
}

/** Resolves *every* known satellite of `spec` via resolveOneSatellite(). Returns `[]` if `spec` has no SATELLITE_KERNEL_FOR_BODY mapping at all. */
export async function resolveSatellitesFor(spec, satelliteKernelForBody, primaryRemote, opts) {
  const mapping = satelliteKernelForBody[spec.bodyId];
  if (!mapping) return [];
  const candidates = satellitesFromManifest(mapping.kernelId, mapping.centerId ?? spec.target, [spec.target, spec.bodyId], mapping.only);
  const resolved = [];
  for (const candidate of candidates) {
    const body = await resolveOneSatellite(primaryRemote, spec, candidate, mapping, opts);
    if (body) resolved.push(body);
  }
  return resolved;
}
