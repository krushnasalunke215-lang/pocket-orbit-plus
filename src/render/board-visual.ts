import { CircleGeometry, Group, Mesh } from '@iwsdk/core';
import { POSTS, SHADOWS } from './contact-shadows.js';
import { HALOS, OUTLINES, PULL_RINGS } from './halo-sprites.js';
import { boardMaterial } from './shaders/board.js';
import { setMotionTime } from './shaders/common.js';
import type { BoardVisual } from './visual-types.js';

// The holographic glass disc (radius 1 plus a margin for the rim glow) in
// the board's XZ plane. The board visual also parents the shared halo and
// pull-ring, high-contrast outline, contact-shadow and light-post pools, so their
// slots live in board units.
const discGeometry = new CircleGeometry(1.08, 128).rotateX(-Math.PI / 2);

export function createBoardVisual(): BoardVisual {
  const root = new Group();
  root.name = 'BoardVisual';
  const disc = new Mesh(discGeometry, boardMaterial);
  disc.name = 'BoardDisc';
  disc.renderOrder = -2;
  // Lift the pull rings a hair above the glass to avoid z-fighting.
  PULL_RINGS.mesh.position.y = 0.003;
  root.add(disc, PULL_RINGS.mesh, SHADOWS.mesh, POSTS.mesh, HALOS.mesh, OUTLINES.mesh);
  return {
    root,
    update(t) {
      setMotionTime(t);
    },
  };
}
