/**
 * Resolves a user-typed object identifier via JPL's Small-Body
 * Database (SBDB), then fetches that object's trajectory SPK
 * (segment type 21 -- see src/math/differenceArray.js) from Horizons.
 *
 * https://ssd-api.jpl.nasa.gov/doc/sbdb.html
 * https://ssd-api.jpl.nasa.gov/doc/horizons.html
 *
 * Two-step process, both confirmed against the *real* APIs while this
 * was being built, not just the docs:
 *
 * 1. `resolveSbdbObject(sstr)` -- SBDB's `sstr` parameter does fuzzy
 *    name/designation matching, so it's the resolver: exact match,
 *    ambiguous (several objects share the search string -- e.g.
 *    `sstr=141P` matches the parent comet and each of its numbered
 *    fragments), or no match, each with a different JSON shape (see
 *    the function's own doc comment). Every real trajectory-fetch
 *    path (fetchHorizonsSpk() below) needs the *SPK-ID* this step
 *    produces, not the raw string the user typed -- Horizons'
 *    `DES=` command needs a real designation/ID, and a bare name like
 *    "Ceres" isn't reliably one.
 * 2. `fetchHorizonsSpk({ spkid, ... })` -- once resolved to a single
 *    SPK-ID, fetches the actual SPK from Horizons via `COMMAND='DES=<spkid>'`.
 *    Confirmed working *without* a trailing semicolon when the value
 *    is a real numeric SPK-ID (unlike a bare designation like `1` or
 *    `99942`, which needs the semicolon to disambiguate from a major-
 *    body ID -- moot here, since SBDB's own `spkid` is never
 *    ambiguous with one).
 *
 * One genuinely non-obvious Horizons quirk, still relevant here:
 * **`COMMAND`'s value must include literal surrounding single quotes
 * as part of the string content itself**, not just shell-escaping for
 * curl the way the docs' own examples make it look. Confirmed
 * directly: `COMMAND=DES=2099942` (properly percent-encoded, no
 * quotes) fails with `"missing COMMAND content"`; `COMMAND='DES=2099942'`
 * (quotes as literal characters, *then* percent-encoded as a whole)
 * succeeds. buildHorizonsSpkUrl() below always wraps the command
 * value in `'...'` for exactly this reason.
 *
 * `format=json` (used for both APIs here, over the docs' `text`
 * default) is much simpler to parse than embedded-in-plain-text
 * shapes -- see each function's own doc comment for its exact fields.
 *
 * No Node-server-only dependencies beyond the global `fetch()` --
 * same convention scripts/download-spk.mjs already uses for its own
 * outbound requests to NAIF -- so this module works unmodified from
 * scripts/serve-example.mjs's own Node process.
 */

const SBDB_API_URL = 'https://ssd-api.jpl.nasa.gov/sbdb.api';
const HORIZONS_API_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api';

/**
 * Resolves `sstr` (whatever the user typed -- a name, a numbered or
 * provisional designation, a fragment like "141P-A") against JPL's
 * Small-Body Database. Returns one of:
 *
 * - `{ status: 'found', spkid, fullname }` -- unambiguous match
 *   (`body.object` present). `spkid` is what fetchHorizonsSpk() below
 *   needs; `fullname` is just for display.
 * - `{ status: 'ambiguous', candidates: [{ pdes, name }, ...] }` --
 *   more than one object matches (`body.list` present -- e.g.
 *   `sstr=141P` matches the parent comet and each numbered fragment).
 *   Each `pdes` is itself a valid `sstr` for a follow-up call to this
 *   same function, which resolves it unambiguously (confirmed:
 *   re-querying with a specific fragment's own `pdes` always returns
 *   `status: 'found'`).
 * - `{ status: 'not-found', message }` -- neither `object` nor `list`
 *   in the response; `message` is SBDB's own explanation (typically
 *   "specified object was not found").
 *
 * Throws a plain `Error` only for a genuine transport-level failure
 * (SBDB unreachable, non-OK HTTP status) -- every *legitimate* SBDB
 * outcome (found/ambiguous/not-found) is a normal return, not an
 * exception, since "not found" and "ambiguous" are routine results a
 * caller is expected to handle, not failures.
 */
export async function resolveSbdbObject(sstr) {
  const url = `${SBDB_API_URL}?${new URLSearchParams({ sstr })}`;
  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new Error(`couldn't reach the SBDB API: ${err.message}`);
  }
  // Deliberately *not* gating on response.ok: SBDB uses the HTTP status
  // itself to signal an ambiguous match (300 Multiple Choices, confirmed
  // directly -- e.g. sstr=141P) as well as, presumably, other non-2xx
  // codes for other outcomes -- but the response body is a normal,
  // fully-parseable JSON payload every time, carrying everything this
  // function needs (`object`/`list`/`message`). Only a body that isn't
  // valid JSON at all counts as a real failure here.
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`SBDB API returned an unexpected response: HTTP ${response.status} ${response.statusText}`);
  }
  if (body.object) {
    return { status: 'found', spkid: body.object.spkid, fullname: body.object.fullname };
  }
  if (Array.isArray(body.list)) {
    return { status: 'ambiguous', candidates: body.list.map(({ pdes, name }) => ({ pdes, name })) };
  }
  return { status: 'not-found', message: body.message || 'The specified object was not found.' };
}

/**
 * Builds the full Horizons API URL for an SPK request for `spkid`
 * (from resolveSbdbObject() above) -- `EPHEM_TYPE=SPK`,
 * `REF_PLANE=ECLIPTIC`, `FRAME=J2000`, `CENTER=SUN` as specified, plus
 * the `COMMAND` quoting fix above (applied unconditionally).
 */
export function buildHorizonsSpkUrl({ spkid, startTime, stopTime }) {
  const params = new URLSearchParams({
    format: 'json',
    COMMAND: `'DES=${spkid}'`,
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
 * Fetches an SPK from Horizons for a resolved `spkid` (see
 * resolveSbdbObject() -- this function deliberately does *not* take a
 * raw user-typed string; resolving that to a `spkid` first is the
 * caller's job, since it's a separate, disambiguation-capable step)
 * over `[startTime, stopTime]` (any date string Horizons accepts,
 * e.g. `'2020-01-01'`), returning `{ bytes: Uint8Array, id: spk_file_id }`.
 *
 * Throws a plain `Error` (message = Horizons' own `error` or `result`
 * text) if Horizons couldn't produce an SPK for this *specific*
 * spkid/time-range combination -- an object that isn't SPK-eligible
 * (SPK generation is small-body/comet only), a time range Horizons
 * can't integrate over, or a genuine HTTP-level failure. Callers
 * should surface that message directly -- it's already the specific,
 * actionable text Horizons itself produced, not something worth
 * re-wrapping. (Ambiguity itself can no longer happen here -- that's
 * resolveSbdbObject()'s job, upstream of this call.)
 */
export async function fetchHorizonsSpk({ spkid, startTime, stopTime }) {
  const url = buildHorizonsSpkUrl({ spkid, startTime, stopTime });
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
