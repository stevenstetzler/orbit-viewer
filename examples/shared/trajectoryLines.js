/**
 * Trajectory-line drawing + its sidebar controls (a "show lines"
 * checkbox and a thickness slider), shared by solar-system/trajectory/
 * and the body-trajectory template. Plain THREE.Line is always one
 * pixel wide in WebGL, so lines are three.js's screen-space wide
 * `Line2`/`LineMaterial`, whose `linewidth` is in CSS pixels.
 *
 * The page calls makeLine() for each body's trajectory and disposeAll()
 * before rebuilding; the controls then update every live line in place
 * (no rebuild, no re-sampling) when toggled or dragged.
 */
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

const MIN_WIDTH = 0.5;
const MAX_WIDTH = 10;
const DEFAULT_WIDTH = 1.5;
const DIM = 0.6;

/**
 * @param {HTMLElement} container - the controls are appended here
 * @param {THREE.Scene} scene
 * @param {HTMLElement} viewport - sized element whose pixel size LineMaterial needs
 */
export function mountTrajectoryLines(container, scene, viewport) {
  const lines = new Set();
  let visible = true;
  let width = DEFAULT_WIDTH;

  container.innerHTML = `
    <label style="display:flex;align-items:center;gap:8px;margin:4px 0">
      <input type="checkbox" data-role="visible" checked /> Show trajectory lines
    </label>
    <label style="display:flex;align-items:center;gap:8px;margin:4px 0">
      <span style="flex:0 0 auto">Thickness</span>
      <input type="range" data-role="width" min="${MIN_WIDTH}" max="${MAX_WIDTH}" step="0.5" value="${DEFAULT_WIDTH}" style="flex:1 1 auto;min-width:0" />
      <span data-role="widthLabel" style="flex:0 0 auto;width:3.5em;text-align:right;color:#8892a6">${DEFAULT_WIDTH} px</span>
    </label>`;
  const visibleInput = container.querySelector('[data-role=visible]');
  const widthInput = container.querySelector('[data-role=width]');
  const widthLabel = container.querySelector('[data-role=widthLabel]');

  function apply() {
    for (const line of lines) {
      line.visible = visible && !line.userData.hidden;
      line.material.linewidth = width;
    }
  }
  visibleInput.addEventListener('change', () => { visible = visibleInput.checked; apply(); });
  widthInput.addEventListener('input', () => {
    width = Number(widthInput.value);
    widthLabel.textContent = `${width} px`;
    apply();
  });

  return {
    /** A wide line through `points` (THREE.Vector3[]) in `color`, added to the scene and tracked; `null` if there are fewer than two points. A `hidden` line stays off even when the global checkbox is on. */
    makeLine(points, color, hidden = false) {
      if (points.length < 2) return null;
      const geo = new LineGeometry();
      geo.setPositions(points.flatMap((p) => [p.x, p.y, p.z]));
      const mat = new LineMaterial({
        // Opaque, with the color dimmed toward the dark background instead of
        // using opacity: consecutive segments overlap at their joints, which
        // shows as mottling on a translucent wide line.
        color: new THREE.Color(color).multiplyScalar(DIM), linewidth: width,
        resolution: new THREE.Vector2(viewport.clientWidth, viewport.clientHeight),
      });
      const line = new Line2(geo, mat);
      line.userData.hidden = hidden;
      line.visible = visible && !hidden;
      lines.add(line);
      scene.add(line);
      return line;
    },
    /** Hides/shows one body's line regardless of the global checkbox (both must allow it). */
    setLineHidden(line, hidden) {
      if (!line) return;
      line.userData.hidden = hidden;
      line.visible = visible && !hidden;
    },
    /** Removes and frees every line made so far. */
    disposeAll() {
      for (const line of lines) {
        scene.remove(line);
        line.geometry.dispose();
        line.material.dispose();
      }
      lines.clear();
    },
    /** Call on window resize -- LineMaterial needs the viewport's pixel size. */
    setResolution(w, h) {
      for (const line of lines) line.material.resolution.set(w, h);
    },
  };
}
