import { AdditiveBlending, Group, Mesh, MeshBasicMaterial, SphereGeometry } from '@iwsdk/core';
import { ROLE_COLORS } from './palette.js';
import type { CometVisual } from './visual-types.js';

// Placeholder look (FEAT-004 adds the particle tail): a bright head inside
// an additive glow, in board units.
const headGeometry = new SphereGeometry(0.03, 16, 12);
const glowGeometry = new SphereGeometry(0.065, 16, 12);
const headMaterial = new MeshBasicMaterial({ color: ROLE_COLORS.comet, toneMapped: false });
const glowMaterial = new MeshBasicMaterial({
  color: ROLE_COLORS.cometTrail,
  transparent: true,
  opacity: 0.35,
  blending: AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
});

export function createCometVisual(): CometVisual {
  const root = new Group();
  root.name = 'Comet';
  const glow = new Mesh(glowGeometry, glowMaterial);
  glow.renderOrder = 2;
  root.add(new Mesh(headGeometry, headMaterial), glow);
  return {
    root,
    setVisible(visible) {
      root.visible = visible;
    },
    setPosition(p) {
      root.position.set(p[0], p[1], p[2]);
    },
    update() {},
  };
}
