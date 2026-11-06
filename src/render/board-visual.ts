import { CircleGeometry, Group, Mesh } from '@iwsdk/core';
import { HALOS, PULL_RINGS } from './halo-sprites.js';
import { boardMaterial } from './shaders/board.js';
import { setSharedTime } from './shaders/common.js';
import type { BoardVisual } from './visual-types.js';

// The holographic glass disc (radius 1 plus a margin for the rim glow) in
// the board's XZ plane. The board visual also parents the shared halo and
// pull-ring pools, so their slots live in board units.
const discGeometry = new CircleGeometry(1.08, 128).rotateX(-Math.PI / 2);

export function createBoardVisual(): BoardVisual {
  const root = new Group();
  root.name = 'BoardVisual';
  const disc = new Mesh(discGeometry, boardMaterial);
  disc.name = 'BoardDisc';
  disc.renderOrder = -2;
  // Lift the pull rings a hair above the glass to avoid z-fighting.
  PULL_RINGS.mesh.position.y = 0.003;
  root.add(disc, PULL_RINGS.mesh, HALOS.mesh);
  return {
    root,
    update(t) {
      setSharedTime(t);
    },
  };
}
