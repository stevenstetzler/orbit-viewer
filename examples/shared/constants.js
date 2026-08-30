/**
 * Shared numeric constants for the curated demo pages (`/solar-system/`,
 * `/solar-system/trajectory/`, `/<body>/`, `/<body>/trajectory/`) --
 * extracted from `examples/browser-demo/index.html`, whose own inline
 * copies of these are the ones actually battle-tested across this
 * project's several rounds of live-data debugging (kernel-bounds
 * clamping, adaptive-sampling breakage, Earth-relative resolution
 * scaling -- see that file's own comments for the "why" behind each
 * value; kept here verbatim, without re-litigating it).
 *
 * `examples/browser-demo/index.html` itself is deliberately NOT changed
 * to import from here -- it stays a single, self-contained file, its own
 * "full exploration of the tool." This module (and the rest of
 * `examples/shared/`) exists so the newer, narrower pages don't each
 * carry their own independent copy of the same numbers.
 */

// AU, for scaling km positions down to a sane Three.js scene size.
export const AU_KM = 149597870.7;
export const DAY = 86400;

// Solar System Barycenter -- the default view center / SPK observer for
// chaining any body's state back to a common root.
export const SSB = 0;
export const SUN_TARGET = 10;
export const EARTH_TARGET = 399; // arcSampleBudget()'s own reference body

export const INERTIAL_FRAME = 'ECLIPJ2000';

// Position/marker-radius scale factors -- see scale.js for how these are
// used. SCENE_UNITS_PER_AU is system mode's Linear-position factor;
// EARTH_RADIUS_KM/RADIUS_SCENE_SCALE calibrate Sqrt-radius so the Sun's
// marker clears Mercury's real perihelion distance with margin.
export const SCENE_UNITS_PER_AU = 4.2;
export const EARTH_RADIUS_KM = 6378.1366;
export const RADIUS_SCENE_SCALE = 0.10 / Math.sqrt(EARTH_RADIUS_KM);
// Precise ("Linear/Linear") mode: the anchor body's own real radius, in
// scene units -- every position and marker radius in that view is one
// single, true, linear km-to-scene-unit scale anchored to this.
export const PRECISE_BODY_RADIUS_UNITS = 1.0;

export const POSITION_LINEAR_SCALE = SCENE_UNITS_PER_AU / AU_KM;
export const POSITION_SQRT_SCALE = SCENE_UNITS_PER_AU / Math.sqrt(AU_KM);

// Ellipse-mode orbit curve resolution -- a single fixed point count,
// since a closed analytic ellipse never aliases regardless of epoch.
export const ORBIT_ELLIPSE_SEGMENTS = 720;

// Trajectory-mode adaptive sampling budget -- see orbitMath.js's
// arcSampleBudget()/sampleArcAdaptive() for how these combine.
export const ARC_MAX_SAMPLES = 8000;
export const ARC_MAX_SAMPLES_ABSOLUTE_CEILING = 40000;
export const ARC_MIN_SAMPLES = 400;
export const ARC_SAMPLES_PER_LOOP = 96;
export const TRAJECTORY_STEP_EPSILON_KM = 0.01 * AU_KM;
export const TRAJECTORY_FALLBACK_HALF_SPAN_DAYS = 30;

// Custom/Horizons-body trajectory sampling: plain, uniform, whole-
// interval, never adaptive -- see orbitMath.js's customBodySampleCount().
export const CUSTOM_TRAJECTORY_RESOLUTION_SECONDS = 60; // ~1 minute
export const CUSTOM_TRAJECTORY_MAX_SAMPLES = 20000;
