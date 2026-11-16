import { describe, expect, it } from 'vitest';
import { BOARD, BOARD_SIZE_SCALE } from '../config.js';
import type { Vec3 } from '../sim/vec.js';
import { cosmosOpacity, ISLAND, islandMask, islandWindow, YOUR_TABLE_MAX_OPACITY, type CosmosSession } from './cosmos-rules.js';
import { fallbackPlacement } from './placement.js';
import { ROOM_VIEWS } from './state.js';

describe('cosmosOpacity', () => {
  it('is fully opaque with no mask on the desktop and in VR, whatever the room view', () => {
    for (const session of ['none', 'immersive-vr'] as CosmosSession[]) {
      for (const roomView of ROOM_VIEWS) {
        for (const sandbox of [false, true]) {
          expect(cosmosOpacity({ session, roomView, sandbox, fade01: 0 }), `${session} ${roomView} ${sandbox}`).toEqual({
            visible: true,
            opacity: 1,
            mask: 'none',
          });
        }
      }
    }
  });

  it('in AR: room hides it, space fades it in unmasked, mixed fades it in as an island', () => {
    for (const sandbox of [false, true]) {
      expect(cosmosOpacity({ session: 'immersive-ar', roomView: 'room', sandbox, fade01: 1 }).visible).toBe(false);
    }
    expect(cosmosOpacity({ session: 'immersive-ar', roomView: 'space', sandbox: false, fade01: 0.4 })).toEqual({ visible: true, opacity: 0.4, mask: 'none' });
    expect(cosmosOpacity({ session: 'immersive-ar', roomView: 'mixed', sandbox: false, fade01: 1 })).toEqual({ visible: true, opacity: 1, mask: 'island' });
    expect(cosmosOpacity({ session: 'immersive-ar', roomView: 'mixed', sandbox: false, fade01: 7 }).opacity).toBe(1);
    expect(cosmosOpacity({ session: 'immersive-ar', roomView: 'mixed', sandbox: false, fade01: -1 }).opacity).toBe(0);
  });

  it('in Your Table over passthrough caps the opacity and forces the island', () => {
    for (const roomView of ['space', 'mixed'] as const) {
      const s = cosmosOpacity({ session: 'immersive-ar', roomView, sandbox: true, fade01: 1 });
      expect(s).toEqual({ visible: true, opacity: YOUR_TABLE_MAX_OPACITY, mask: 'island' });
      expect(cosmosOpacity({ session: 'immersive-ar', roomView, sandbox: true, fade01: 0.2 }).opacity).toBe(0.2);
    }
  });
});

describe('islandMask (the Mixed window over the board and the table)', () => {
  const deg = Math.PI / 180;
  // The poses of src/game/geometry.test.ts: seated at the emulator room's coffee table, and the default head with the fallback board.
  const TABLE = { head: [0, 1.15, -1.2] as Vec3, center: [0, 0.424, -1.92] as Vec3, radius: 0.27 };
  const FALLBACK_HEAD: Vec3 = [0, 1.2, 0];
  const fb = fallbackPlacement({ position: FALLBACK_HEAD, forward: [0, 0, -1] }).pose;
  const FALLBACK = { head: FALLBACK_HEAD, center: fb.center, radius: BOARD.fallbackRadius };
  const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cases = [
    { name: 'table', ...TABLE },
    { name: 'fallback', ...FALLBACK },
  ].flatMap((c) =>
    (Object.entries(BOARD_SIZE_SCALE) as [string, number][]).map(([size, s]) => ({ ...c, name: `${c.name} ${size}`, radius: c.radius * s })),
  );

  for (const c of cases) {
    const board = sub(c.center, c.head);
    const win = islandWindow(c.radius, false);
    const at = (p: Vec3) => islandMask(...sub(p, c.head), ...board, win);

    it(`${c.name}: 0 over the board center and at all 16 rim points`, () => {
      expect(at(c.center)).toBe(0);
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        expect(at([c.center[0] + Math.cos(a) * c.radius, c.center[1], c.center[2] + Math.sin(a) * c.radius]), `rim ${k}`).toBe(0);
      }
    });

    it(`${c.name}: 1 at eye level 70 degrees beside the board, a little below it, straight up and straight down`, () => {
      const yaw = Math.atan2(board[0], -board[2]) + 70 * deg;
      expect(islandMask(Math.sin(yaw), 0, -Math.cos(yaw), ...board, win)).toBe(1);
      expect(islandMask(Math.sin(yaw), -0.3, -Math.cos(yaw), ...board, win)).toBe(1);
      expect(islandMask(0, 1, 0, ...board, win)).toBe(1);
      expect(islandMask(0, -1, 0, ...board, win)).toBe(1);
    });

    if (c.name.startsWith('table')) {
      it(`${c.name}: 1 on the floor beside the table, under the near edge and well beyond it`, () => {
        expect(at([c.center[0] + 1.2, 0, c.center[2]])).toBe(1);
        expect(at([c.center[0] - 1.2, 0, c.center[2] + 0.3])).toBe(1);
        expect(at([c.center[0], 0, c.head[2]])).toBe(1);
        expect(at([c.center[0], 0, c.center[2] - 2.5])).toBe(1);
      });
    }
  }

  it('table: 0 over a hand 15 cm above the board (the hands over the board show)', () => {
    const board = sub(TABLE.center, TABLE.head);
    const hand: Vec3 = [TABLE.center[0] + 0.12, TABLE.center[1] + 0.15, TABLE.center[2] + 0.1];
    expect(islandMask(...sub(hand, TABLE.head), ...board, islandWindow(TABLE.radius, false))).toBe(0);
  });

  it('fades smoothly from clear to space over ISLAND.fadeM beyond the clear margin, ignoring the view vector length', () => {
    const board = sub(TABLE.center, TABLE.head);
    const win = islandWindow(TABLE.radius, false);
    expect(win.clearM).toBeCloseTo(TABLE.radius + ISLAND.clearMarginM, 12);
    expect(win.fullM - win.clearM).toBeCloseTo(ISLAND.fadeM, 12);
    const p: Vec3 = [TABLE.center[0] + (win.clearM + win.fullM) / 2, TABLE.center[1], TABLE.center[2]];
    const d = sub(p, TABLE.head);
    const mid = islandMask(...d, ...board, win);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
    expect(islandMask(d[0] * 7, d[1] * 7, d[2] * 7, ...board, win)).toBeCloseTo(mid, 12);
  });

  it('opens a wider window in Your Table', () => {
    const board = sub(TABLE.center, TABLE.head);
    const mixed = islandWindow(TABLE.radius, false);
    const yourTable = islandWindow(TABLE.radius, true);
    expect(yourTable.clearM).toBeGreaterThan(mixed.clearM);
    expect(yourTable.fullM).toBeGreaterThan(mixed.fullM);
    const p: Vec3 = [TABLE.center[0] + mixed.fullM, TABLE.center[1], TABLE.center[2]];
    expect(islandMask(...sub(p, TABLE.head), ...board, mixed)).toBe(1);
    expect(islandMask(...sub(p, TABLE.head), ...board, yourTable)).toBeLessThan(1);
  });
});