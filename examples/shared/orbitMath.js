/**
 * Two-body orbit geometry and trajectory-mode sampling -- extracted from
 * `examples/browser-demo/index.html` (see that file's own comments for
 * the full "why" behind the vis-viva/curvature-based-step math; not
 * repeated here in full). No three.js dependency: every vector here is
 * a plain `[x, y, z]` array, so this module stays usable from a Node
 * script (tests, benchmarks) as well as any page's own three.js scene.
 */
import { spkez, bodyValues } from '../../src/browser.js';
import { SUN_TARGET, SSB, INERTIAL_FRAME, DAY, ARC_MAX_SAMPLES, ARC_MAX_SAMPLES_ABSOLUTE_CEILING, ARC_MIN_SAMPLES, ARC_SAMPLES_PER_LOOP, TRAJECTORY_STEP_EPSILON_KM, TRAJECTORY_FALLBACK_HALF_SPAN_DAYS, CUSTOM_TRAJECTORY_RESOLUTION_SECONDS, CUSTOM_TRAJECTORY_MAX_SAMPLES } from './constants.js';

const vSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vScale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const vDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vLen = (a) => Math.hypot(a[0], a[1], a[2]);

/**
 * A body's real (osculating) two-body orbit state relative to
 * `primaryId`, at `et`, in `primaryId`'s own rest frame. From the
 * standard two-body conserved quantities (vis-viva, angular momentum,
 * eccentricity vector), using the reduced two-body `mu = GM(primary) +
 * GM(body)`.
 *
 * Returns `{ r, v, mu, e, invA, pHat, qHat, hHat }` (plain `[x,y,z]`
 * arrays for the vector fields) -- deliberately does *not* throw for an
 * unbound orbit (`invA <= 0`, parabolic/hyperbolic); callers branch on
 * that themselves (closed ellipse vs. open prop2b() arc). Still throws
 * for a rectilinear orbit (zero angular momentum -- no well-defined
 * plane) or if the primary's own GM lookup fails entirely.
 */
export function computeOrbitState(targetId, primaryId, et, pool) {
  const muPrimary = bodyValues(primaryId, 'GM', pool)[0];
  let muTarget = 0;
  try {
    muTarget = bodyValues(targetId, 'GM', pool)[0];
  } catch {
    // No real GM for this body -- treated as massless, still resolves.
  }
  const mu = muPrimary + muTarget;

  const { position: r, velocity: v } = spkez(targetId, primaryId, et, 'NONE', INERTIAL_FRAME, pool);
  const rMag = vLen(r);
  const vMag = vLen(v);
  const invA = 2 / rMag - (vMag * vMag) / mu;

  const h = vCross(r, v);
  if (vDot(h, h) === 0) {
    throw new Error('rectilinear orbit (zero angular momentum) -- no well-defined orbital plane');
  }
  const hHat = vScale(h, 1 / vLen(h));

  const eVec = vSub(vScale(vCross(v, h), 1 / mu), vScale(r, 1 / rMag));
  const e = vLen(eVec);

  const ECCENTRICITY_EPS = 1e-8;
  const pHat = e > ECCENTRICITY_EPS ? vScale(eVec, 1 / e) : vScale(r, 1 / rMag);
  const qHat = (() => {
    const q = vCross(hHat, pHat);
    return vScale(q, 1 / vLen(q));
  })();

  return { r, v, mu, e, invA, pHat, qHat, hHat };
}

/** Kepler's third law, `P = 2*pi*sqrt(a^3/mu)`. */
export function periodFromEllipse({ a, mu }) {
  return 2 * Math.PI * Math.sqrt((a * a * a) / mu);
}

/**
 * A body's own **sidereal** period: relative to the SSB, using the
 * Sun's GM as the approximating two-body primary (accurate to the
 * extent the Sun dominates the system's mass). Throws for the Sun
 * itself (no well-defined orbital period of its own -- its motion
 * around the SSB isn't a two-body orbit) and for a genuinely unbound
 * state.
 */
export function siderealPeriodSeconds(targetId, et, pool) {
  if (targetId === SUN_TARGET) {
    throw new Error("the Sun has no well-defined orbital period of its own (it isn't orbiting anything in the two-body sense -- its motion around the SSB is a superposition of every other body's pull)");
  }
  const muSun = bodyValues(SUN_TARGET, 'GM', pool)[0];
  let muTarget = 0;
  try {
    muTarget = bodyValues(targetId, 'GM', pool)[0];
  } catch {
    // No real GM for this body -- treated as massless, still resolves.
  }
  const mu = muSun + muTarget;

  const { position, velocity } = spkez(targetId, SSB, et, 'NONE', INERTIAL_FRAME, pool);
  const rMag = vLen(position);
  const vMag = vLen(velocity);
  const invSemiMajorAxis = 2 / rMag - (vMag * vMag) / mu;
  if (invSemiMajorAxis <= 0) {
    throw new Error('orbit around the SSB is not bound (unbound/parabolic) at this epoch');
  }
  return periodFromEllipse({ a: 1 / invSemiMajorAxis, mu });
}

/**
 * How many points sampleArcAdaptive() may spend on one body's arc,
 * scaled to how many times CENTER itself laps the Sun within that
 * body's own window, and to how much faster/slower CENTER is than
 * `referencePeriodSeconds` (Earth's own period -- the density target
 * this whole scheme was calibrated against). See
 * examples/browser-demo/index.html's own arcSampleBudget() comment for
 * the full derivation and live-verified numbers.
 */
export function arcSampleBudget(windowSpanSeconds, centerPeriodSeconds, referencePeriodSeconds) {
  if (!(centerPeriodSeconds > 0)) return ARC_MAX_SAMPLES;
  const impliedLoops = windowSpanSeconds / centerPeriodSeconds;
  const target = Math.ceil(Math.max(1, impliedLoops) * ARC_SAMPLES_PER_LOOP);
  const scale = referencePeriodSeconds > 0 ? Math.max(1, referencePeriodSeconds / centerPeriodSeconds) : 1;
  const effectiveMax = Math.min(ARC_MAX_SAMPLES_ABSOLUTE_CEILING, Math.round(ARC_MAX_SAMPLES * scale));
  return Math.min(effectiveMax, Math.max(ARC_MIN_SAMPLES, target));
}

/** A body's own instantaneous two-body heliocentric acceleration, `a = -GM_Sun/r^3 * r`, `r` measured from the Sun. Used only to size the adaptive sampling step. */
function accelerationRelativeToSun(targetId, et, pool) {
  const muSun = bodyValues(SUN_TARGET, 'GM', pool)[0];
  const { position } = spkez(targetId, SUN_TARGET, et, 'NONE', INERTIAL_FRAME, pool);
  const rMag = vLen(position);
  return vScale(position, -muSun / (rMag * rMag * rMag));
}

/** Curvature-based dynamic step size for `targetId`'s arc relative to `centerId`, at `et`. `null` if the two accelerations coincide exactly. */
function trajectoryStepSeconds(targetId, centerId, et, pool) {
  const aTarget = accelerationRelativeToSun(targetId, et, pool);
  const aCenter = accelerationRelativeToSun(centerId, et, pool);
  const relAccel = vLen(vSub(aTarget, aCenter));
  return relAccel > 0 ? Math.sqrt((2 * TRAJECTORY_STEP_EPSILON_KM) / relAccel) : null;
}

/**
 * Samples `target`'s position relative to `observer` across [et0, et1],
 * marching forward with a curvature-based dynamic step, clamped to a
 * pace floor that guarantees the arc always reaches `et1` within
 * `maxSamples`. Returns an array of `{ et, position }` in time order.
 */
export function sampleArcAdaptive(target, observer, et0, et1, frame, pool, maxSamples = ARC_MAX_SAMPLES) {
  const at = (et) => ({ et, position: spkez(target, observer, et, 'NONE', frame, pool).position });
  const samples = [at(et0)];
  let et = et0;
  while (samples.length < maxSamples && et < et1) {
    const stepsLeft = maxSamples - samples.length;
    const paceFloor = (et1 - et) / stepsLeft;
    const curvatureDt = trajectoryStepSeconds(target, observer, et, pool);
    const dt = curvatureDt > 0 ? Math.max(curvatureDt, paceFloor) : paceFloor;
    const nextEt = Math.min(et1, et + dt);
    if (nextEt <= et) break;
    et = nextEt;
    samples.push(at(et));
  }
  return samples;
}

/**
 * `body`'s trajectory-mode sampling window, `[et - P/2, et + P/2]`,
 * sized per `periodMode` ('sidereal' or 'synodic' relative to
 * `centerBody`) -- see examples/browser-demo/index.html's own
 * trajectoryWindowForBody() for the full reasoning (the Sun's
 * mirror-period special case, the synodic-period identity, the
 * fallback +-30-day window). Always clamped to `[kernelStartEt,
 * kernelStopEt]` -- a body's real period can reach past the loaded
 * kernel's own coverage even when `et` itself can't.
 */
export function trajectoryWindowForBody(centerBody, body, et, pool, periodMode, kernelStartEt, kernelStopEt, log = () => {}) {
  const clampToKernel = ([start, end]) => [Math.max(start, kernelStartEt), Math.min(end, kernelStopEt)];
  try {
    if (body.target === SUN_TARGET && centerBody != null) {
      const mirrorPeriod = siderealPeriodSeconds(centerBody.target, et, pool);
      return clampToKernel([et - mirrorPeriod / 2, et + mirrorPeriod / 2]);
    }
    const bodyPeriod = siderealPeriodSeconds(body.target, et, pool);
    if (periodMode !== 'synodic' || centerBody == null) {
      return clampToKernel([et - bodyPeriod / 2, et + bodyPeriod / 2]);
    }
    const centerPeriod = siderealPeriodSeconds(centerBody.target, et, pool);
    const denom = Math.abs(bodyPeriod - centerPeriod);
    if (denom > 0) {
      const halfSynodic = (centerPeriod * bodyPeriod) / denom / 2;
      return clampToKernel([et - halfSynodic, et + halfSynodic]);
    }
    log(`  -> ${body.name}'s period matches ${centerBody.name}'s exactly (infinite synodic period); using a fallback +-${TRAJECTORY_FALLBACK_HALF_SPAN_DAYS}-day window.`);
  } catch (err) {
    log(`  -> couldn't determine ${body.name}'s ${periodMode} trajectory window (${err.message}); using a fallback +-${TRAJECTORY_FALLBACK_HALF_SPAN_DAYS}-day window.`);
  }
  const halfSpan = TRAJECTORY_FALLBACK_HALF_SPAN_DAYS * DAY;
  return clampToKernel([et - halfSpan, et + halfSpan]);
}

/**
 * How many evenly-spaced samples a custom/Horizons body's own
 * discovered interval needs for ~1-minute real resolution -- `ceil(span
 * / 60s) + 1`, capped at CUSTOM_TRAJECTORY_MAX_SAMPLES.
 */
export function customBodySampleCount(customIntervalStart, customIntervalEnd) {
  const spanSeconds = customIntervalEnd - customIntervalStart;
  const wanted = Math.ceil(spanSeconds / CUSTOM_TRAJECTORY_RESOLUTION_SECONDS) + 1;
  return Math.max(2, Math.min(wanted, CUSTOM_TRAJECTORY_MAX_SAMPLES));
}
