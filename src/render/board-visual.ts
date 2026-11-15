import { Group, Mesh, PlaneGeometry, type Vector4 } from '@iwsdk/core';
import { COSMOS_QUALITY } from '../config.js';
import { GRID_MAX_BODIES } from '../game/spacetime.js';
import { HALOS, OUTLINES, PULL_RINGS } from './halo-sprites.js';
import { boardMaterial, RIPPLE_SLOTS } from './shaders/board.js';
import { setMotionTime } from './shaders/common.js';
import type { BoardVisual } from './visual-types.js';

// The dark glass plate with the spacetime grid, in the board's XZ plane: a
// square of COSMOS_QUALITY.gridSegments cells per side (the shader bends it
// under the bodies and cuts it round at r 1.04). The board visual also
// parents the shared halo, pull-ring and high-contrast outline pools, so
// their slots live in board units.
const G = COSMOS_QUALITY.gridSegments;
const plateGeometry = new PlaneGeometry(2.16, 2.16, G, G).rotateX(-Math.PI / 2);

const grid = boardMaterial.uniforms.uGrid.value as Vector4[];
const shadows = boardMaterial.uniforms.uShadow.value as Vector4[];
const ripples = boardMaterial.uniforms.uRipple.value as Vector4[];

export function createBoardVisual(): BoardVisual {
  const root = new Group();
  root.name = 'BoardVisual';
  const plate = new Mesh(plateGeometry, boardMaterial);
  plate.name = 'BoardPlate';
  plate.renderOrder = -2;
  // Lift the pull rings a hair above the glass to avoid z-fighting.
  PULL_RINGS.mesh.position.y = 0.003;
  root.add(plate, PULL_RINGS.mesh, HALOS.mesh, OUTLINES.mesh);
  let nextRipple = 0;
  return {
    root,
    update(t) {
      setMotionTime(t);
    },
    setGridBody(i, x, z, pull, influence) {
      if (i < 0 || i >= GRID_MAX_BODIES) return;
      grid[i].set(x, z, pull, influence);
    },
    setShadow(i, x, h, z, r) {
      if (i < 0 || i >= GRID_MAX_BODIES) return;
      shadows[i].set(x, h, z, r);
    },
    setCounts(gridCount, shadowCount) {
      boardMaterial.uniforms.uGridCount.value = Math.min(gridCount, GRID_MAX_BODIES);
      boardMaterial.uniforms.uShadowCount.value = Math.min(shadowCount, GRID_MAX_BODIES);
    },
    ripple(x, z, strength, t) {
      ripples[nextRipple].set(x, z, t, strength);
      nextRipple = (nextRipple + 1) % RIPPLE_SLOTS;
    },
  };
}
