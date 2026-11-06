import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../sim/vec.js';
import { boardToWorld, colliderLocalRadius, quatRotate } from './board-math.js';
import { HUD_SIZE, hudPose } from './hud-layout.js';
import { fallbackPlacement, type HeadPose } from './placement.js';

/*
 * Meta VR Glasses check (report section 6.7): from the default seated head
 * pose, the fallback board and the HUD must fit the glasses' view, which
 * reaches 37° left and right, 25° up and 43° down of the view axis.
 */
const HEAD: HeadPose = { position: [0, 1.2, 0], forward: [0, 0, -1] };
const DEG = 180 / Math.PI;

function angles(p: Vec3): { h: number; v: number } {
  const dx = p[0] - HEAD.position[0];
  const dy = p[1] - HEAD.position[1];
  const dz = p[2] - HEAD.position[2];
  return { h: Math.atan2(dx, -dz) * DEG, v: Math.atan2(dy, -dz) * DEG };
}

function expectInGlassesView(label: string, p: Vec3) {
  const { h, v } = angles(p);
  expect(Math.abs(h), `${label} horizontal ${h.toFixed(1)}°`).toBeLessThanOrEqual(37);
  expect(v, `${label} vertical ${v.toFixed(1)}°`).toBeGreaterThanOrEqual(-43);
  expect(v, `${label} vertical ${v.toFixed(1)}°`).toBeLessThanOrEqual(25);
}

describe('Meta VR Glasses field of view', () => {
  const board = fallbackPlacement(HEAD).pose;
  const rim: Vec3[] = Array.from({ length: 16 }, (_, k) => {
    const a = (2 * Math.PI * k) / 16;
    return boardToWorld(board, [Math.cos(a), 0, Math.sin(a)]);
  });
  const hud = hudPose(board, HEAD);
  const hw = HUD_SIZE.width / 2;
  const hh = HUD_SIZE.height / 2;
  const localCorners: Vec3[] = [
    [-hw, -hh, 0],
    [hw, -hh, 0],
    [-hw, hh, 0],
    [hw, hh, 0],
  ];
  const corners = localCorners.map((c): Vec3 => {
    const o = quatRotate(hud.quaternion, c);
    return [hud.position[0] + o[0], hud.position[1] + o[1], hud.position[2] + o[2]];
  });

  it('shows all 16 board rim points', () => {
    rim.forEach((p, k) => expectInGlassesView(`rim ${k}`, p));
  });

  it('shows all 4 HUD corners', () => {
    corners.forEach((p, k) => expectInGlassesView(`HUD corner ${k}`, p));
  });

  it('keeps the HUD above the far rim so it never hides the board', () => {
    const farRim = Math.max(...rim.map((p) => angles(p).v));
    const hudBottom = Math.min(...corners.map((p) => angles(p).v));
    expect(hudBottom).toBeGreaterThan(farRim);
  });
});

describe('grab collider size', () => {
  it('is at least 3.5 cm in world space for board radii 0.12-0.45 m', () => {
    for (let r = 0.12; r <= 0.45 + 1e-9; r += 0.01) {
      expect(colliderLocalRadius(r) * r, `board radius ${r.toFixed(2)} m`).toBeGreaterThanOrEqual(0.035 - 1e-12);
    }
  });
});
