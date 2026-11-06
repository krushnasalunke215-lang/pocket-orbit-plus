import type { Entity, UIKitMLAsset, World } from '@iwsdk/core';
import type { BoardPose } from '../game/board-math.js';
import type { GameController } from '../game/controller.js';
import type { BoardPlacement } from '../game/placement.js';
import type { BodyVisual, CometVisual, TargetVisual, TrailVisual } from '../render/visual-types.js';

/*
 * Shared state between systems, stored in world.globals under fixed keys.
 * Systems create these in init() (registration order matters: board, then
 * game, then the rest) and read them through the getters below.
 */

/** The board root (scaled by the radius) and its handle. */
export interface BoardRuntime {
  readonly entity: Entity;
  readonly handleEntity: Entity;
  pose: BoardPose;
  placement: BoardPlacement;
  /** Increments whenever pose changes. */
  version: number;
  /** Re-runs placement now (desktop pose, best plane, or fallback). */
  placeBoard(): void;
}

/** Visuals the game system builds under the board root. */
export interface GameVisuals {
  readonly bodies: Map<string, BodyVisual>;
  /** GameController.levelRevision the body entities were last built for. */
  builtRevision: number;
  readonly comet: CometVisual;
  readonly target: TargetVisual;
  readonly trail: TrailVisual;
}

export interface HudRuntime {
  readonly panel: UIKitMLAsset;
  readonly entity: Entity;
}

const KEYS = { game: 'game', board: 'board', visuals: 'visuals', hud: 'hud' } as const;

export function setGame(world: World, game: GameController): void {
  world.globals[KEYS.game] = game;
}
export function getGame(world: World): GameController | undefined {
  return world.globals[KEYS.game] as GameController | undefined;
}

export function setBoard(world: World, board: BoardRuntime): void {
  world.globals[KEYS.board] = board;
}
export function getBoard(world: World): BoardRuntime | undefined {
  return world.globals[KEYS.board] as BoardRuntime | undefined;
}

export function setVisuals(world: World, visuals: GameVisuals): void {
  world.globals[KEYS.visuals] = visuals;
}
export function getVisuals(world: World): GameVisuals | undefined {
  return world.globals[KEYS.visuals] as GameVisuals | undefined;
}

export function setHud(world: World, hud: HudRuntime): void {
  world.globals[KEYS.hud] = hud;
}
export function getHud(world: World): HudRuntime | undefined {
  return world.globals[KEYS.hud] as HudRuntime | undefined;
}
