import type { RoomView } from './state.js';

/*
 * When and how strongly the surrounding cosmos covers the real room. Pure:
 * no three, DOM or clocks. The sky shader's GLSL mask (src/render/shaders/sky.ts)
 * mirrors islandMask with the same constants.
 */

export type CosmosSession = 'none' | 'immersive-ar' | 'immersive-vr';

/** 'island': the room shows only through a soft window over the board and table (see islandMask). */
export type CosmosMask = 'none' | 'island';

export interface CosmosInput {
  readonly session: CosmosSession;
  readonly roomView: RoomView;
  /** Your Table (sandbox mode): real objects must stay clearly visible. */
  readonly sandbox: boolean;
  /** 0..1 progress of the fade-in since the AR session became visible. */
  readonly fade01: number;
}

export interface CosmosState {
  /** False: the cosmos is not drawn at all (no draw calls). */
  readonly visible: boolean;
  /** 0..1 multiplier of every cosmos layer's alpha. */
  readonly opacity: number;
  readonly mask: CosmosMask;
}

/** Most cosmos opacity in Your Table over passthrough. */
export const YOUR_TABLE_MAX_OPACITY = 0.45;

/**
 * The island window on the board plane, in meters from the board center:
 * the room is fully clear out to the rim plus CLEAR_MARGIN (the table top,
 * a cup, the hands over the board), fades to full space over the next FADE,
 * and Your Table widens both by YOUR_TABLE_EXTRA so more of the table and
 * its real objects stay visible.
 */
export const ISLAND = {
  clearMarginM: 0.25,
  fadeM: 0.35,
  yourTableExtraM: 0.15,
} as const;

export interface IslandWindow {
  /** Fully clear (the room) within this distance of the board center on the board plane. */
  readonly clearM: number;
  /** Fully space beyond this distance. */
  readonly fullM: number;
}

/** The island window for a board of radius `boardRadiusM` meters. */
export function islandWindow(boardRadiusM: number, sandbox: boolean): IslandWindow {
  const clearM = boardRadiusM + ISLAND.clearMarginM + (sandbox ? ISLAND.yourTableExtraM : 0);
  return { clearM, fullM: clearM + ISLAND.fadeM };
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** GLSL smoothstep. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Whether, how strongly and with which mask the cosmos covers the view. */
export function cosmosOpacity({ session, roomView, sandbox, fade01 }: CosmosInput): CosmosState {
  if (session !== 'immersive-ar') return { visible: true, opacity: 1, mask: 'none' };
  if (roomView === 'room') return { visible: false, opacity: 0, mask: 'none' };
  const fade = clamp01(fade01);
  if (sandbox) return { visible: true, opacity: Math.min(fade, YOUR_TABLE_MAX_OPACITY), mask: 'island' };
  return { visible: true, opacity: fade, mask: roomView === 'mixed' ? 'island' : 'none' };
}

/**
 * The island mask for a view direction from the head (any length, y up):
 * 0 shows the room, 1 shows space. The board center is `board*`, relative
 * to the head. Two windows of the same radii must both be clear:
 * - on the table: where the view ray meets the board's horizontal plane,
 *   0 within `win.clearM` of the board center and 1 beyond `win.fullM`
 *   (1 for every ray that never reaches the plane: eye level and up);
 * - facing the eye: the same radii seen at the board's distance (an angle
 *   cone about the head-to-board direction), so the floor under a board
 *   that floats near eye level, or straight down, stays space too.
 * So in Mixed only a soft window over the board and the table shows the
 * room; the walls, the couch, the ceiling and the floor around the table
 * are space.
 */
export function islandMask(dirX: number, dirY: number, dirZ: number, boardX: number, boardY: number, boardZ: number, win: IslandWindow): number {
  if (dirY * boardY <= 0 || Math.abs(dirY) < 1e-6) return 1;
  const dl = Math.hypot(dirX, dirY, dirZ);
  const bl = Math.hypot(boardX, boardY, boardZ);
  const cos = (dirX * boardX + dirY * boardY + dirZ * boardZ) / (dl * bl);
  if (cos <= 0) return 1;
  const tan = Math.sqrt(Math.max(0, 1 - cos * cos)) / cos;
  const facing = smoothstep(win.clearM / bl, win.fullM / bl, tan);
  const t = boardY / dirY;
  const onTable = smoothstep(win.clearM, win.fullM, Math.hypot(dirX * t - boardX, dirZ * t - boardZ));
  return Math.max(facing, onTable);
}
