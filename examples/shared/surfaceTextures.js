/**
 * Surface images for the textured body spheres, shared by the /<body>/
 * and /<body>/trajectory/ templates -- see textures/README.md for
 * sources. Both images are equirectangular with longitude 0 at the
 * centre; bodies without an entry stay flat-colored. Orientation comes
 * from bodyOrientation.js's IAU pole/prime-meridian model.
 */
import * as THREE from 'three';
import { INERTIAL_FRAME } from './constants.js';
import { bodyFixedToInertial } from './bodyOrientation.js';

// Resolved against this module, not the page, since the two templates
// live at different depths (/earth/ vs /earth/trajectory/).
const SURFACE_TEXTURES = {
  399: new URL('../../textures/earth.jpg', import.meta.url).href,
  301: new URL('../../textures/moon.jpg', import.meta.url).href,
};
const textureLoader = new THREE.TextureLoader();

/**
 * Body-fixed -> three.js local axes for a SphereGeometry: its poles are on
 * +Y and u = 0.5 (image centre, longitude 0) is on +X, with longitude
 * increasing toward -Z. So body x -> X, body z (north pole) -> Y,
 * body y (90 degrees E) -> -Z. The same Y/Z swap scale.js's
 * scaleLinearPosition() applies to positions also takes the page's
 * inertial frame (INERTIAL_FRAME) -> scene.
 */
const BODY_TO_SPHERE = new THREE.Matrix4().set(
  1, 0, 0, 0,
  0, 0, 1, 0,
  0, -1, 0, 0,
  0, 0, 0, 1,
);
const SPHERE_TO_BODY = BODY_TO_SPHERE.clone().invert();
const INERTIAL_TO_SCENE = BODY_TO_SPHERE;

export function hasSurfaceTexture(b) {
  return b.bodyId in SURFACE_TEXTURES;
}

/** The sphere + material for one body's marker -- textured if it has an image, else the flat emissive color. */
export function makeMarkerMesh(b, radius, isCentral, renderer) {
  if (!hasSurfaceTexture(b)) {
    return new THREE.Mesh(
      new THREE.SphereGeometry(radius, 20, 16),
      new THREE.MeshStandardMaterial({ color: b.color, emissive: b.color, emissiveIntensity: isCentral ? 1.2 : 0.15 }),
    );
  }
  const map = textureLoader.load(SURFACE_TEXTURES[b.bodyId]);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = renderer.capabilities.getMaxAnisotropy();
  // Mostly self-lit (the scene's lights are just a viewer-side point light
  // and ambient fill, not the Sun), so the image reads at any angle.
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, 96, 48),
    new THREE.MeshStandardMaterial({
      map, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: isCentral ? 0.5 : 0.35, roughness: 1, metalness: 0,
    }),
  );
}

/**
 * Spins a textured body's marker to its real orientation at `et` (no-op
 * for untextured bodies). Throws if the PCK lacks the body's pole.
 */
export function orientMarker(b, et, pool) {
  if (!hasSurfaceTexture(b)) return;
  const r = bodyFixedToInertial(b.bodyId, et, pool, INERTIAL_FRAME);
  const rot = new THREE.Matrix4().set(
    r[0][0], r[0][1], r[0][2], 0,
    r[1][0], r[1][1], r[1][2], 0,
    r[2][0], r[2][1], r[2][2], 0,
    0, 0, 0, 1,
  );
  b.marker.quaternion.setFromRotationMatrix(INERTIAL_TO_SCENE.clone().multiply(rot).multiply(SPHERE_TO_BODY));
}
