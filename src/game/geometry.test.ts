import { describe, expect, it } from 'vitest';
import { VISUAL_LIFT } from '../config.js';
import type { Placements } from '../sim/level.js';
import { ALL_LEVELS } from '../sim/levels/index.js';
import type { Vec3 } from '../sim/vec.js';
import {
  boardToWorld,
  colliderLocalRadius,
  IDENTITY_QUAT,
  quatConjugate,
  quatRotate,
  type BoardPose,
  type Quat,
} from './board-math.js';
import {
  boardHandlePose,
  DEBUG_OVERLAY_SIZE,
  debugOverlayPose,
  HUD_SIZE,
  hudPose,
  LEVEL_SELECT_SIZE,
  levelSelectPose,
  RIM_BUTTON_SIZE,
  rimButtonPose,
  SANDBOX_PANEL_SIZE,
  sandboxPanelPose,
} from './hud-layout.js';
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

/*
 * The near-rim Launch/Replay button (D2), at two poses:
 * - FALLBACK: the default head pose above, the fallback board, a level gaze.
 * - TABLE: seated at the emulator room's coffee table. With a level gaze the
 *   table board itself lies 45-58° down, below the glasses' 43° limit, so a
 *   seated player looks down at it: the gaze points from the head at the
 *   board center, and the view is measured in a frame aligned with it.
 */
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => scale(a, 1 / length(a));
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

interface RimCase {
  readonly name: string;
  readonly head: HeadPose;
  readonly board: BoardPose;
  readonly gaze: Vec3;
}

const TABLE_HEAD: HeadPose = { position: [0, 1.15, -1.2], forward: [0, 0, -1] };
const TABLE_BOARD: BoardPose = { center: [0, 0.424, -1.92], quaternion: IDENTITY_QUAT, radius: 0.27 };
const RIM_CASES: readonly RimCase[] = [
  { name: 'fallback', head: HEAD, board: fallbackPlacement(HEAD).pose, gaze: [0, 0, -1] },
  { name: 'table', head: TABLE_HEAD, board: TABLE_BOARD, gaze: sub(TABLE_BOARD.center, TABLE_HEAD.position) },
];

/** Board handle collider: CapsuleGeometry(0.025, 0.08) along board-local X (board-placement-system.ts). */
const HANDLE_COLLIDER = { radius: 0.025, length: 0.08 } as const;
const POKE_GAP = 0.015;

/** Distance from p to the button rectangle (local XY plane, centered, facing local +Z). */
function rectDistance(center: Vec3, q: Quat, p: Vec3): number {
  const local = quatRotate(quatConjugate(q), sub(p, center));
  const hw = RIM_BUTTON_SIZE.width / 2;
  const hh = RIM_BUTTON_SIZE.height / 2;
  const cx = Math.max(-hw, Math.min(hw, local[0]));
  const cy = Math.max(-hh, Math.min(hh, local[1]));
  return Math.hypot(local[0] - cx, local[1] - cy, local[2]);
}

/** Every movable body's board position (x, height, z) at its start, stored solution and melody solution. */
function planetPoints(): { label: string; board: Vec3 }[] {
  const points: { label: string; board: Vec3 }[] = [];
  for (const level of ALL_LEVELS) {
    const melody = (level as { readonly melodySolution?: Placements }).melodySolution;
    for (const body of level.bodies) {
      if (!body.movable) continue;
      const sets: [string, Placements | undefined][] = [
        ['start', { [body.id]: body.position }],
        ['solution', level.solution],
        ['melody', melody],
      ];
      for (const [kind, set] of sets) {
        const p = set?.[body.id];
        if (p) points.push({ label: `${level.id} ${body.id} ${kind}`, board: [p[0], body.height ?? 0, p[1]] });
      }
    }
  }
  return points;
}

describe('near-rim Launch button', () => {
  const planets = planetPoints();

  for (const c of RIM_CASES) {
    const button = rimButtonPose(c.board, c.head);
    const head = c.head.position;
    const distance = length(sub(button.position, head));

    it(`${c.name}: is within 0.55 m of the head`, () => {
      expect(distance).toBeLessThanOrEqual(0.55);
    });

    it(`${c.name}: all 4 corners fit the Meta VR Glasses view`, () => {
      const f = unit(c.gaze);
      const right = unit(cross(f, [0, 1, 0]));
      const up = cross(right, f);
      const hw = RIM_BUTTON_SIZE.width / 2;
      const hh = RIM_BUTTON_SIZE.height / 2;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const corner = add(button.position, quatRotate(button.quaternion, [sx * hw, sy * hh, 0]));
        const d = sub(corner, head);
        const z = dot(d, f);
        const h = Math.atan2(dot(d, right), z) * DEG;
        const v = Math.atan2(dot(d, up), z) * DEG;
        expect(Math.abs(h), `corner ${sx},${sy} horizontal ${h.toFixed(1)}°`).toBeLessThanOrEqual(37);
        expect(v, `corner ${sx},${sy} vertical ${v.toFixed(1)}°`).toBeGreaterThanOrEqual(-43);
        expect(v, `corner ${sx},${sy} vertical ${v.toFixed(1)}°`).toBeLessThanOrEqual(25);
      }
    });

    it(`${c.name}: keeps a poke gap to the handle collider`, () => {
      const handle = boardHandlePose(c.board);
      const axis = quatRotate(handle.quaternion, [1, 0, 0]);
      let nearest = Infinity;
      for (let i = 0; i <= 200; i++) {
        const s = (i / 200 - 0.5) * HANDLE_COLLIDER.length;
        nearest = Math.min(nearest, rectDistance(button.position, button.quaternion, add(handle.position, scale(axis, s))));
      }
      expect(nearest - HANDLE_COLLIDER.radius).toBeGreaterThanOrEqual(POKE_GAP);
    });

    it(`${c.name}: keeps a poke gap to every level's planet colliders`, () => {
      const collider = colliderLocalRadius(c.board.radius) * c.board.radius;
      for (const p of planets) {
        const world = boardToWorld(c.board, p.board);
        const gap = rectDistance(button.position, button.quaternion, world) - collider;
        expect(gap, p.label).toBeGreaterThanOrEqual(POKE_GAP);
      }
    });

    it(`${c.name}: a gaze or ray aimed at a planet cannot land on the button`, () => {
      const collider = colliderLocalRadius(c.board.radius) * c.board.radius;
      const halfDiagonal = Math.atan(Math.hypot(RIM_BUTTON_SIZE.width / 2, RIM_BUTTON_SIZE.height / 2) / distance);
      const toButton = unit(sub(button.position, head));
      for (const p of planets) {
        const toPlanet = sub(boardToWorld(c.board, p.board), head);
        const separation = Math.acos(Math.min(1, dot(unit(toPlanet), toButton)));
        const needed = halfDiagonal + Math.asin(collider / length(toPlanet));
        expect(separation * DEG, p.label).toBeGreaterThan(needed * DEG);
      }
    });
  }
});

/*
 * The level-select panel (F3) at the same two poses and gaze rules as the
 * rim button: the whole panel inside the Meta VR Glasses view while open,
 * and close enough for a fingertip.
 */
describe('level-select panel', () => {
  for (const c of RIM_CASES) {
    const panel = levelSelectPose(c.board, c.head);
    const head = c.head.position;

    it(`${c.name}: its center is within 0.55 m of the head`, () => {
      expect(length(sub(panel.position, head))).toBeLessThanOrEqual(0.55);
    });

    it(`${c.name}: all 4 corners fit the Meta VR Glasses view`, () => {
      const f = unit(c.gaze);
      const right = unit(cross(f, [0, 1, 0]));
      const up = cross(right, f);
      const hw = LEVEL_SELECT_SIZE.width / 2;
      const hh = LEVEL_SELECT_SIZE.height / 2;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const corner = add(panel.position, quatRotate(panel.quaternion, [sx * hw, sy * hh, 0]));
        const d = sub(corner, head);
        const z = dot(d, f);
        const h = Math.atan2(dot(d, right), z) * DEG;
        const v = Math.atan2(dot(d, up), z) * DEG;
        expect(Math.abs(h), `corner ${sx},${sy} horizontal ${h.toFixed(1)}°`).toBeLessThanOrEqual(37);
        expect(v, `corner ${sx},${sy} vertical ${v.toFixed(1)}°`).toBeGreaterThanOrEqual(-43);
        expect(v, `corner ${sx},${sy} vertical ${v.toFixed(1)}°`).toBeLessThanOrEqual(25);
      }
    });

    it(`${c.name}: faces the head`, () => {
      const normal = quatRotate(panel.quaternion, [0, 0, 1]);
      expect(dot(normal, unit(sub(head, panel.position)))).toBeGreaterThan(0.999);
    });

    it(`${c.name}: its lower edge clears every planet collider, so no board object stands between the eyes and a button`, () => {
      const up = quatRotate(panel.quaternion, [0, 1, 0]);
      const lowerEdge = panel.position[1] - up[1] * (LEVEL_SELECT_SIZE.height / 2);
      // The colliders float VISUAL_LIFT above the glass with the bodies.
      const colliderTop = c.board.center[1] + (VISUAL_LIFT + colliderLocalRadius(c.board.radius)) * c.board.radius;
      expect(lowerEdge - colliderTop).toBeGreaterThanOrEqual(0.015 - 1e-9);
    });
  }

  it('table: still on the line from the head to the board center (no rise needed)', () => {
    const c = RIM_CASES[1];
    const panel = levelSelectPose(c.board, c.head);
    const toPanel = unit(sub(panel.position, c.head.position));
    expect(dot(toPanel, unit(c.gaze))).toBeGreaterThan(0.99999);
  });
});

/*
 * The ?debug=1 overlay (F6) beside the HUD: inside the Meta VR Glasses view
 * at both poses, clear of the HUD, facing the head.
 */
describe('debug overlay panel', () => {
  for (const c of RIM_CASES) {
    const panel = debugOverlayPose(c.board, c.head);
    const head = c.head.position;

    it(`${c.name}: all 4 corners fit the Meta VR Glasses view`, () => {
      const f = unit(c.gaze);
      const right = unit(cross(f, [0, 1, 0]));
      const up = cross(right, f);
      const hw = DEBUG_OVERLAY_SIZE.width / 2;
      const hh = DEBUG_OVERLAY_SIZE.height / 2;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const corner = add(panel.position, quatRotate(panel.quaternion, [sx * hw, sy * hh, 0]));
        const d = sub(corner, head);
        const z = dot(d, f);
        const h = Math.atan2(dot(d, right), z) * DEG;
        const v = Math.atan2(dot(d, up), z) * DEG;
        expect(Math.abs(h), `corner ${sx},${sy} horizontal ${h.toFixed(1)}°`).toBeLessThanOrEqual(37);
        expect(v, `corner ${sx},${sy} vertical ${v.toFixed(1)}°`).toBeGreaterThanOrEqual(-43);
        expect(v, `corner ${sx},${sy} vertical ${v.toFixed(1)}°`).toBeLessThanOrEqual(25);
      }
    });

    it(`${c.name}: sits left of the HUD without overlapping it`, () => {
      const hud = hudPose(c.board, c.head).position;
      const gap = length(sub(panel.position, hud)) - HUD_SIZE.width / 2 - DEBUG_OVERLAY_SIZE.width / 2;
      expect(gap).toBeGreaterThan(0.015);
      expect(panel.position[0]).toBeLessThan(hud[0]);
    });

    it(`${c.name}: faces the head`, () => {
      const normal = quatRotate(panel.quaternion, [0, 0, 1]);
      expect(dot(normal, unit(sub(head, panel.position)))).toBeGreaterThan(0.999);
    });
  }
});

/*
 * Meta VR Glasses fit (Phase 3) at both poses and gaze rules above: the
 * board rim, the HUD, the Your Table panel (shown beside the HUD in Your
 * Table), the near-rim button and the level select, each corner 1° inside
 * 37° left/right, 25° up, 43° down. The tightest corner is the near-rim
 * button's outer corner at the fallback (35.6° left); the Your Table panel's
 * top reaches 22.5° up at the table. The Settings page shares the
 * level-select pose and is no larger (LEVEL_SELECT_SIZE).
 */
describe('Meta VR Glasses fit at the fallback and table poses', () => {
  const MARGIN = 1;
  const viewAngles = (c: RimCase, p: Vec3): { h: number; v: number } => {
    const f = unit(c.gaze);
    const right = unit(cross(f, [0, 1, 0]));
    const up = cross(right, f);
    const d = sub(p, c.head.position);
    const z = dot(d, f);
    return { h: Math.atan2(dot(d, right), z) * DEG, v: Math.atan2(dot(d, up), z) * DEG };
  };
  const expectFits = (c: RimCase, label: string, p: Vec3) => {
    const { h, v } = viewAngles(c, p);
    expect(Math.abs(h), `${label} horizontal ${h.toFixed(1)}°`).toBeLessThanOrEqual(37 - MARGIN);
    expect(v, `${label} vertical ${v.toFixed(1)}°`).toBeGreaterThanOrEqual(-43 + MARGIN);
    expect(v, `${label} vertical ${v.toFixed(1)}°`).toBeLessThanOrEqual(25 - MARGIN);
  };
  const corners = (pose: { position: Vec3; quaternion: Quat }, size: { width: number; height: number }): Vec3[] =>
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) =>
      add(pose.position, quatRotate(pose.quaternion, [(sx * size.width) / 2, (sy * size.height) / 2, 0])),
    );

  for (const c of RIM_CASES) {
    it(`${c.name}: all 16 board rim points`, () => {
      for (let k = 0; k < 16; k++) {
        const a = (2 * Math.PI * k) / 16;
        expectFits(c, `rim ${k}`, boardToWorld(c.board, [Math.cos(a), 0, Math.sin(a)]));
      }
    });

    it(`${c.name}: the top of a floating planet (VISUAL_LIFT plus a held planet's radius) at every rim point`, () => {
      const top = VISUAL_LIFT + 1.5 * 0.07;
      for (let k = 0; k < 16; k++) {
        const a = (2 * Math.PI * k) / 16;
        expectFits(c, `lifted body at rim ${k}`, boardToWorld(c.board, [Math.cos(a), top, Math.sin(a)]));
      }
    });

    it(`${c.name}: all 4 HUD corners`, () => {
      corners(hudPose(c.board, c.head), HUD_SIZE).forEach((p, k) => expectFits(c, `HUD corner ${k}`, p));
    });

    it(`${c.name}: all 4 Your Table panel corners`, () => {
      corners(sandboxPanelPose(c.board, c.head), SANDBOX_PANEL_SIZE).forEach((p, k) => expectFits(c, `Your Table corner ${k}`, p));
    });

    it(`${c.name}: all 4 near-rim button and level-select corners`, () => {
      corners(rimButtonPose(c.board, c.head), RIM_BUTTON_SIZE).forEach((p, k) => expectFits(c, `rim button corner ${k}`, p));
      corners(levelSelectPose(c.board, c.head), LEVEL_SELECT_SIZE).forEach((p, k) => expectFits(c, `level select corner ${k}`, p));
    });
  }
});

describe('grab collider size', () => {
  it('is at least 3.5 cm in world space for board radii 0.12-0.45 m', () => {
    for (let r = 0.12; r <= 0.45 + 1e-9; r += 0.01) {
      expect(colliderLocalRadius(r) * r, `board radius ${r.toFixed(2)} m`).toBeGreaterThanOrEqual(0.035 - 1e-12);
    }
  });
});
