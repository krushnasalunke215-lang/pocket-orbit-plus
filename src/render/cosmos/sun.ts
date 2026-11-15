import { Mesh, PlaneGeometry, Vector3 } from '@iwsdk/core';
import { SUN_DIRECTION, SUN_DISTANCE } from '../../config.js';
import { noRaycast } from '../shaders/common.js';
import { createSunMaterial } from '../shaders/cosmos.js';

/*
 * The sun: one camera-facing quad (one draw call) at SUN_DIRECTION *
 * SUN_DISTANCE in the cosmos frame, the key light's visible source (every
 * sun-lit shader reads SUN_DIR_W, the same direction in world space). Its
 * glare grows as the view turns toward it (additive sprite, no
 * post-processing). Drawn after the planets, depth-tested, so a planet in
 * front hides it.
 */

/** Base glow radius in meters at SUN_DISTANCE (the core is about 4.5% of it: about 0.6 degrees). */
const SUN_RADIUS = 10;

export function createSun(): Mesh {
  const position = new Vector3(SUN_DIRECTION[0], SUN_DIRECTION[1], SUN_DIRECTION[2]).normalize().multiplyScalar(SUN_DISTANCE);
  const mesh = new Mesh(new PlaneGeometry(2, 2), createSunMaterial(position, SUN_RADIUS));
  mesh.name = 'CosmosSun';
  mesh.frustumCulled = false;
  mesh.renderOrder = -6.4;
  mesh.raycast = noRaycast;
  return mesh;
}
