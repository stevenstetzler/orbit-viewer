/**
 * Position/radius scale conversions -- km to Three.js scene units.
 * Extracted from `examples/browser-demo/index.html` (see that file's
 * own comments for the full "why sqrt, why not log" reasoning); no
 * behavioral change. Every function here is pure/parametrized -- none
 * of them read a module-level session object -- so any page can keep
 * its own local session state and just pass in whatever's needed.
 */
import { bodyValues } from '../../src/browser.js';
import { POSITION_LINEAR_SCALE, POSITION_SQRT_SCALE, RADIUS_SCENE_SCALE, PRECISE_BODY_RADIUS_UNITS } from './constants.js';

/**
 * Applies one *uniform* km-to-scene-unit `factor` to a km position
 * vector. Positions arrive already rotated into whatever frame is
 * active; three.js's default "up" is Y, so swap Y/Z for a natural
 * top-down view of the (near-ecliptic-coplanar) solar system.
 */
export function scaleLinearPosition(posKm, factor) {
  return [posKm[0] * factor, posKm[2] * factor, -posKm[1] * factor];
}

/**
 * Converts a km position vector to scene space along a chosen radial
 * scale (`mode`: `'linear'` or `'sqrt'`) -- direction is always
 * preserved exactly, only the magnitude is compressed. `'linear'` is
 * always POSITION_LINEAR_SCALE (the fixed AU-anchored factor); when
 * both position and radius are meant to be linear, use makeScale()'s
 * tied Linear+Linear case instead of this function directly (see its
 * own doc comment for why).
 */
export function scalePosition(posKm, mode) {
  const rKm = Math.hypot(posKm[0], posKm[1], posKm[2]);
  if (rKm === 0) return [0, 0, 0];
  const rScene = mode === 'sqrt' ? Math.sqrt(rKm) * POSITION_SQRT_SCALE : rKm * POSITION_LINEAR_SCALE;
  return scaleLinearPosition(posKm, rScene / rKm);
}

/**
 * A body's real mean radius in km -- BODY<id>_RADII, averaged across
 * the (up to triaxial) axes -- computed once and cached on the body
 * object (`b.meanRadiusKm`, `null` if unavailable).
 */
export function meanRadiusKmFor(b, pool) {
  if ('meanRadiusKm' in b) return b.meanRadiusKm;
  try {
    const radii = bodyValues(b.bodyId, 'RADII', pool);
    b.meanRadiusKm = (radii[0] + radii[1] + radii[2]) / 3;
  } catch {
    b.meanRadiusKm = null;
  }
  return b.meanRadiusKm;
}

/**
 * A body's marker radius in scene units, along a chosen radial scale.
 * `'sqrt'` is `RADIUS_SCENE_SCALE * sqrt(km)`; `'linear'` is one true
 * km-to-scene-unit factor anchored to `anchorKm` (typically the
 * smallest body actually shown, so it -- and everything larger --
 * renders at a guaranteed-visible size). No real RADII data falls back
 * to a small placeholder, per-body in sqrt mode, flat in linear mode.
 */
export function scaleRadius(b, mode, anchorKm, pool) {
  const km = meanRadiusKmFor(b, pool);
  if (km != null) {
    return mode === 'sqrt' ? RADIUS_SCENE_SCALE * Math.sqrt(km) : km * (PRECISE_BODY_RADIUS_UNITS / anchorKm);
  }
  return mode === 'sqrt' ? b.fallbackRadius * 0.05 : 0.02;
}

/** The smallest known real radius (km) among `bodies` -- the anchor for Linear radius mode's single km-to-scene-unit factor. */
export function smallestKnownRadiusKm(bodies, pool) {
  const known = bodies.map((b) => meanRadiusKmFor(b, pool)).filter((km) => km != null);
  return known.length ? Math.min(...known) : null;
}

/**
 * Builds a `{ posToScene, markerRadius }` scale object for the current
 * Position scale/Radius scale mode pair. When both are `'linear'`, ties
 * them to ONE shared km-to-scene-unit factor (anchored to
 * `radiusAnchorKm`, typically the smallest body shown) instead of two
 * independent factors -- this is what makes a true Linear/Linear
 * ("precise") view physically consistent: the same km maps to the same
 * scene unit whether it's a position or a radius, so a body's real
 * apparent size relative to its real orbital distance is preserved.
 * Any other combination uses scalePosition()/scaleRadius()'s own
 * independent factors, matching system mode's Linear-position +
 * Sqrt-radius default.
 */
export function makeScale({ positionMode, radiusMode, radiusAnchorKm, pool }) {
  if (positionMode === 'linear' && radiusMode === 'linear' && radiusAnchorKm != null) {
    const factor = PRECISE_BODY_RADIUS_UNITS / radiusAnchorKm; // scene units per km, shared
    return {
      posToScene: (posKm) => scaleLinearPosition(posKm, factor),
      markerRadius: (b) => {
        const km = meanRadiusKmFor(b, pool);
        return km != null ? km * factor : 0.02;
      },
    };
  }
  return {
    posToScene: (posKm) => scalePosition(posKm, positionMode),
    markerRadius: (b) => scaleRadius(b, radiusMode, radiusAnchorKm, pool),
  };
}

/**
 * makeScale(), but for Linear radius mode the anchor is always freshly
 * computed from whatever's actually in `bodies` right now (see
 * smallestKnownRadiusKm()). Falls back to Sqrt radius if Linear was
 * requested but nothing currently shown has a known real radius.
 * `onFallback`, if given, is called (no args) when that fallback fires,
 * so a caller can reset its own UI state (e.g. a radius-mode `<select>`).
 */
export function buildCurrentScale(positionMode, radiusMode, bodies, pool, onFallback) {
  if (radiusMode === 'linear') {
    const anchorKm = smallestKnownRadiusKm(bodies, pool);
    if (anchorKm != null) return makeScale({ positionMode, radiusMode: 'linear', radiusAnchorKm: anchorKm, pool });
    if (onFallback) onFallback();
    return makeScale({ positionMode, radiusMode: 'sqrt', radiusAnchorKm: null, pool });
  }
  return makeScale({ positionMode, radiusMode, radiusAnchorKm: null, pool });
}
