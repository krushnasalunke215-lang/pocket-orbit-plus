import { describe, expect, it } from 'vitest';
import { PLACE_RADIUS } from '../config.js';
import type { Placements } from '../sim/level.js';
import { ALL_LEVELS } from '../sim/levels/index.js';
import { simulate } from '../sim/simulate.js';
import type { Vec2, Vec3 } from '../sim/vec.js';
import {
  boardToWorld,
  clampToDisc,
  colliderLocalRadius,
  intersectRayWithBoardPlane,
  projectVertical,
  quatFromUpAndYaw,
  quatLookAt,
  quatRotate,
  worldToBoard,
  yawQuaternion,
  type BoardPose,
} from './board-math.js';
import { boardRadiusForTable } from './placement.js';

const POSE: BoardPose = {
  center: [0.31, 0.74, -0.62],
  quaternion: yawQuaternion(0.7),
  radius: 0.27,
};

function expectClose(a: readonly number[], b: readonly number[], eps = 1e-9) {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(eps);
}

describe('board <-> world', () => {
  it('round-trips through a rotated, translated, scaled pose', () => {
    const points: Vec3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [-0.4, 0.2, 0.9],
      [0.92, -0.1, -0.3],
    ];
    for (const p of points) {
      expectClose(worldToBoard(POSE, boardToWorld(POSE, p)), p);
    }
    const w: Vec3 = [1.2, 0.3, -2];
    expectClose(boardToWorld(POSE, worldToBoard(POSE, w)), w);
  });

  it('maps board units to meters by the radius', () => {
    const a = boardToWorld(POSE, [0, 0, 0]);
    const b = boardToWorld(POSE, [1, 0, 0]);
    expect(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])).toBeCloseTo(POSE.radius, 12);
    expectClose(a, POSE.center);
  });

  it('yawQuaternion turns +Z toward (sin, 0, cos)', () => {
    expectClose(quatRotate(yawQuaternion(0.7), [0, 0, 1]), [Math.sin(0.7), 0, Math.cos(0.7)]);
  });

  it('quatFromUpAndYaw maps +Y onto up', () => {
    const up: Vec3 = [0.2, 0.96, 0.1];
    const len = Math.hypot(...up);
    const unit: Vec3 = [up[0] / len, up[1] / len, up[2] / len];
    expectClose(quatRotate(quatFromUpAndYaw(unit, 1.1), [0, 1, 0]), unit);
    expectClose(quatFromUpAndYaw([0, 1, 0], 0.4), yawQuaternion(0.4));
  });

  it('quatLookAt turns +Z toward the target and keeps +X level', () => {
    const from: Vec3 = [0, 1, -0.7];
    const to: Vec3 = [0.1, 1.3, 0.2];
    const q = quatLookAt(from, to);
    const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const l = Math.hypot(d[0], d[1], d[2]);
    expectClose(quatRotate(q, [0, 0, 1]), [d[0] / l, d[1] / l, d[2] / l]);
    expect(Math.abs(quatRotate(q, [1, 0, 0])[1])).toBeLessThan(1e-9);
  });
});

describe('clampToDisc', () => {
  it('keeps points inside and pulls outside points onto the radius', () => {
    expect(clampToDisc([0.3, -0.2])).toEqual([0.3, -0.2]);
    const c = clampToDisc([3, 4]);
    expect(Math.hypot(c[0], c[1])).toBeCloseTo(PLACE_RADIUS, 12);
    expect(c[0] / c[1]).toBeCloseTo(0.75, 12);
    expect(clampToDisc([0, 2], 0.5)).toEqual([0, 0.5]);
  });
});

describe('ray / board plane', () => {
  it('hits the plane at the given height', () => {
    expectClose(intersectRayWithBoardPlane([0, 2, 2], [0, 1, 1]) as Vec2, [0, 0]);
    expectClose(intersectRayWithBoardPlane([1, 1, 0], [1.5, 0.5, 0], 0.25) as Vec2, [1.75, 0]);
  });

  it('returns null for a parallel ray', () => {
    expect(intersectRayWithBoardPlane([0, 1, 0], [1, 1, 0])).toBeNull();
  });

  it('returns null when the hit is behind the origin', () => {
    expect(intersectRayWithBoardPlane([0, 1, 0], [0, 2, 1])).toBeNull();
  });

  it('projectVertical drops the height', () => {
    expect(projectVertical([0.2, 0.5, -0.3])).toEqual([0.2, -0.3]);
  });
});

describe('collider size', () => {
  it('is at least 0.16 board units and 3.5 cm', () => {
    expect(colliderLocalRadius(0.45)).toBe(0.16);
    expect(colliderLocalRadius(0.12) * 0.12).toBeCloseTo(0.035, 12);
  });
});

describe('scale invariance (table sizes 0.3-1.2 m)', () => {
  const SIZES = [0.3, 0.45, 0.6, 0.8, 1.0, 1.2];

  for (const level of ALL_LEVELS) {
    it(`${level.id} stays solved with the same flyby order`, () => {
      const reference = simulate(level, level.solution);
      expect(reference.outcome).toBe('solved');
      const order = reference.flybys.map((f) => f.bodyId);
      const heights = new Map(level.bodies.map((b) => [b.id, b.height ?? 0]));

      for (const size of SIZES) {
        const pose: BoardPose = { ...POSE, radius: boardRadiusForTable(size) };
        const roundTrip: Record<string, Vec2> = {};
        for (const [id, p] of Object.entries(level.solution)) {
          const world = boardToWorld(pose, [p[0], heights.get(id) ?? 0, p[1]]);
          roundTrip[id] = projectVertical(worldToBoard(pose, world));
        }
        const result = simulate(level, roundTrip as Placements);
        expect(result.outcome, `${level.id} at ${size} m`).toBe('solved');
        expect(result.flybys.map((f) => f.bodyId), `${level.id} at ${size} m`).toEqual(order);
      }
    });
  }
});
