import type { Entity, UIKitMLAsset, World } from '@iwsdk/core';
import type { AudioEngine } from '../audio/engine.js';
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

/** The near-rim Launch/Replay button panel (RimButtonSystem). */
export interface RimButtonRuntime {
  readonly panel: UIKitMLAsset;
  readonly entity: Entity;
  /** The label text last written ('Launch' or 'Replay'). */
  label: string;
}

/** renderer.info.render counters of one frame. */
export interface RenderCounts {
  calls: number;
  triangles: number;
  points: number;
  lines: number;
}

/** Written every frame by RenderStatsSystem. */
export interface RenderStats {
  readonly last: RenderCounts;
  readonly max: RenderCounts;
  frames: number;
  programs: number;
  geometries: number;
  textures: number;
  readonly autoReset: boolean;
  /** Clears max and the frame counter. */
  reset(): void;
}

/** User audio settings (FEAT-004 persists them, FEAT-005 adds panel controls). */
export interface AppSettings {
  readonly muted: boolean;
  /** 0..1. */
  readonly volume: number;
  /** Multiplies the master level by QUIET_FACTOR (src/audio/engine.ts). */
  readonly quiet: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = { muted: false, volume: 0.8, quiet: false };

interface SettingsStore {
  value: AppSettings;
  /** Increments on every setSettings; systems apply changes when it moves. */
  revision: number;
}

const KEYS = {
  game: 'game',
  board: 'board',
  visuals: 'visuals',
  hud: 'hud',
  rimButton: 'rimButton',
  renderStats: 'renderStats',
  audio: 'audio',
  settings: 'settings',
} as const;

function settingsStore(world: World): SettingsStore {
  let store = world.globals[KEYS.settings] as SettingsStore | undefined;
  if (!store) {
    store = { value: DEFAULT_SETTINGS, revision: 0 };
    world.globals[KEYS.settings] = store;
  }
  return store;
}

export function getSettings(world: World): AppSettings {
  return settingsStore(world).value;
}
export function getSettingsRevision(world: World): number {
  return settingsStore(world).revision;
}
/**
 * Merges `partial` into the settings and bumps the revision. Throws, changing
 * nothing, on a non-boolean flag or a non-finite volume; clamps volume to 0..1.
 */
export function setSettings(world: World, partial: Partial<AppSettings>): AppSettings {
  const store = settingsStore(world);
  const next: { -readonly [K in keyof AppSettings]: AppSettings[K] } = { ...store.value };
  for (const key of ['muted', 'quiet'] as const) {
    const v = partial[key];
    if (v === undefined) continue;
    if (typeof v !== 'boolean') throw new TypeError(`settings.${key} must be a boolean`);
    next[key] = v;
  }
  if (partial.volume !== undefined) {
    const v = partial.volume;
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError('settings.volume must be a finite number');
    next.volume = Math.min(1, Math.max(0, v));
  }
  store.value = next;
  store.revision++;
  return next;
}

export function setAudio(world: World, engine: AudioEngine): void {
  world.globals[KEYS.audio] = engine;
}
export function getAudio(world: World): AudioEngine | undefined {
  return world.globals[KEYS.audio] as AudioEngine | undefined;
}

export function setRenderStats(world: World, stats: RenderStats): void {
  world.globals[KEYS.renderStats] = stats;
}
export function getRenderStats(world: World): RenderStats | undefined {
  return world.globals[KEYS.renderStats] as RenderStats | undefined;
}

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

export function setRimButton(world: World, rim: RimButtonRuntime): void {
  world.globals[KEYS.rimButton] = rim;
}
export function getRimButton(world: World): RimButtonRuntime | undefined {
  return world.globals[KEYS.rimButton] as RimButtonRuntime | undefined;
}
