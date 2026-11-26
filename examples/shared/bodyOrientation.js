/**
 * Body-fixed -> inertial-frame rotation (the IAU pole/prime-meridian model) from
 * the BODY<id>_POLE_RA/POLE_DEC/PM/NUT_PREC_* constants in
 * kernels/pck00011.tpc -- the same constants spicejs's own IAU_<BODY>
 * frames use, but spicejs only exposes them through spkez() (rotating a
 * *position*), not as a matrix, which is what a textured three.js mesh
 * needs. Returns plain 3x3 row-major arrays; no three.js dependency
 * (see orbitMath.js for the same convention).
 */
const { bodyValues } = window.spicejs;

const DEG = Math.PI / 180;
const SECONDS_PER_DAY = 86400;
const DAYS_PER_CENTURY = 36525;

/** `bodyValues()`, but `[]` rather than a throw when the constant isn't in the pool. */
function valuesOrEmpty(id, name, pool) {
  try {
    return bodyValues(id, name, pool);
  } catch {
    return [];
  }
}

function rotZ(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}
function rotX(a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [[1, 0, 0], [0, c, -s], [0, s, c]];
}
function mul(a, b) {
  return a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
}

// IAU-76 mean obliquity of J2000, the one SPICE's ECLIPJ2000 frame uses.
const OBLIQUITY_J2000 = (84381.448 / 3600) * DEG;

/**
 * The rotation taking a body-fixed vector (x = prime meridian, z = north
 * pole) to J2000, at `et` (seconds past J2000, TDB). `bodyId` is the
 * physical body (e.g. 399 Earth, 301 Moon). Throws if the PCK doesn't
 * define the body's pole -- callers just skip orientation then.
 */
function bodyFixedToJ2000(bodyId, et, pool) {
  const ra = bodyValues(bodyId, 'POLE_RA', pool);
  const dec = bodyValues(bodyId, 'POLE_DEC', pool);
  const pm = bodyValues(bodyId, 'PM', pool);
  const days = et / SECONDS_PER_DAY;
  const T = days / DAYS_PER_CENTURY;

  let alpha = ra[0] + T * (ra[1] ?? 0) + T * T * (ra[2] ?? 0);
  let delta = dec[0] + T * (dec[1] ?? 0) + T * T * (dec[2] ?? 0);
  let W = pm[0] + days * (pm[1] ?? 0) + days * days * (pm[2] ?? 0);

  // Periodic terms, from the barycenter's shared phase angles
  // (e.g. BODY3_NUT_PREC_ANGLES for both Earth and the Moon's librations).
  const bary = Math.floor(bodyId / 100);
  const angles = valuesOrEmpty(bary, 'NUT_PREC_ANGLES', pool);
  const nutRa = valuesOrEmpty(bodyId, 'NUT_PREC_RA', pool);
  const nutDec = valuesOrEmpty(bodyId, 'NUT_PREC_DEC', pool);
  const nutPm = valuesOrEmpty(bodyId, 'NUT_PREC_PM', pool);
  const count = Math.max(nutRa.length, nutDec.length, nutPm.length);
  for (let i = 0; i < count; i++) {
    const theta = (angles[2 * i] + angles[2 * i + 1] * T) * DEG;
    alpha += (nutRa[i] ?? 0) * Math.sin(theta);
    delta += (nutDec[i] ?? 0) * Math.cos(theta);
    W += (nutPm[i] ?? 0) * Math.sin(theta);
  }

  return mul(mul(rotZ((alpha + 90) * DEG), rotX((90 - delta) * DEG)), rotZ(W * DEG));
}

/**
 * Body-fixed -> `frame` rotation, where `frame` is whichever inertial
 * frame the caller's positions are in: `'J2000'` or `'ECLIPJ2000'` (this
 * app's own INERTIAL_FRAME, see constants.js). The two differ by the
 * J2000 obliquity about x, so using the wrong one tilts every body's
 * spin axis and prime meridian relative to where it's drawn.
 */
export function bodyFixedToInertial(bodyId, et, pool, frame) {
  const r = bodyFixedToJ2000(bodyId, et, pool);
  if (frame === 'J2000') return r;
  if (frame === 'ECLIPJ2000') return mul(rotX(-OBLIQUITY_J2000), r);
  throw new Error(`bodyFixedToInertial: unsupported frame "${frame}"`);
}
