import type { Entity, UIKitMLAsset, World } from '@iwsdk/core';
import type { AudioEngine } from '../audio/engine.js';
import type { BoardPose } from '../game/board-math.js';
import type { GameController } from '../game/controller.js';
import {
  BOARD_SIZES,
  DEFAULT_ONBOARDING,
  DEFAULT_SETTINGS as SAVED_DEFAULT_SETTINGS,
  ROOM_VIEWS,
  type BoardSize,
  type OnboardingFlags,
  type RoomView,
} from '../game/state.js';
import type { BoardPlacement } from '../game/placement.js';
import type { CosmosMask, IslandWindow } from '../game/cosmos-rules.js';
import type { SpaceFx } from '../render/space-fx.js';
import type { SpaceTextureStatus } from '../render/space-textures.js';
import type { BoardVisual, BodyVisual, CometVisual, CosmosVisual, TargetVisual, TrailVisual } from '../render/visual-types.js';

/*
 * Shared state between systems, stored in world.globals under fixed keys.
 * Systems create these in init() (registration order matters: board, then
 * game, then the rest) and read them through the getters below.
 */

/** The board root (scaled by the radius) and its handle. */
export interface BoardRuntime {
  readonly entity: Entity;
  readonly handleEntity: Entity;
  /** The glass plate with the spacetime grid (RenderSyncSystem writes its grid and shadow entries). */
  readonly visual: BoardVisual;
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
  /** The status line last written. */
  status: string;
}

/** The near-rim Launch/Replay button panel (RimButtonSystem). */
export interface RimButtonRuntime {
  readonly panel: UIKitMLAsset;
  readonly entity: Entity;
  /** The label text last written ('Launch' or 'Replay'). */
  label: string;
  /** Visible and pressable (hidden during the chapter-complete moment). */
  shown: boolean;
}

/** One Your Table well (RealObjectSystem). */
export interface SandboxWell {
  readonly id: string;
  /** 'object': a hit-tested real object; 'puck': the draggable fallback puck. */
  readonly kind: 'object' | 'puck';
  /** Board position [x, 0, z] (written in place when a puck moves). */
  readonly position: [number, number, number];
  /** Height above the board plane (meters), clamped; sets the mass. */
  heightM: number;
  /** The hit's measured height before clamping (meters; the start height for a puck). */
  readonly measuredHeightM: number;
  mass: number;
}

/** What the armed reticle points at: see classifyHit, or 'miss' without a hit. */
export type ReticleHit = 'object' | 'too-low' | 'off-board' | 'miss';

/** The Your Table sandbox controls and wells (RealObjectSystem). */
export interface SandboxRuntime {
  /** A confirming pinch of `armHand` turns the aimed object into a well. */
  armed: boolean;
  armHand: 'left' | 'right' | null;
  /** Status line the sandbox panel shows. */
  status: string;
  /** Wells in placement order (the game's external wells carry the same ids). */
  readonly wells: SandboxWell[];
  /** The well the height buttons change: the last placed or grabbed one. */
  selectedId: string | null;
  /** The armed hand's reticle this frame. */
  readonly reticle: {
    visible: boolean;
    hit: ReticleHit;
    readonly world: [number, number, number];
    readonly board: [number, number, number];
    heightM: number;
  };
  /** Increments whenever what the panel shows changes (wells, selection, status, armed). */
  revision: number;
  /**
   * Per hand: that hand's current pinch confirmed a Make well. The ray does
   * not see the real object, so the same pinch would also click the HUD or
   * Your Table panel element behind it; both ignore that hand's ray clicks
   * until its select ends (see isConfirmPinchClick).
   */
  readonly confirmPinch: { left: boolean; right: boolean };
  /** Arms well placement for `hand` (default: the hand that just clicked, else right). */
  arm(hand?: 'left' | 'right'): void;
  disarm(): void;
  /** Adds a well puck at the board center. */
  addPuck(): void;
  /** Changes the selected well's height by `steps` HEIGHT_STEP_M presses. */
  stepHeight(steps: number): void;
  /** Removes every well, puck and marker. */
  clear(): void;
}

/** Number of hit-test samples HitLog keeps. */
export const HIT_LOG_SIZE = 30;

/**
 * The last HIT_LOG_SIZE reticle hits while in the sandbox (for the debug
 * overlay's hit height and jitter). Ring buffers written in place.
 */
export interface HitLog {
  /** Height above the board plane per sample (meters). */
  readonly heights: Float32Array;
  /** World xyz per sample (meters), packed. */
  readonly positions: Float32Array;
  /** Valid samples (at most HIT_LOG_SIZE). */
  count: number;
  /** Next slot to write. */
  next: number;
  /** Total hits logged. */
  total: number;
  /** Well placement was armed when the last sample was taken. */
  armed: boolean;
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
  /** Frames on which DepthSensingSystem had XR depth data (occlusion input). */
  depthFrames: number;
  programs: number;
  geometries: number;
  textures: number;
  readonly autoReset: boolean;
  /** Clears max and the frame counters. */
  reset(): void;
}

/**
 * User audio and accessibility settings (SaveSystem persists them; the
 * level select's Settings page edits them).
 */
export interface AppSettings {
  readonly muted: boolean;
  /** 0..1. */
  readonly volume: number;
  /** Multiplies the master level by QUIET_FACTOR (src/audio/engine.ts). */
  readonly quiet: boolean;
  /** The ghost hand demonstrates with the left hand (OnboardingSystem). */
  readonly leftHanded: boolean;
  /** Brighter rims, outlines on the bodies and the target, stronger HUD text (AccessibilitySystem, HudSystem). */
  readonly highContrast: boolean;
  /** Decorative clocks stop (motionTime), no chapter-moment burst, static trails. */
  readonly reducedMotion: boolean;
  /** Board radius factor BOARD_SIZE_SCALE[boardSize] (BoardPlacementSystem). */
  readonly boardSize: BoardSize;
  /** How much of the room the cosmos covers in mixed reality (CosmosSystem). */
  readonly roomView: RoomView;
}

/** The saved defaults (src/game/state.ts), so a fresh game and a migrated save agree. */
export const DEFAULT_SETTINGS: AppSettings = SAVED_DEFAULT_SETTINGS;

/** Why the game is paused. */
export type PauseReason = 'none' | 'xr-blurred' | 'xr-hidden' | 'page-hidden';

/** Written by LifecycleSystem; read by the game, input and audio systems. */
export interface PauseState {
  paused: boolean;
  reason: PauseReason;
  /** Increments whenever paused or reason changes. */
  revision: number;
}

/** SaveSystem status and actions (the debug API exposes them). */
export interface SaveRuntime {
  /** performance.now() of the last successful write (null before one). */
  lastSavedAt: number | null;
  /** Why the save could not be loaded or written (null when fine). */
  problem: string | null;
  /** Writes the current state now; false when storage refused it. */
  saveNow(): boolean;
  /** Removes the stored save (the running game is unchanged). */
  clear(): boolean;
}

/**
 * Visual-only control of the comet (attract loop, chapter-complete loop).
 * OnboardingSystem rewrites it every frame, ChapterSystem may take it over
 * after that, and RenderSyncSystem draws the comet from it while active.
 * The game's comet state (phase, flight time, cometBoardPosition) is untouched.
 */
export interface CometOverride {
  active: boolean;
  /** Board position. */
  readonly position: [number, number, number];
  /** Comet opacity 0..1. */
  alpha: number;
}

/** First-minutes state of this page session (not saved; OnboardingSystem). */
export interface OnboardingSession {
  /** The player has hovered or grabbed a body, clicked a button or launched. */
  interacted: boolean;
  /** The attract loop drives the comet this frame. */
  attract: boolean;
  /** The ghost hand is shown this frame. */
  ghostHandVisible: boolean;
  /** Seconds into the ghost hand loop (0 while hidden). */
  ghostHandTime: number;
}

/** The level-select panel (LevelSelectSystem). */
export interface LevelSelectRuntime {
  readonly panel: UIKitMLAsset;
  readonly entity: Entity;
  open: boolean;
  /** The page shown while open: the level grid, or Settings (accessibility and audio). */
  page: 'levels' | 'settings';
  /** Element ids of the level buttons, in level order. */
  readonly buttonIds: readonly string[];
  /** Stars each level button shows (0 = no stars line), in level order. */
  readonly shownStars: number[];
  /** The Settings page shows Room view (only in a mixed-reality session, the only place it applies). */
  roomViewShown: boolean;
  show(): void;
  hide(): void;
}

/** The chapter-complete moment (ChapterSystem). */
export interface ChapterRuntime {
  shown: boolean;
  chapter: number;
  /** Best stars summed over the chapter's levels when it was shown. */
  stars: number;
  /** 3 x the chapter's level count. */
  maxStars: number;
  /** Increments on every show and hide. */
  revision: number;
  /** The constellation's height above the board (board units) and its ring turn (rad), this frame. */
  starHeight: number;
  starSpin: number;
  show(chapter: number): void;
  hide(): void;
}

/** The surrounding cosmos (CosmosSystem). */
export interface CosmosRuntime {
  readonly visual: CosmosVisual;
  /** Drawn this frame. */
  visible: boolean;
  /** The opacity uniform this frame (the AR fade, Your Table's cap). */
  opacity: number;
  /** AR fade-in progress 0..1 (1 outside AR). */
  fade: number;
  mask: CosmosMask;
  /** The Mixed island window this frame (islandWindow of the board radius; wider in Your Table). */
  island: IslandWindow;
  /**
   * Restarts the AR fade-in from the room now ("the room dissolves into
   * space"), over `seconds` (default COSMOS_FADE_SECONDS; tests slow it to
   * screenshot the dissolve half-way).
   */
  replayFade(seconds?: number): void;
  /** Holds the AR fade at 0 (the room only) until replayFade (the director's hook shot). */
  holdFade(): void;
  /** A solved comet is rising into the sky (SkyStorySystem). */
  solveRise: boolean;
  /** The vendored space textures: requested, loaded and failed ids (empty until loading starts). */
  textures(): SpaceTextureStatus;
}

/** Phase 3 hook (the sky gallery): called when a chapter-complete moment starts. */
export type ChapterCompleteListener = (chapter: number, stars: number) => void;

interface OnboardingStore {
  value: Readonly<OnboardingFlags>;
  revision: number;
}

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
  onboarding: 'onboarding',
  pause: 'pause',
  pauseListeners: 'pauseListeners',
  save: 'save',
  cometOverride: 'cometOverride',
  onboardingSession: 'onboardingSession',
  levelSelect: 'levelSelect',
  chapter: 'chapter',
  chapterListeners: 'chapterListeners',
  sandbox: 'sandbox',
  sandboxPanel: 'sandboxPanel',
  hitLog: 'hitLog',
  motionClock: 'motionClock',
  cosmos: 'cosmos',
  spaceFx: 'spaceFx',
} as const;

/** The board's light effects (SpaceFxSystem). */
export function setSpaceFx(world: World, fx: SpaceFx): void {
  world.globals[KEYS.spaceFx] = fx;
}
export function getSpaceFx(world: World): SpaceFx | undefined {
  return world.globals[KEYS.spaceFx] as SpaceFx | undefined;
}

export function setCosmos(world: World, cosmos: CosmosRuntime): void {
  world.globals[KEYS.cosmos] = cosmos;
}
export function getCosmos(world: World): CosmosRuntime | undefined {
  return world.globals[KEYS.cosmos] as CosmosRuntime | undefined;
}

export function setSandbox(world: World, sandbox: SandboxRuntime): void {
  world.globals[KEYS.sandbox] = sandbox;
}
export function getSandbox(world: World): SandboxRuntime | undefined {
  return world.globals[KEYS.sandbox] as SandboxRuntime | undefined;
}

/** The Your Table panel (SandboxPanelSystem). */
export interface SandboxPanelRuntime {
  readonly panel: UIKitMLAsset;
  readonly entity: Entity;
  /** Shown (sandbox mode). */
  shown: boolean;
}
export function setSandboxPanel(world: World, panel: SandboxPanelRuntime): void {
  world.globals[KEYS.sandboxPanel] = panel;
}
export function getSandboxPanel(world: World): SandboxPanelRuntime | undefined {
  return world.globals[KEYS.sandboxPanel] as SandboxPanelRuntime | undefined;
}

/** The sandbox hit log (created on first use; RealObjectSystem writes it). */
export function getHitLog(world: World): HitLog {
  let log = world.globals[KEYS.hitLog] as HitLog | undefined;
  if (!log) {
    log = {
      heights: new Float32Array(HIT_LOG_SIZE),
      positions: new Float32Array(HIT_LOG_SIZE * 3),
      count: 0,
      next: 0,
      total: 0,
      armed: false,
    };
    world.globals[KEYS.hitLog] = log;
  }
  return log;
}

export function getCometOverride(world: World): CometOverride {
  let o = world.globals[KEYS.cometOverride] as CometOverride | undefined;
  if (!o) {
    o = { active: false, position: [0, 0, 0], alpha: 1 };
    world.globals[KEYS.cometOverride] = o;
  }
  return o;
}

export function getOnboardingSession(world: World): OnboardingSession {
  let s = world.globals[KEYS.onboardingSession] as OnboardingSession | undefined;
  if (!s) {
    s = { interacted: false, attract: false, ghostHandVisible: false, ghostHandTime: 0 };
    world.globals[KEYS.onboardingSession] = s;
  }
  return s;
}
/** Records a first interaction (a button click, a hover or grab, a launch): the attract loop stops for good. */
export function markInteracted(world: World): void {
  getOnboardingSession(world).interacted = true;
}

export function setLevelSelect(world: World, levelSelect: LevelSelectRuntime): void {
  world.globals[KEYS.levelSelect] = levelSelect;
}
export function getLevelSelect(world: World): LevelSelectRuntime | undefined {
  return world.globals[KEYS.levelSelect] as LevelSelectRuntime | undefined;
}

export function setChapter(world: World, chapter: ChapterRuntime): void {
  world.globals[KEYS.chapter] = chapter;
}
export function getChapter(world: World): ChapterRuntime | undefined {
  return world.globals[KEYS.chapter] as ChapterRuntime | undefined;
}

function chapterListeners(world: World): Set<ChapterCompleteListener> {
  let listeners = world.globals[KEYS.chapterListeners] as Set<ChapterCompleteListener> | undefined;
  if (!listeners) {
    listeners = new Set();
    world.globals[KEYS.chapterListeners] = listeners;
  }
  return listeners;
}
/** ChapterEvents: calls `listener(chapter, stars)` on every chapter-complete moment; returns the teardown. */
export function onChapterComplete(world: World, listener: ChapterCompleteListener): () => void {
  const listeners = chapterListeners(world);
  listeners.add(listener);
  return () => listeners.delete(listener);
}
/** Notifies the chapter-complete listeners (ChapterSystem calls it). */
export function emitChapterComplete(world: World, chapter: number, stars: number): void {
  for (const listener of chapterListeners(world)) listener(chapter, stars);
}

function onboardingStore(world: World): OnboardingStore {
  let store = world.globals[KEYS.onboarding] as OnboardingStore | undefined;
  if (!store) {
    store = { value: DEFAULT_ONBOARDING, revision: 0 };
    world.globals[KEYS.onboarding] = store;
  }
  return store;
}

export function getOnboarding(world: World): Readonly<OnboardingFlags> {
  return onboardingStore(world).value;
}
export function getOnboardingRevision(world: World): number {
  return onboardingStore(world).revision;
}
/** Merges `partial` into the onboarding flags and bumps the revision; throws on a non-boolean. */
export function setOnboarding(world: World, partial: Partial<OnboardingFlags>): Readonly<OnboardingFlags> {
  const store = onboardingStore(world);
  const next: OnboardingFlags = { ...store.value };
  if (partial.ghostHandDone !== undefined) {
    if (typeof partial.ghostHandDone !== 'boolean') throw new TypeError('onboarding.ghostHandDone must be a boolean');
    next.ghostHandDone = partial.ghostHandDone;
  }
  store.value = next;
  store.revision++;
  return next;
}

type PauseListener = (pause: Readonly<PauseState>) => void;

function pauseListeners(world: World): Set<PauseListener> {
  let listeners = world.globals[KEYS.pauseListeners] as Set<PauseListener> | undefined;
  if (!listeners) {
    listeners = new Set();
    world.globals[KEYS.pauseListeners] = listeners;
  }
  return listeners;
}

export function getPause(world: World): Readonly<PauseState> {
  let pause = world.globals[KEYS.pause] as PauseState | undefined;
  if (!pause) {
    pause = { paused: false, reason: 'none', revision: 0 };
    world.globals[KEYS.pause] = pause;
  }
  return pause;
}
/**
 * Sets the pause reason ('none' resumes). Writes in place and notifies
 * listeners only when it changes (no allocation, so it may run per frame).
 */
export function setPause(world: World, reason: PauseReason): void {
  const pause = getPause(world) as PauseState;
  if (pause.reason === reason) return;
  pause.reason = reason;
  pause.paused = reason !== 'none';
  pause.revision++;
  for (const listener of pauseListeners(world)) listener(pause);
}
/** Calls `listener` on every pause change; returns the teardown. */
export function onPauseChange(world: World, listener: PauseListener): () => void {
  const listeners = pauseListeners(world);
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSave(world: World, save: SaveRuntime): void {
  world.globals[KEYS.save] = save;
}
export function getSave(world: World): SaveRuntime | undefined {
  return world.globals[KEYS.save] as SaveRuntime | undefined;
}

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
  for (const key of ['muted', 'quiet', 'leftHanded', 'highContrast', 'reducedMotion'] as const) {
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
  if (partial.boardSize !== undefined) {
    if (!BOARD_SIZES.includes(partial.boardSize)) throw new TypeError(`settings.boardSize must be one of ${BOARD_SIZES.join(', ')}`);
    next.boardSize = partial.boardSize;
  }
  if (partial.roomView !== undefined) {
    if (!ROOM_VIEWS.includes(partial.roomView)) throw new TypeError(`settings.roomView must be one of ${ROOM_VIEWS.join(', ')}`);
    next.roomView = partial.roomView;
  }
  store.value = next;
  store.revision++;
  return next;
}

interface MotionClock {
  value: number;
}

/**
 * The clock of decorative animation (planet spins and bands, pulses,
 * flowing rings, the target star's turn): the frame time, held still while
 * reduced motion is on. The comet and its tail keep the real clock.
 * Idempotent within a frame, so every system may call it. No allocation.
 */
export function motionTime(world: World, time: number): number {
  let clock = world.globals[KEYS.motionClock] as MotionClock | undefined;
  if (!clock) {
    clock = { value: time };
    world.globals[KEYS.motionClock] = clock;
  }
  if (!getSettings(world).reducedMotion) clock.value = time;
  return clock.value;
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
