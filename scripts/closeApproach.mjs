/**
 * Fetches Earth close-approach data from JPL's Small-Body Database's
 * Close-Approach Data (CAD) API -- same reasoning as horizonsSpk.mjs's
 * own two APIs for why this needs a server-side proxy: ssd-api.jpl.nasa.gov
 * sends no Access-Control-Allow-Origin, so a browser can never fetch()
 * it cross-origin.
 *
 * https://ssd-api.jpl.nasa.gov/doc/cad.html
 *
 * `dist-max=2LD` (2 lunar distances), `date-min=1900-01-01`, `sort=date`
 * are fixed -- this proxy always serves the same query the /close-approach/
 * page itself is built around, not an arbitrary passthrough. `diameter=true`
 * asks the API to also include each object's known diameter (from SBDB,
 * `null` when not known -- most rows), for the table's own Diameter column.
 * `dist`/`dist_min`/`dist_max` themselves are always in AU regardless of
 * `dist-max`'s own LD units (there's no `dist-unit` output parameter --
 * confirmed against the live API, which 400s on it) -- the client converts
 * to lunar distances for display itself (see close-approach/index.html's
 * own LD_KM).
 */

const CAD_API_URL = 'https://ssd-api.jpl.nasa.gov/cad.api';

/**
 * Returns the raw CAD API response body, parsed JSON:
 * `{ signature, count, fields, data }` -- `fields` names each column,
 * `data` is an array of arrays in that same column order (see the API's
 * own docs, or scripts/serve-example.mjs's doc comment for a sample).
 * Throws a plain `Error` for a genuine transport-level failure or a
 * response that isn't valid JSON.
 */
export async function fetchCloseApproachData() {
  const url = `${CAD_API_URL}?${new URLSearchParams({ 'dist-max': '2LD', 'date-min': '1900-01-01', sort: 'date', diameter: 'true' })}`;
  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new Error(`couldn't reach the CAD API: ${err.message}`);
  }
  if (!response.ok) {
    throw new Error(`CAD API request failed: HTTP ${response.status} ${response.statusText}`);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`CAD API returned an unexpected response: HTTP ${response.status} ${response.statusText}`);
  }
  if (!Array.isArray(body.data) || !Array.isArray(body.fields)) {
    throw new Error('CAD API response is missing its data/fields arrays.');
  }
  return body;
}
