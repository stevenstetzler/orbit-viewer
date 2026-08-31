/**
 * Downloads whole kernels from NAIF into `kernels/cache/`.
 *
 *   npm run download-spk -- --list          # what's available, and what's already here
 *   npm run download-spk -- de440s          # one kernel by id
 *   npm run download-spk -- de440s plu060   # several
 *   npm run download-spk -- --group satellite
 *   npm run download-spk -- --all           # all 7.4 GB; refuses without --yes
 *
 * Deliberately *not* an all-by-default command: the eight satellite
 * SPKs total 7.2 GB, and for most uses you don't need any of them in
 * full -- `npm run serve-example` fetches just the byte ranges a query
 * actually touches, into the same directory, on demand. Reach for this
 * downloader when you want a kernel available offline, or want to hand
 * a complete file to another tool (spiceypy, CSPICE) that can't do
 * ranged reads.
 *
 * Downloads resume: a partial file left by an interrupted run is
 * continued with a Range request rather than restarted.
 *
 * If fetches hang or 403 in your environment, see perf/README.md's note
 * about Node's built-in fetch() and proxies (NODE_USE_ENV_PROXY=1).
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { KERNELS, KERNEL_IDS, SPK_IDS, kernelIdsByGroup, resolveKernel, totalBytes, formatBytes } from '../kernels/sources.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(REPO_ROOT, 'kernels', 'cache');

function parseArgs(argv) {
  const opts = { ids: [], all: false, list: false, yes: false, groups: [], force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--all') opts.all = true;
    else if (arg === '--list') opts.list = true;
    else if (arg === '--yes' || arg === '-y') opts.yes = true;
    else if (arg === '--force') opts.force = true;
    else if (arg === '--group') opts.groups.push(argv[++i]);
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown flag: ${arg}`);
    else opts.ids.push(arg);
  }
  return opts;
}

async function localState(entry) {
  const target = path.join(CACHE_DIR, entry.file);
  try {
    const stat = await fsp.stat(target);
    if (stat.size === entry.bytes) return { target, status: 'complete', size: stat.size };
    if (stat.size < entry.bytes) return { target, status: 'partial', size: stat.size };
    return { target, status: 'oversized', size: stat.size };
  } catch {
    return { target, status: 'missing', size: 0 };
  }
}

function progressReporter(label, totalExpected, alreadyHave) {
  let seen = alreadyHave;
  let lastPrint = 0;
  return {
    onChunk(n) {
      seen += n;
      const now = Date.now();
      if (now - lastPrint < 500 && seen < totalExpected) return;
      lastPrint = now;
      const pct = ((seen / totalExpected) * 100).toFixed(1);
      process.stdout.write(`\r  ${label}: ${formatBytes(seen)} / ${formatBytes(totalExpected)} (${pct}%)   `);
    },
    done() {
      process.stdout.write(`\r  ${label}: ${formatBytes(seen)} / ${formatBytes(totalExpected)} (100.0%)   \n`);
    },
  };
}

async function download(entry, { force }) {
  const state = await localState(entry);
  if (state.status === 'complete' && !force) {
    console.log(`  ${entry.file}: already complete (${formatBytes(state.size)}), skipping.`);
    return { skipped: true, bytes: 0 };
  }
  if (state.status === 'oversized' || (force && state.status !== 'missing')) {
    await fsp.rm(state.target, { force: true });
    state.status = 'missing';
    state.size = 0;
  }

  const resumeFrom = state.status === 'partial' ? state.size : 0;
  if (resumeFrom > 0) {
    console.log(`  ${entry.file}: resuming at ${formatBytes(resumeFrom)} of ${formatBytes(entry.bytes)}`);
  }

  const headers = resumeFrom > 0 ? { Range: `bytes=${resumeFrom}-` } : {};
  const response = await fetch(entry.url, { headers });
  if (!response.ok) {
    throw new Error(`${entry.url}: HTTP ${response.status} ${response.statusText}`);
  }
  if (resumeFrom > 0 && response.status !== 206) {
    // The server ignored the resume request; start over rather than
    // append the whole file onto a partial one.
    console.log(`  ${entry.file}: server ignored the resume Range (HTTP ${response.status}), restarting.`);
    await fsp.rm(state.target, { force: true });
    return download({ ...entry }, { force: true });
  }

  await fsp.mkdir(CACHE_DIR, { recursive: true });
  const reporter = progressReporter(entry.file, entry.bytes, resumeFrom);
  const out = fs.createWriteStream(state.target, { flags: resumeFrom > 0 ? 'a' : 'w' });
  const source = Readable.fromWeb(response.body);
  source.on('data', (chunk) => reporter.onChunk(chunk.length));
  await pipeline(source, out);
  reporter.done();

  const final = await localState(entry);
  if (final.status !== 'complete') {
    throw new Error(`${entry.file}: expected ${entry.bytes} bytes, got ${final.size}`);
  }
  return { skipped: false, bytes: entry.bytes - resumeFrom };
}

async function list() {
  console.log('Kernels declared in kernels/sources.mjs:\n');
  for (const id of KERNEL_IDS) {
    const entry = KERNELS[id];
    let where;
    if (entry.bundled) {
      where = 'bundled in kernels/';
    } else {
      const state = await localState(entry);
      where = { complete: 'downloaded', partial: `partial (${formatBytes(state.size)})`, missing: 'not downloaded', oversized: 'unexpected size' }[state.status];
    }
    console.log(`  ${id.padEnd(11)} ${formatBytes(entry.bytes).padStart(9)}  ${entry.group.padEnd(9)} ${where}`);
    console.log(`  ${' '.repeat(11)} ${entry.description}`);
  }
  console.log(`\n  SPK total if fully downloaded: ${formatBytes(totalBytes(SPK_IDS))}`);
  console.log('  Tip: `npm run serve-example` fetches only the ranges each query needs -- no full download required.');
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help) {
  console.log(`usage: npm run download-spk -- [ids...] [--group planetary|satellite] [--all] [--list] [--force] [--yes]

  ids           kernel ids or filenames from kernels/sources.mjs (e.g. de440s, jup365.bsp)
  --group G     every kernel in a group ('planetary' or 'satellite')
  --all         every SPK (${formatBytes(totalBytes(SPK_IDS))}) -- requires --yes
  --list        show what's available and what's already downloaded
  --force       re-download even if a complete copy exists
  --yes         skip the size confirmation

Downloads land in kernels/cache/ (gitignored). Most of the time you don't
need this at all -- \`npm run serve-example\` serves these same kernels
through a range-caching proxy that fetches only what each query touches.`);
  process.exit(0);
}

if (opts.list) {
  await list();
  process.exit(0);
}

let wanted = [];
for (const group of opts.groups) wanted.push(...kernelIdsByGroup(group));
for (const id of opts.ids) {
  const entry = resolveKernel(id);
  if (entry.bundled) {
    console.log(`${entry.id} is a text kernel already bundled at kernels/${entry.file} -- nothing to download.`);
    continue;
  }
  wanted.push(entry.id);
}
if (opts.all) wanted = [...SPK_IDS];
wanted = [...new Set(wanted)];

if (wanted.length === 0) {
  console.error('Nothing to do. Try `npm run download-spk -- --list`, or `--help` for usage.');
  process.exit(1);
}

const size = totalBytes(wanted);
console.log(`Downloading ${wanted.length} kernel(s), ${formatBytes(size)} total, into ${path.relative(REPO_ROOT, CACHE_DIR)}/`);
for (const id of wanted) console.log(`  - ${id}: ${KERNELS[id].file} (${formatBytes(KERNELS[id].bytes)})`);

const LARGE = 500e6;
if (size > LARGE && !opts.yes) {
  console.error(`\nThat's ${formatBytes(size)}. Re-run with --yes if you're sure.`);
  console.error('Reminder: `npm run serve-example` needs no full download -- it fetches only the ranges each query touches.');
  process.exit(1);
}

let downloaded = 0;
let failures = 0;
for (const id of wanted) {
  const entry = { id, ...KERNELS[id] };
  try {
    const result = await download(entry, { force: opts.force });
    downloaded += result.bytes;
  } catch (err) {
    failures += 1;
    console.error(`  ${entry.file}: FAILED -- ${err.message}`);
  }
}

console.log(`\nDone: ${formatBytes(downloaded)} transferred${failures ? `, ${failures} failure(s)` : ''}.`);
process.exit(failures ? 1 : 0);
