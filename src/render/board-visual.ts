import { CircleGeometry, Group, Mesh, MeshBasicMaterial, RingGeometry } from '@iwsdk/core';
import { ROLE_COLORS } from './palette.js';
import type { BoardVisual } from './visual-types.js';

// Placeholder look (FEAT-004 replaces the internals): a dark translucent
// disc with a thin rim, lying in the board's XZ plane at radius 1.
const discGeometry = new CircleGeometry(1, 64).rotateX(-Math.PI / 2);
const rimGeometry = new RingGeometry(0.975, 1, 96).rotateX(-Math.PI / 2);
const discMaterial = new MeshBasicMaterial({
  color: ROLE_COLORS.board,
  transparent: true,
  opacity: 0.6,
  depthWrite: false,
  toneMapped: false,
});
const rimMaterial = new MeshBasicMaterial({
  color: ROLE_COLORS.boardRim,
  transparent: true,
  opacity: 0.95,
  depthWrite: false,
  toneMapped: false,
});

export function createBoardVisual(): BoardVisual {
  const root = new Group();
  root.name = 'BoardVisual';
  const disc = new Mesh(discGeometry, discMaterial);
  disc.renderOrder = -2;
  const rim = new Mesh(rimGeometry, rimMaterial);
  rim.renderOrder = -1;
  root.add(disc, rim);
  return {
    root,
    update() {},
  };
}
