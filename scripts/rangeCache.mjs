/**
 * A sparse, block-aligned, on-disk range cache for a remote file --
 * the server-side mirror of what `src/lazy/remoteFile.js` does in
 * memory in the browser.
 *
 * The idea, which the numbers make almost mandatory here: the eight
 * satellite SPKs in kernels/sources.mjs total 7.2 GB, but any one
 * query touches well under a megabyte of any of them. So instead of
 * downloading whole kernels up front, keep a *sparse* local file the
 * same length as the remote one and fill in only the blocks that get
 * asked for:
 *
 *   kernels/cache/jup365.bsp         the sparse file (holes read as zeros;
 *                                    `du` shows only what's really stored)
 *   kernels/cache/jup365.bsp.blocks  a bitmap sidecar, one bit per block,
 *                                    recording which blocks are real
 *
 * A read for [start, end) rounds out to block boundaries, fetches only
 * the blocks whose bits are clear (coalescing adjacent misses into one
 * upstream Range request), writes them into the sparse file, sets
 * their bits, and then answers from local disk. Restarting the server
 * keeps everything already fetched, because both the data and the
 * bitmap are just files.
 *
 * Sparse-file support is a filesystem property, not something this
 * code can force: on ext4/xfs/APFS/NTFS the holes cost nothing, and on
 * a filesystem without holes the file simply occupies its full length
 * with zeros. Correctness does not depend on which you have -- the
 * bitmap, never the file size, is the source of truth for what's real.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * 64 KiB, deliberately the same as `remoteFile.js`'s own
 * DEFAULT_BLOCK_BYTES: when the proxy's blocks line up exactly with
 * the blocks the browser asks in, the proxy fetches upstream precisely
 * what the browser wanted and not one byte more.
 *
 * Measured on the real de440s.bsp, for exactly the query the demo
 * makes on load (10 bodies, +-30 days -- 23 browser reads, 1.47 MB):
 *
 *   block size | upstream requests | upstream bytes | amplification
 *      64 KiB  |        23         |     1.47 MB    |     1.0x
 *     128 KiB  |        23         |     2.97 MB    |     2.0x
 *     256 KiB  |        21         |     5.46 MB    |     3.7x
 *     512 KiB  |        18         |     9.13 MB    |     6.2x
 *       1 MiB  |        15         |    14.90 MB    |    10.2x
 *
 * Bigger blocks were the initial guess, on the theory that fewer round
 * trips to a slow server would win. The measurement says otherwise:
 * going to 1 MiB costs 10x the bytes to save 8 of 23 requests. Since
 * these reads are scattered (one per segment epilog/record range, not
 * a sequential scan), larger blocks mostly just pull neighbouring data
 * nothing asked for. Override with --block-bytes if your link's
 * per-request latency really does dominate.
 */
export const DEFAULT_BLOCK_BYTES = 1 << 16; // 64 KiB

function blockCountFor(fileLength, blockBytes) {
  return Math.ceil(fileLength / blockBytes);
}

/** Group a sorted array of block indices into contiguous [first, last] runs -- one upstream request per run. */
function coalesce(indices) {
  const runs = [];
  for (const i of indices) {
    const last = runs[runs.length - 1];
    if (last && last[1] === i - 1) last[1] = i;
    else runs.push([i, i]);
  }
  return runs;
}

export class RangeCache {
  /**
   * @param {object} options
   * @param {string} options.url - the upstream URL to fetch missing blocks from
   * @param {string} options.cachePath - local path for the sparse data file
   * @param {number} [options.blockBytes]
   * @param {number} [options.expectedBytes] - the size from kernels/sources.mjs, used to detect upstream drift
   * @param {(msg: string) => void} [options.log]
   */
  constructor({ url, cachePath, blockBytes = DEFAULT_BLOCK_BYTES, expectedBytes = null, log = () => {} }) {
    this.url = url;
    this.cachePath = cachePath;
    this.bitmapPath = `${cachePath}.blocks`;
    this.blockBytes = blockBytes;
    this.expectedBytes = expectedBytes;
    this.log = log;
    this.fileLength = null;
    this.bitmap = null;
    this.handle = null;
    this.inFlight = new Map(); // block index -> Promise, so concurrent requests never double-fetch
    this.stats = { upstreamRequests: 0, upstreamBytes: 0, servedRequests: 0, servedBytes: 0 };
    this._opening = null;
  }

  async open() {
    if (this.handle) return this;
    if (!this._opening) this._opening = this._open();
    return this._opening;
  }

  async _open() {
    await fs.mkdir(path.dirname(this.cachePath), { recursive: true });
    this.fileLength = await this._resolveLength();
    const blocks = blockCountFor(this.fileLength, this.blockBytes);
    const bitmapBytes = Math.ceil(blocks / 8);

    // Reuse an existing cache only if its data file is exactly the
    // expected length AND its bitmap is the matching size. Anything
    // else (a truncated download, a block-size change, an upstream
    // file that was replaced) starts clean rather than silently
    // serving a mix of old and new bytes.
    let reuse = false;
    try {
      const [dataStat, bitmap] = await Promise.all([fs.stat(this.cachePath), fs.readFile(this.bitmapPath)]);
      if (dataStat.size === this.fileLength && bitmap.byteLength === bitmapBytes) {
        this.bitmap = new Uint8Array(bitmap);
        reuse = true;
      }
    } catch {
      // no usable cache yet
    }

    if (!reuse) {
      this.bitmap = new Uint8Array(bitmapBytes);
      await fs.truncate(this.cachePath, this.fileLength).catch(async () => {
        // truncate() fails if the file doesn't exist yet -- create then size it.
        await fs.writeFile(this.cachePath, '');
        await fs.truncate(this.cachePath, this.fileLength);
      });
      await this._writeBitmap();
    }

    this.handle = await fs.open(this.cachePath, 'r+');
    const have = this.populatedBlocks();
    this.log(`cache ${path.basename(this.cachePath)}: ${this.fileLength} bytes, ` +
      `${have}/${blocks} blocks present (${((have / blocks) * 100).toFixed(1)}%)`);
    return this;
  }

  async _resolveLength() {
    const response = await fetch(this.url, { method: 'HEAD' });
    if (!response.ok) {
      throw new Error(`HEAD ${this.url} failed: HTTP ${response.status} ${response.statusText}`);
    }
    const length = Number(response.headers.get('content-length'));
    if (!Number.isFinite(length) || length <= 0) {
      throw new Error(`HEAD ${this.url} returned no usable Content-Length`);
    }
    if (this.expectedBytes != null && this.expectedBytes !== length) {
      // Not fatal -- NAIF does republish kernels -- but never silent.
      this.log(`WARNING: ${this.url} is ${length} bytes, but kernels/sources.mjs records ${this.expectedBytes}. ` +
        `The upstream file appears to have changed; re-run \`node scripts/inspect-spk.mjs --check\`.`);
    }
    return length;
  }

  populatedBlocks() {
    let n = 0;
    for (const byte of this.bitmap) {
      for (let b = 0; b < 8; b++) if (byte & (1 << b)) n += 1;
    }
    return n;
  }

  _has(block) {
    return (this.bitmap[block >> 3] & (1 << (block & 7))) !== 0;
  }

  _set(block) {
    this.bitmap[block >> 3] |= 1 << (block & 7);
  }

  async _writeBitmap() {
    await fs.writeFile(this.bitmapPath, this.bitmap);
  }

  /** Fetch one contiguous run of blocks upstream and commit it to the sparse file. */
  async _fetchRun(firstBlock, lastBlock) {
    const start = firstBlock * this.blockBytes;
    const end = Math.min(this.fileLength, (lastBlock + 1) * this.blockBytes);
    const response = await fetch(this.url, { headers: { Range: `bytes=${start}-${end - 1}` } });
    if (!(response.status === 206 || response.status === 200)) {
      throw new Error(`Range GET ${this.url} [${start}, ${end}) failed: HTTP ${response.status} ${response.statusText}`);
    }
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength !== end - start) {
      // A 200 here means the server ignored Range and sent the whole
      // file; either way, don't write bytes at offsets they don't
      // belong to.
      throw new Error(`Range GET ${this.url} [${start}, ${end}) returned ${body.byteLength} bytes, expected ${end - start}`);
    }

    await this.handle.write(body, 0, body.byteLength, start);
    for (let b = firstBlock; b <= lastBlock; b++) this._set(b);
    this.stats.upstreamRequests += 1;
    this.stats.upstreamBytes += body.byteLength;
    this.log(`  fetched blocks ${firstBlock}-${lastBlock} (${body.byteLength} bytes) from upstream`);
  }

  /**
   * Make sure every block covering [start, end) is present locally,
   * fetching what's missing. Concurrent callers wanting the same block
   * share one in-flight request rather than racing.
   */
  async ensureRange(start, end) {
    await this.open();
    const firstBlock = Math.floor(start / this.blockBytes);
    const lastBlock = Math.floor((end - 1) / this.blockBytes);

    const missing = [];
    const waits = [];
    for (let b = firstBlock; b <= lastBlock; b++) {
      if (this._has(b)) continue;
      const pending = this.inFlight.get(b);
      if (pending) waits.push(pending);
      else missing.push(b);
    }

    for (const [runFirst, runLast] of coalesce(missing)) {
      const promise = this._fetchRun(runFirst, runLast).finally(() => {
        for (let b = runFirst; b <= runLast; b++) this.inFlight.delete(b);
      });
      for (let b = runFirst; b <= runLast; b++) this.inFlight.set(b, promise);
      waits.push(promise);
    }

    if (waits.length) {
      await Promise.all(waits);
      await this._writeBitmap();
    }
  }

  /** Read [start, end) -- fetching whatever's missing first. */
  async read(start, end) {
    await this.ensureRange(start, end);
    const out = Buffer.allocUnsafe(end - start);
    let filled = 0;
    while (filled < out.byteLength) {
      const { bytesRead } = await this.handle.read(out, filled, out.byteLength - filled, start + filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    this.stats.servedRequests += 1;
    this.stats.servedBytes += filled;
    return out.subarray(0, filled);
  }

  async close() {
    if (this.handle) {
      await this._writeBitmap();
      await this.handle.close();
      this.handle = null;
    }
  }
}

/** Parse a single-range `Range: bytes=a-b` header against a known length. Returns null for absent/unsatisfiable/multi-range. */
export function parseRangeHeader(header, fileLength) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  let start;
  let end; // exclusive
  if (rawStart === '') {
    if (rawEnd === '') return null;
    const suffix = Number(rawEnd);
    start = Math.max(0, fileLength - suffix);
    end = fileLength;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? fileLength : Math.min(fileLength, Number(rawEnd) + 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= fileLength || end <= start) return null;
  return { start, end };
}
