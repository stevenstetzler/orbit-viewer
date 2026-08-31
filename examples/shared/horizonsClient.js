/**
 * JPL Horizons client -- the two network calls behind "Fetch from JPL
 * Horizons" (see scripts/horizonsSpk.mjs's own doc comment for what the
 * proxy endpoints actually do, including its SPK cache). No DOM here;
 * a caller wires these into whatever status/candidate-list UI it has.
 *
 * This module is imported from pages at different depths (`/close-approach/`,
 * `/examples/browser-demo/`, `/<body>/`, ...), and `fetch()`'s relative
 * resolution is always against the *document's* URL, never the
 * executing module's own -- so a hand-relative path here would be
 * correct for whichever page happens to import it and wrong for every
 * other depth. Anchoring to this module's own fixed location via
 * `import.meta.url` instead (which always resolves to this file,
 * independent of who imported it) sidesteps that entirely -- same
 * pattern `examples/browser-demo/index.html` already uses for its own
 * kernel references (e.g. `new URL('../../kernels/naif0012.tls', import.meta.url)`).
 */
const SITE_ROOT = new URL('../../', import.meta.url); // examples/shared/ -> site root

export function formatBytesShort(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Resolves `sstr` to a real SPK-ID through /horizons/resolve. Throws
 * only for a genuine proxy-level failure; `found`/`ambiguous`/
 * `not-found` are all normal returns for the caller to branch on.
 */
export async function resolveHorizonsObject(sstr) {
  const response = await fetch(new URL(`horizons/resolve?${new URLSearchParams({ sstr })}`, SITE_ROOT));
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || `HTTP ${response.status} ${response.statusText}`);
  return body;
}

/** Fetches an already-resolved `spkid`'s trajectory SPK through /horizons/spk. Returns the raw bytes (ArrayBuffer). */
export async function fetchHorizonsSpk({ spkid, start, stop }) {
  const url = new URL(`horizons/spk?${new URLSearchParams({ spkid, start, stop })}`, SITE_ROOT).href;
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `HTTP ${response.status} ${response.statusText}`);
  }
  return response.arrayBuffer();
}

/** A safe-ish filename fragment from a display label -- used to name the synthetic File built from fetched bytes. */
export function safeFileFragment(label, fallback) {
  return label.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || fallback;
}
