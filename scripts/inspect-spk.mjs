/**
 * Reads the real structure of the SPKs listed in kernels/sources.mjs
 * straight off NAIF's server -- size, segment types, ET coverage, and
 * every target/center pair -- using spiceJS's own lazy loader, so it
 * touches a couple of 64 KiB blocks per file rather than downloading
 * gigabytes. This is how the `bytes`/`targets`/`segmentTypes`/
 * `etCoverage` fields in kernels/sources.mjs were derived; re-run it
 * to check them (`--check`) or to inspect something new.
 *
 *   node scripts/inspect-spk.mjs                # inspect every SPK in the catalogue
 *   node scripts/inspect-spk.mjs jup365 plu060  # just these
 *   node scripts/inspect-spk.mjs --check        # compare against sources.mjs, exit 1 on drift
 *
 * If fetches hang or 403 in your environment, see perf/README.md's note
 * about Node's built-in fetch() and proxies (NODE_USE_ENV_PROXY=1).
 */
import { openRemoteFile, discoverSpkBodies } from 'spicejs';
import { parseDaf } from '../node_modules/spicejs/src/daf.js';
import { KERNELS, SPK_IDS, resolveKernel, formatBytes, etToApproxYear } from '../kernels/sources.mjs';

/**
 * Structural discovery itself (walking the summary-record chain,
 * fetching one record at a time, then grouping by target) is spicejs's
 * own discoverSpkBodies() now, not hand-rolled here. The one thing it
 * doesn't report -- the raw, ungrouped segment count (`--check` doesn't
 * compare it, but the report line below prints it) -- comes from a
 * second, free `parseDaf()` call: by the time discoverSpkBodies()
 * returns, every summary-record byte it touched is already sitting in
 * remoteFile.buffer, so re-parsing it is pure computation, not a
 * second fetch.
 */
async function readStructure(url) {
  let requests = 0;
  let bytes = 0;
  const remoteFile = await openRemoteFile(url, {
    resolveRange: async (u, start, end) => {
      requests += 1;
      bytes += end - start;
      const response = await fetch(u, { headers: { Range: `bytes=${start}-${end - 1}` } });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return new Uint8Array(await response.arrayBuffer());
    },
  });

  const bodies = await discoverSpkBodies(remoteFile);
  const daf = parseDaf(remoteFile.buffer);

  const segmentTypes = new Set();
  let etMin = Infinity;
  let etMax = -Infinity;
  for (const b of bodies.values()) {
    for (const type of b.types) segmentTypes.add(type);
    etMin = Math.min(etMin, b.etStart);
    etMax = Math.max(etMax, b.etEnd);
  }

  return {
    fileLength: remoteFile.fileLength,
    requests,
    bytes,
    segmentCount: daf.summaries.length,
    segmentTypes: [...segmentTypes].sort((a, b) => a - b),
    etCoverage: [etMin, etMax],
    targets: [...bodies.values()]
      .map((b) => ({ id: b.target, center: b.center, types: b.types }))
      .sort((a, b) => a.id - b.id),
  };
}

const args = process.argv.slice(2);
const check = args.includes('--check');
const ids = args.filter((a) => !a.startsWith('--'));
const wanted = ids.length ? ids.map((a) => resolveKernel(a).id) : SPK_IDS;

let drift = 0;
for (const id of wanted) {
  const entry = KERNELS[id];
  process.stdout.write(`\n=== ${id} (${entry.file}) ===\n`);
  let s;
  try {
    s = await readStructure(entry.url);
  } catch (err) {
    console.error(`  FAILED: ${err.message}`);
    drift += 1;
    continue;
  }

  console.log(`  ${formatBytes(s.fileLength)}  --  read ${s.requests} ranges / ${formatBytes(s.bytes)} ` +
    `(${((s.bytes / s.fileLength) * 100).toFixed(3)}% of the file)`);
  console.log(`  ${s.segmentCount} segments, types ${s.segmentTypes.join('/')}, ` +
    `ET ${s.etCoverage.map(etToApproxYear).join(' .. ')}`);
  const named = new Map((entry.targets ?? []).map((t) => [t.id, t.name]));
  console.log('  targets: ' + s.targets.map((t) => `${t.id}${named.has(t.id) ? ` (${named.get(t.id)})` : ''} rel ${t.center}`).join(', '));

  if (check) {
    const problems = [];
    if (entry.bytes !== s.fileLength) problems.push(`bytes: manifest ${entry.bytes} vs live ${s.fileLength}`);
    const manifestTargets = (entry.targets ?? []).map((t) => t.id).sort((a, b) => a - b).join(',');
    const liveTargets = s.targets.map((t) => t.id).join(',');
    if (manifestTargets !== liveTargets) problems.push(`targets: manifest [${manifestTargets}] vs live [${liveTargets}]`);
    const manifestTypes = (entry.segmentTypes ?? []).join('/');
    if (manifestTypes !== s.segmentTypes.join('/')) problems.push(`segmentTypes: manifest [${manifestTypes}] vs live [${s.segmentTypes.join('/')}]`);
    if (problems.length) {
      drift += 1;
      for (const p of problems) console.error(`  DRIFT: ${p}`);
    } else {
      console.log('  manifest matches the live file.');
    }
  }
}

if (check && drift > 0) {
  console.error(`\n${drift} kernel(s) drifted from kernels/sources.mjs -- update it.`);
  process.exit(1);
}
if (check) console.log('\nAll checked kernels match kernels/sources.mjs.');
