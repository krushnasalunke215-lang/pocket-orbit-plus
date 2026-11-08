import { CircleGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry } from '@iwsdk/core';
import { ROLE_COLORS } from './palette.js';
import { noRaycast } from './shaders/common.js';
import type { ReticleVisual } from './visual-types.js';

/*
 * Hit-test reticle for Your Table: a flat ring with a center dot, in world
 * meters, lying in the root's XZ plane (EnvironmentRaycastSystem turns the
 * root's +Y to the hit surface's normal). Not occludable and never a ray
 * target: it marks where a real surface is. The root's own `visible` belongs
 * to EnvironmentRaycastSystem (hit or no hit); show() toggles the shape.
 */

const ringGeometry = new RingGeometry(0.011, 0.015, 40).rotateX(-Math.PI / 2);
const dotGeometry = new CircleGeometry(0.003, 16).rotateX(-Math.PI / 2);
/** Lifts the shape off the surface so it never sinks into it. */
const SURFACE_LIFT = 0.002;
const RETICLE_RENDER_ORDER = 6;

export function createReticleVisual(): ReticleVisual {
  const material = new MeshBasicMaterial({
    color: ROLE_COLORS.reticleFallback,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  });
  const root = new Group();
  root.name = 'Reticle';
  root.visible = false;
  const shape = new Group();
  shape.position.y = SURFACE_LIFT;
  shape.visible = false;
  for (const geometry of [ringGeometry, dotGeometry]) {
    const mesh = new Mesh(geometry, material);
    mesh.raycast = noRaycast;
    mesh.renderOrder = RETICLE_RENDER_ORDER;
    shape.add(mesh);
  }
  root.add(shape);
  let onObjectNow = false;
  return {
    root,
    show(visible, onObject) {
      shape.visible = visible;
      if (visible && onObject !== onObjectNow) {
        onObjectNow = onObject;
        material.color.setHex(onObject ? ROLE_COLORS.reticleObject : ROLE_COLORS.reticleFallback);
      }
    },
  };
}
