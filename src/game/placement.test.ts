import { describe, expect, it } from 'vitest';
import { BOARD, DESKTOP_VIEW } from '../config.js';
import type { Vec3 } from '../sim/vec.js';
import { quatConjugate, quatRotate, yawQuaternion, type Quat } from './board-math.js';
import {
  boardRadiusForTable,
  chooseBoardPlacement,
  desktopPlacement,
  fallbackPlacement,
  type HeadPose,
  type PlaneInfo,
} from './placement.js';

const HEAD: HeadPose = { position: [0, 1.2, 0], forward: [0, 0, -1] };

function plane(
  id: string,
  center: Vec3,
  width: number,
  depth: number,
  extra: Partial<PlaneInfo> = {},
): PlaneInfo {
  return {
    id,
    center,
    quaternion: [0, 0, 0, 1],
    extents: { minX: -width / 2, maxX: width / 2, minZ: -depth / 2, maxZ: depth / 2 },
    orientation: 'horizontal',
    ...extra,
  };
}

function boardFacing(q: Quat): Vec3 {
  return quatRotate(q, [0, 0, 1]);
}

/** True when the board disc lies inside the plane's local AABB. */
function discInside(p: PlaneInfo, center: Vec3, radius: number): boolean {
  const rel = quatRotate(quatConjugate(p.quaternion), [
    center[0] - p.center[0],
    center[1] - p.center[1],
    center[2] - p.center[2],
  ]);
  const e = p.extents;
  const eps = 1e-9;
  return (
    rel[0] - radius >= e.minX - eps &&
    rel[0] + radius <= e.maxX + eps &&
    rel[2] - radius >= e.minZ - eps &&
    rel[2] + radius <= e.maxZ + eps
  );
}

describe('fallbackPlacement', () => {
  it('floats 0.45 m ahead and 0.2 m below the eye, facing the user', () => {
    const p = chooseBoardPlacement([], HEAD);
    expect(p.source).toBe('fallback');
    expect(p.pose.center[0]).toBeCloseTo(0, 12);
    expect(p.pose.center[1]).toBeCloseTo(1.0, 12);
    expect(p.pose.center[2]).toBeCloseTo(-0.45, 12);
    expect(p.pose.radius).toBe(BOARD.fallbackRadius);
    const f = boardFacing(p.pose.quaternion);
    expect(f[2]).toBeCloseTo(1, 9);
  });

  it('follows a turned head and ignores its pitch', () => {
    const p = fallbackPlacement({ position: [1, 1.5, 2], forward: [0.6, -0.8, 0] });
    expect(p.pose.center[0]).toBeCloseTo(1.45, 12);
    expect(p.pose.center[1]).toBeCloseTo(1.3, 12);
    expect(p.pose.center[2]).toBeCloseTo(2, 12);
    expect(boardFacing(p.pose.quaternion)[0]).toBeCloseTo(-1, 9);
  });
});

describe('desktopPlacement', () => {
  it('uses the fixed desktop view', () => {
    const p = desktopPlacement();
    expect(p.source).toBe('desktop');
    expect(p.pose.center).toEqual(DESKTOP_VIEW.boardCenter);
    expect(p.pose.radius).toBe(DESKTOP_VIEW.boardRadius);
    expect(boardFacing(p.pose.quaternion)[2]).toBeCloseTo(1, 9);
  });
});

describe('chooseBoardPlacement', () => {
  const table = plane('t1', [0, 0.74, -0.7], 1.0, 0.6, { label: 'table' });

  it('puts the board on a reachable table, near the user and fully on it', () => {
    const p = chooseBoardPlacement([table], HEAD);
    expect(p.source).toBe('table-plane');
    expect(p.planeId).toBe('t1');
    expect(p.planeLabel).toBe('table');
    expect(p.pose.radius).toBeCloseTo(boardRadiusForTable(0.6), 12);
    expect(p.pose.center[1]).toBeCloseTo(0.74 + BOARD.lift, 12);
    expect(p.pose.center[2]).toBeCloseTo(-0.7 + 0.3 - p.pose.radius, 12);
    expect(discInside(table, p.pose.center, p.pose.radius)).toBe(true);
    expect(boardFacing(p.pose.quaternion)[2]).toBeCloseTo(1, 9);
  });

  it('prefers a reachable table over a closer unlabeled plane', () => {
    const closer = plane('p0', [0.3, 0.7, -0.4], 0.4, 0.4);
    expect(chooseBoardPlacement([closer, table], HEAD).planeId).toBe('t1');
    expect(chooseBoardPlacement([closer], HEAD).source).toBe('horizontal-plane');
  });

  it('skips an out-of-reach table for a reachable plane, else falls back', () => {
    const farTable = plane('far', [0, 0.44, -1.95], 1.15, 0.6, { label: 'table' });
    const shelf = plane('shelf', [-0.2, 0.8, -0.5], 0.5, 0.4);
    const withShelf = chooseBoardPlacement([farTable, shelf], HEAD);
    expect(withShelf.source).toBe('horizontal-plane');
    expect(withShelf.planeId).toBe('shelf');
    expect(chooseBoardPlacement([farTable], HEAD).source).toBe('fallback');
  });

  it('ignores floors, ceilings, vertical, tiny, tilted, behind and out-of-height planes', () => {
    const ignored: PlaneInfo[] = [
      plane('floor', [0, 0.5, -0.5], 2, 2, { label: 'floor' }),
      plane('ceiling', [0, 0.5, -0.5], 2, 2, { label: 'Ceiling' }),
      plane('wall', [0, 0.8, -0.5], 2, 2, { orientation: 'vertical' }),
      plane('tiny', [0, 0.74, -0.4], 0.2, 0.6, { label: 'table' }),
      plane('tilted', [0, 0.74, -0.5], 1, 1, {
        orientation: undefined,
        quaternion: [Math.sin(0.35), 0, 0, Math.cos(0.35)],
      }),
      plane('behind', [0, 0.74, 0.6], 1, 0.6, { label: 'table' }),
      plane('low', [0, 0.1, -0.5], 1, 1),
      plane('high', [0, 1.15, -0.5], 1, 1),
    ];
    expect(chooseBoardPlacement(ignored, HEAD).source).toBe('fallback');
  });

  it('accepts an unlabeled plane whose normal is within 25 degrees of up', () => {
    const slight = plane('slight', [0, 0.74, -0.6], 0.8, 0.6, {
      orientation: undefined,
      quaternion: [Math.sin(0.1), 0, 0, Math.cos(0.1)],
    });
    expect(chooseBoardPlacement([slight], HEAD).planeId).toBe('slight');
  });

  /** How far the board center lies ahead of the head along its flat view direction. */
  function centerAhead(head: HeadPose, center: Vec3): number {
    const len = Math.hypot(head.forward[0], head.forward[2]);
    return (
      ((center[0] - head.position[0]) * head.forward[0] + (center[2] - head.position[2]) * head.forward[2]) / len
    );
  }

  it('uses a table whose near edge is under the head and puts the board ahead', () => {
    // A seated player leaning over a desk: the desk reaches 10 cm behind the eyes.
    const desk = plane('desk', [0, 0.74, -0.25], 1.2, 0.7, { label: 'table' });
    for (const head of [
      HEAD,
      { position: [0.02, 1.2, 1e-9], forward: [0.05, -0.9, -0.4] } as HeadPose,
    ]) {
      const p = chooseBoardPlacement([desk], head);
      expect(p.source).toBe('table-plane');
      expect(p.planeId).toBe('desk');
      expect(discInside(desk, p.pose.center, p.pose.radius)).toBe(true);
      expect(centerAhead(head, p.pose.center)).toBeGreaterThan(0.2);
      expect(boardFacing(p.pose.quaternion)[2]).toBeGreaterThan(0.9);
    }
  });

  it('uses a table under the middle of the head and puts the board ahead', () => {
    const big = plane('big', [0, 0.74, 0], 1.6, 1.2, { label: 'table' });
    const p = chooseBoardPlacement([big], HEAD);
    expect(p.source).toBe('table-plane');
    expect(discInside(big, p.pose.center, p.pose.radius)).toBe(true);
    expect(centerAhead(HEAD, p.pose.center)).toBeGreaterThan(0.1);

    // Turned to face +X over the same table: the board moves ahead along +X.
    const turned: HeadPose = { position: [0, 1.2, 0], forward: [1, 0, 0] };
    const q = chooseBoardPlacement([big], turned);
    expect(q.source).toBe('table-plane');
    expect(discInside(big, q.pose.center, q.pose.radius)).toBe(true);
    expect(centerAhead(turned, q.pose.center)).toBeGreaterThan(0.1);

    // A slight tilt (floating-point noise in real plane poses) changes nothing.
    const tilted = plane('tilted', [0, 0.74, 0], 1.6, 1.2, {
      label: 'table',
      quaternion: [1e-4, 0, -1e-4, 1],
    });
    const r = chooseBoardPlacement([tilted], HEAD);
    expect(r.source).toBe('table-plane');
    expect(centerAhead(HEAD, r.pose.center)).toBeGreaterThan(0.1);
  });

  it('ignores a table that starts just behind the head', () => {
    const behind = plane('behind', [0, 0.74, 0.33], 1.0, 0.6, { label: 'table' });
    expect(chooseBoardPlacement([behind], HEAD).source).toBe('fallback');
  });

  it('grows the board with the table and keeps the disc on a yawed table', () => {
    let last = 0;
    for (const size of [0.3, 0.45, 0.6, 0.8, 1.0, 1.2]) {
      const t = plane(`t${size}`, [0.1, 0.74, -0.3 - size / 2], size, size, {
        label: 'table',
        quaternion: yawQuaternion(0.5),
      });
      const p = chooseBoardPlacement([t], HEAD);
      expect(p.source, `table ${size} m`).toBe('table-plane');
      expect(p.pose.radius).toBeGreaterThanOrEqual(last);
      expect(p.pose.radius).toBeGreaterThanOrEqual(BOARD.minRadius);
      expect(p.pose.radius).toBeLessThanOrEqual(BOARD.maxRadius);
      expect(discInside(t, p.pose.center, p.pose.radius), `table ${size} m`).toBe(true);
      last = p.pose.radius;
    }
  });
});
