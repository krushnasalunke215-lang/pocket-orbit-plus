import { describe, expect, it } from 'vitest';
import { cosmosOpacity, ISLAND, islandMask, YOUR_TABLE_MAX_OPACITY, type CosmosSession } from './cosmos-rules.js';
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

describe('islandMask', () => {
  const deg = Math.PI / 180;
  /** A direction at `elevation` degrees, `yaw` degrees right of -Z. */
  const dir = (elevation: number, yaw = 0): [number, number, number] => [
    Math.sin(yaw * deg) * Math.cos(elevation * deg),
    Math.sin(elevation * deg),
    -Math.cos(yaw * deg) * Math.cos(elevation * deg),
  ];
  const board = dir(-45);

  it('is 0 toward the board and below eye level, 1 straight up and above the horizon away from the board', () => {
    expect(islandMask(...board, ...board)).toBe(0);
    expect(islandMask(...dir(-45, ISLAND.clearDeg - 1), ...board)).toBe(0);
    expect(islandMask(...dir(-30, 120), ...board)).toBe(0);
    expect(islandMask(...dir(ISLAND.belowClearDeg - 1, 180), ...board)).toBe(0);
    expect(islandMask(0, 1, 0, ...board)).toBeCloseTo(1, 9);
    expect(islandMask(...dir(10, 90), ...board)).toBe(1);
    expect(islandMask(...dir(ISLAND.belowFullDeg + 1, 180), ...board)).toBe(1);
  });

  it('fades smoothly between, and ignores vector lengths', () => {
    const mid = islandMask(...dir(-15, 180), ...board);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    const [x, y, z] = dir(-15, 180);
    expect(islandMask(x * 7, y * 7, z * 7, board[0] * 3, board[1] * 3, board[2] * 3)).toBeCloseTo(mid, 12);
  });
});
