import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  Mesh,
  PlaneGeometry,
  Points,
  Vector2,
  type Vector3,
} from '@iwsdk/core';
import { TILE } from './cosmos/planets.js';
import { mulberry32 } from './cosmos/random.js';
import { HALOS } from './halo-sprites.js';
import { bakeLumpyGeometry } from './lumpy-geometry.js';
import { markRange, noRaycast, setSharedTime } from './shaders/common.js';
import { createSurfaceMaterial } from './shaders/planet.js';
import { ANTI_SUN, ionTailMaterial, tailMaterial } from './shaders/tail.js';
import type { CometVisual } from './visual-types.js';

/*
 * Comet: a small lumpy icy nucleus lit by the sun (the ice atlas tile, a
 * glint), a cool coma halo slot, and two tails. The dust tail is a 512-slot
 * particle ring buffer: three particles per frame while the head moves,
 * each drifting back along the motion and away from the sun with a little
 * spread, so the tail curves and fans warm white to gold to dust. The ion
 * tail is one straight pale-blue strip from the head directly away from
 * the sun. The root stays at the board origin (lifted); the head moves and
 * tail particles keep the board position they were emitted at. setOpacity
 * fades the nucleus, both tails and the coma together (the attract loop).
 */

const TAIL_CAPACITY = 512;
const EMIT_PER_FRAME = 3;
/** A jump longer than this (level change, replay) is a teleport: no particles. */
const MAX_STEP = 0.25;
/** Dust drift: back along the motion, away from the sun, and spread (board units/s). */
const DRIFT_BACK = 0.1;
const DRIFT_ANTI_SUN = 0.18;
const DRIFT_SPREAD = 0.06;
const COMA_SIZE = 0.12;
const COMA_ALPHA = 0.5;
const NUCLEUS_RADIUS = 0.026;

/** The nucleus, baked once: a lumpy icosphere (radius 0.78-1.1) with a few pits. */
const nucleusGeometry = bakeLumpyGeometry(2, 0xc0e7, 0.78, 1.1, 4);
const nucleusMaterial = createSurfaceMaterial({
  color: 0xc8d2dc,
  band: 0x9aa6b4,
  rim: 0xdff0ff,
  seed: 0.5,
  bandScale: 3,
  tile: TILE.ice,
  bump: 0.14,
  ocean: 0.6,
  rimStrength: 0.5,
  atmosphere: { color: 0xbfe4ff, strength: 0.5 },
});
nucleusMaterial.transparent = true;
const ionGeometry = new PlaneGeometry(1, 1, 1, 12).translate(0, 0.5, 0);

const drawingBuffer = new Vector2();

export function createCometVisual(): CometVisual {
  const root = new Group();
  root.name = 'Comet';
  const head = new Group();
  head.name = 'CometHead';
  const nucleus = new Mesh(nucleusGeometry, nucleusMaterial);
  nucleus.scale.setScalar(NUCLEUS_RADIUS);
  nucleus.renderOrder = 4;
  nucleus.raycast = noRaycast;
  head.add(nucleus);

  const positions = new BufferAttribute(new Float32Array(TAIL_CAPACITY * 3), 3).setUsage(DynamicDrawUsage);
  const births = new BufferAttribute(new Float32Array(TAIL_CAPACITY).fill(-1e4), 1).setUsage(DynamicDrawUsage);
  const velocities = new BufferAttribute(new Float32Array(TAIL_CAPACITY * 3), 3).setUsage(DynamicDrawUsage);
  const tailGeometry = new BufferGeometry();
  tailGeometry.setAttribute('position', positions);
  tailGeometry.setAttribute('aBirth', births);
  tailGeometry.setAttribute('aVel', velocities);
  const tail = new Points(tailGeometry, tailMaterial);
  tail.name = 'CometTail';
  tail.frustumCulled = false;
  tail.renderOrder = 3;
  tail.raycast = noRaycast;
  // Point sizes are in pixels: keep the board-unit size right for the current target.
  tail.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(drawingBuffer);
    tailMaterial.uniforms.uPixelScale.value = drawingBuffer.y * 0.5;
  };
  const ion = new Mesh(ionGeometry, ionTailMaterial);
  ion.name = 'CometIonTail';
  ion.frustumCulled = false;
  ion.renderOrder = 3;
  ion.raycast = noRaycast;
  const ionHead = ionTailMaterial.uniforms.uHead.value as Vector3;
  root.add(tail, ion, head);

  const coma = HALOS.allocate(0xbfe0ff, COMA_ALPHA);
  const random = mulberry32(0xc0e7);
  const last = [0, 0, 0];
  let hasLast = false;
  let next = 0;
  let opacity = 1;

  const emit = (x: number, y: number, z: number, vx: number, vy: number, vz: number, t: number) => {
    const p = positions.array as Float32Array;
    const b = births.array as Float32Array;
    const v = velocities.array as Float32Array;
    const k = next * 3;
    const j = 0.006;
    p[k] = x + (random() - 0.5) * j;
    p[k + 1] = y + (random() - 0.5) * j;
    p[k + 2] = z + (random() - 0.5) * j;
    // Back along the motion, away from the sun, and a little spread: the tail curves and fans.
    v[k] = -vx * DRIFT_BACK + ANTI_SUN.x * DRIFT_ANTI_SUN + (random() - 0.5) * DRIFT_SPREAD;
    v[k + 1] = -vy * DRIFT_BACK + ANTI_SUN.y * DRIFT_ANTI_SUN + (random() - 0.5) * DRIFT_SPREAD;
    v[k + 2] = -vz * DRIFT_BACK + ANTI_SUN.z * DRIFT_ANTI_SUN + (random() - 0.5) * DRIFT_SPREAD;
    b[next] = t;
    markRange(positions, next, 1);
    markRange(velocities, next, 1);
    markRange(births, next, 1);
    next = (next + 1) % TAIL_CAPACITY;
  };

  return {
    root,
    setVisible(visible) {
      root.visible = visible;
      if (!visible) hasLast = false;
    },
    setPosition(p) {
      head.position.set(p[0], p[1], p[2]);
    },
    setOpacity(alpha) {
      const a = Math.min(1, Math.max(0, alpha));
      if (a === opacity) return;
      opacity = a;
      // One comet per page, so its module-shared materials carry its opacity.
      nucleusMaterial.uniforms.uOpacity.value = a;
      nucleus.visible = a > 0;
      ion.visible = a > 0;
      tailMaterial.uniforms.uOpacity.value = a;
      ionTailMaterial.uniforms.uOpacity.value = a;
      HALOS.setAlpha(coma, COMA_ALPHA * a);
      // An invisible comet may jump (relaunch); no tail along the jump.
      if (a <= 0) hasLast = false;
    },
    update(dt, t) {
      setSharedTime(t);
      const hp = head.position;
      ionHead.copy(hp);
      nucleus.rotation.set(t * 0.7, t * 0.45, 0);
      if (root.visible && opacity > 0) {
        const dx = hp.x - last[0];
        const dy = hp.y - last[1];
        const dz = hp.z - last[2];
        const step = Math.hypot(dx, dy, dz);
        if (hasLast && step > 1e-5 && step < MAX_STEP) {
          const inv = dt > 0 ? 1 / dt : 0;
          for (let i = 1; i <= EMIT_PER_FRAME; i++) {
            const f = i / EMIT_PER_FRAME;
            emit(last[0] + dx * f, last[1] + dy * f, last[2] + dz * f, dx * inv, dy * inv, dz * inv, t - dt * (1 - f));
          }
        }
        last[0] = hp.x;
        last[1] = hp.y;
        last[2] = hp.z;
        hasLast = true;
      }
      // HALOS lives under the board visual, the head under the (lifted) comet root.
      HALOS.setPosition(coma, hp.x, hp.y + root.position.y, hp.z);
      HALOS.setSize(coma, root.visible ? COMA_SIZE : 0);
    },
    headPose(out) {
      const hp = head.position;
      out[0] = hp.x;
      out[1] = hp.y + root.position.y;
      out[2] = hp.z;
      return root.visible && opacity > 0 ? NUCLEUS_RADIUS * 1.3 : 0;
    },
  };
}
