/**
 * JPL Horizons client -- the two network calls behind "Fetch from JPL
 * Horizons" (see scripts/horizonsSpk.mjs's own doc comment for what the
 * proxy endpoints actually do, including its SPK cache). No DOM here;
 * a caller wires these into whatever status/candidate-list UI it has.
 */

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
  const response = await fetch(`/horizons/resolve?${new URLSearchParams({ sstr })}`);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || `HTTP ${response.status} ${response.statusText}`);
  return body;
}

/** Fetches an already-resolved `spkid`'s trajectory SPK through /horizons/spk. Returns the raw bytes (ArrayBuffer). */
export async function fetchHorizonsSpk({ spkid, start, stop }) {
  const url = `/horizons/spk?${new URLSearchParams({ spkid, start, stop })}`;
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
