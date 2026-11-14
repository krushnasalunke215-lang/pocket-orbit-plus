import type { RoomView } from './state.js';

/*
 * When and how strongly the surrounding cosmos covers the real room. Pure:
 * no three, DOM or clocks. The sky shader's GLSL mask (src/render/shaders/sky.ts)
 * mirrors islandMask with the same constants.
 */

export type CosmosSession = 'none' | 'immersive-ar' | 'immersive-vr';

/** 'island': the room shows around the board and below eye level (see islandMask). */
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
 * The island mask in degrees: the room is clear within CLEAR of the
 * head-to-board direction and fully space beyond FULL; below the horizon it
 * is clear under BELOW_CLEAR elevation and fully space above BELOW_FULL.
 */
export const ISLAND = {
  clearDeg: 22,
  fullDeg: 40,
  belowClearDeg: -24,
  belowFullDeg: -6,
} as const;

const DEG = Math.PI / 180;
/** The same values as cosines and sines, as the GLSL uses them. */
export const ISLAND_COS_CLEAR = Math.cos(ISLAND.clearDeg * DEG);
export const ISLAND_COS_FULL = Math.cos(ISLAND.fullDeg * DEG);
export const ISLAND_SIN_BELOW_CLEAR = Math.sin(ISLAND.belowClearDeg * DEG);
export const ISLAND_SIN_BELOW_FULL = Math.sin(ISLAND.belowFullDeg * DEG);

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
 * The island mask for a view direction (any length, y up): 0 shows the
 * room, 1 shows space. It is 0 toward the board (the head-to-board
 * direction `board*`) and below eye level, 1 well away from the board and
 * above the horizon; the two fades multiply.
 */
export function islandMask(dirX: number, dirY: number, dirZ: number, boardX: number, boardY: number, boardZ: number): number {
  const dl = Math.hypot(dirX, dirY, dirZ) || 1;
  const bl = Math.hypot(boardX, boardY, boardZ) || 1;
  const cos = (dirX * boardX + dirY * boardY + dirZ * boardZ) / (dl * bl);
  const away = 1 - smoothstep(ISLAND_COS_FULL, ISLAND_COS_CLEAR, cos);
  const above = smoothstep(ISLAND_SIN_BELOW_CLEAR, ISLAND_SIN_BELOW_FULL, dirY / dl);
  return away * above;
}
