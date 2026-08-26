/**
 * Fetches a small-body/comet trajectory SPK (segment type 21 --
 * see src/math/differenceArray.js) from JPL Horizons.
 *
 * https://ssd-api.jpl.nasa.gov/doc/horizons.html
 *
 * Everything here was verified against the *real* API while this was
 * being built, not just the docs -- including one genuinely
 * non-obvious quirk that would otherwise silently break every
 * request: **`COMMAND`'s value must include literal surrounding
 * single quotes as part of the string content itself**, not just
 * shell-escaping for curl the way the docs' own examples make it
 * look. Confirmed directly: `COMMAND=DES=2099942;` (properly percent-
 * encoded, no quotes) fails with `"missing COMMAND content"`;
 * `COMMAND='DES=2099942;'` (quotes as literal characters, *then*
 * percent-encoded as a whole) succeeds. buildHorizonsSpkUrl() below
 * always wraps the command value in `'...'` before handing it to
 * URLSearchParams for exactly this reason.
 *
 * `format=json` (used here, over the docs' `text` default) responds
 * `{ spk: "<base64>", spk_file_id, result, signature }` on success,
 * or `{ error: "<message>", result, signature }` (no `spk` key) on
 * failure or an ambiguous match -- much simpler to parse than `text`
 * format's SPK-blob-embedded-after-a-header-in-plain-text shape.
 *
 * No Node-server-only dependencies beyond the global `fetch()` --
 * same convention scripts/download-spk.mjs already uses for its own
 * outbound requests to NAIF -- so this module works unmodified from
 * scripts/serve-example.mjs's own Node process.
 */

const HORIZONS_API_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api';

// A numbered small body or comet, optionally with a comet-type suffix
// (P periodic, D defunct/disintegrated, X poorly-determined orbit --
// e.g. "99942", "1P", "73P"). A provisional designation is a 4-digit
// discovery year, a space, then the survey-designation letters/digits
// (e.g. "1999 AN10", "2023 DW"). Both need `DES=...;` -- see
// formatHorizonsCommand() below; anything else (a name like "Ceres"/
// "Apophis", a major-body ID, or a command the caller already
// qualified themselves) is sent through unchanged.
const NUMBERED_OBJECT_RE = /^[0-9]+[PDX]?$/i;
const PROVISIONAL_DESIGNATION_RE = /^[0-9]{4}\s[A-Za-z0-9]+$/;

/**
 * Formats a user-typed object identifier as a Horizons `COMMAND`
 * value -- `DES=<raw>;` for a numbered object/comet or a provisional
 * designation (see the patterns above), `raw` unchanged otherwise.
 * Does *not* add the literal single quotes buildHorizonsSpkUrl() below
 * needs -- that's a separate, unconditional step for every command,
 * not specific to the `DES=` branch.
 */
export function formatHorizonsCommand(raw) {
  const trimmed = String(raw).trim();
  if (NUMBERED_OBJECT_RE.test(trimmed) || PROVISIONAL_DESIGNATION_RE.test(trimmed)) {
    return `DES=${trimmed};`;
  }
  return trimmed;
}

/**
 * Builds the full Horizons API URL for an SPK request -- `EPHEM_TYPE=SPK`,
 * `REF_PLANE=ECLIPTIC`, `FRAME=J2000`, `CENTER=SUN` as specified, plus
 * the `COMMAND` quoting fix above (applied unconditionally, confirmed
 * necessary even for a bare/unqualified command).
 */
export function buildHorizonsSpkUrl({ command, startTime, stopTime }) {
  const params = new URLSearchParams({
    format: 'json',
    COMMAND: `'${formatHorizonsCommand(command)}'`,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'SPK',
    REF_PLANE: 'ECLIPTIC',
    FRAME: 'J2000',
    CENTER: 'SUN',
    START_TIME: startTime,
    STOP_TIME: stopTime,
  });
  return `${HORIZONS_API_URL}?${params}`;
}

/**
 * Fetches an SPK from Horizons for `command` over `[startTime,
 * stopTime]` (any date string Horizons accepts, e.g. `'2020-01-01'`),
 * returning `{ bytes: Uint8Array, id: spk_file_id }`.
 *
 * Throws a plain `Error` (message = Horizons' own `error` or `result`
 * text) if Horizons couldn't produce an SPK -- an ambiguous match (a
 * comet with several apparition/epoch records, e.g.), no match at
 * all, an object that isn't SPK-eligible (SPK generation is small-
 * body/comet only), or a genuine HTTP-level failure. Callers should
 * surface that message directly -- it's already the specific,
 * actionable text Horizons itself produced (which record didn't
 * match, why, etc.), not something worth re-wrapping.
 */
export async function fetchHorizonsSpk({ command, startTime, stopTime }) {
  const url = buildHorizonsSpkUrl({ command, startTime, stopTime });
  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new Error(`couldn't reach the Horizons API: ${err.message}`);
  }
  if (!response.ok) {
    throw new Error(`Horizons API request failed: HTTP ${response.status} ${response.statusText}`);
  }
  const body = await response.json();
  if (!body.spk) {
    throw new Error(body.error || body.result || 'Horizons did not return an SPK for this request (no reason given).');
  }
  return { bytes: Buffer.from(body.spk, 'base64'), id: body.spk_file_id };
}
