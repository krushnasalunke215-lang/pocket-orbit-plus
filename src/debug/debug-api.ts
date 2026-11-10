import { DepthOccludable, DepthSensingSystem, Grabbed, Hovered, Vector3, type World } from '@iwsdk/core';
import { OCCLUSION_UNIFORMS } from '../render/shaders/common.js';
import { HIT_LOG_SIZE as HIT_LOG_CAPACITY } from '../xr/runtime.js';
import type { AudioEngineState, AudioEvent } from '../audio/engine.js';
import { renderVoiceOffline, type OfflineRender, type OfflineVoice } from '../audio/voices.js';
import { APP_NAME } from '../config.js';
import { DEFAULT_PAR } from '../game/song.js';
import type { BodyKind, SimOutcome } from '../sim/bodies.js';
import type { Placements } from '../sim/level.js';
import { BoardBody, WellPuck } from '../xr/components.js';
import {
  getAudio,
  getBoard,
  getChapter,
  getGame,
  getHud,
  getLevelSelect,
  getOnboarding,
  getOnboardingSession,
  getPause,
  getRenderStats,
  getHitLog,
  getRimButton,
  getSandbox,
  getSandboxPanel,
  getSave,
  getVisuals,
  setOnboarding,
  setSettings,
  type AppSettings,
  type HudRuntime,
  type LevelSelectRuntime,
  type PauseReason,
  type RenderCounts,
  type RimButtonRuntime,
  type SandboxPanelRuntime,
} from '../xr/runtime.js';
import { currentSessionMode, enterXR } from '../xr/session.js';
import { createSpikeApi, type SpikeApi } from './spike.js';

/*
 * Dev/e2e-only automation hooks on window.__game. index.ts imports this
 * module only when import.meta.env.DEV or MODE === 'e2e', so the production
 * build never contains it. Every return value is plain JSON.
 */

type Triple = [number, number, number];

export interface BodySnapshot {
  id: string;
  kind: BodyKind;
  movable: boolean;
  held: boolean;
  hovered: boolean;
  /** Board-normalized position. */
  board: Triple;
  /** World position in meters. */
  world: Triple;
}

export interface SandboxWellSnapshot {
  id: string;
  kind: 'object' | 'puck';
  source: string;
  /** Board position [x, 0, z]. */
  position: Triple;
  /** World position of the well's board point (meters). */
  world: Triple;
  heightM: number;
  measuredHeightM: number;
  mass: number;
  /** Pucks only: the puck is held or hovered. */
  held: boolean;
  hovered: boolean;
}

export interface GameSnapshot {
  /** 'story' or 'sandbox' (Your Table). */
  mode: string;
  level: { id: string; index: number; title: string; count: number };
  /** The level's body entities exist (they are rebuilt on the frame after a load). */
  levelBuilt: boolean;
  phase: string;
  solved: boolean;
  lastOutcome: SimOutcome | null;
  attempts: number;
  flightTime: number;
  /** Simulated length of the last launched flight in seconds (0 before any launch). */
  flightDuration: number;
  solvedLevelIds: string[];
  placements: Placements;
  bodies: BodySnapshot[];
  comet: { board: Triple; world: Triple; visible: boolean };
  board: {
    source: string;
    planeLabel: string | null;
    planeId: string | null;
    center: Triple;
    quaternion: [number, number, number, number];
    radius: number;
    /** World position of the board's grab handle (meters). */
    handle: Triple;
    handleHeld: boolean;
    handleHovered: boolean;
  };
  session: { mode: string; blendMode: string | null; enabledFeatures: string[]; visibility: string };
  /** The VR / desktop starfield is drawn (never over passthrough). */
  starfieldVisible: boolean;
  /** HUD world position and size (meters, from the UIKit layout) and its status line. */
  hud: { ready: boolean; position: Triple | null; size: [number, number] | null; status: string | null };
  /** The attract loop drives the comet visual (before the first interaction). */
  attract: boolean;
  /** The level-1 ghost hand: shown, seconds into its loop, and the saved onboarding flag. */
  ghostHand: { visible: boolean; time: number; done: boolean };
  /** The level-select panel: open, level button ids, the stars each shows, world position and size. */
  levelSelect: {
    ready: boolean;
    open: boolean;
    buttonIds: string[];
    shownStars: number[];
    position: Triple | null;
    size: [number, number] | null;
  };
  /** The chapter-complete moment. */
  chapterComplete: { shown: boolean; chapter: number; stars: number; maxStars: number };
  /** Near-rim Launch/Replay button: world position, size (meters), label and whether it is shown. */
  rimButton: { ready: boolean; position: Triple | null; size: [number, number] | null; label: string | null; shown: boolean };
  /** Whether each hand adapter has a loaded visual whose model is in the scene. */
  handVisuals: { left: boolean; right: boolean };
  /** Stars of the current flight (0 until solved), best per level id, and the solving flight's rung order. */
  stars: { last: number; best: Record<string, number>; rung: string[] };
  /** pathHash of the last launched flight (null before one). */
  lastPathHash: string | null;
  /** Your Table: target, wells, arming, reticle, the panel and the hit log. */
  sandbox: {
    targetId: string | null;
    wells: SandboxWellSnapshot[];
    /** Wells the game's flights use now (0 in story mode). */
    activeWells: number;
    armed: boolean;
    armHand: string | null;
    pucks: number;
    selectedId: string | null;
    status: string | null;
    reticle: { visible: boolean; hit: string; world: Triple; board: Triple; heightM: number } | null;
    panel: { shown: boolean; position: Triple | null; size: [number, number] | null };
    hitLog: { count: number; total: number; armed: boolean; lastHeightM: number | null };
  };
  /** The Pause record (LifecycleSystem). */
  pause: { paused: boolean; reason: PauseReason };
  /** SaveSystem: page clock (performance.now) of the last write, and the load or write problem. */
  save: { lastSavedAt: number | null; problem: string | null };
  /** renderer.info of the last rendered frame. */
  renderer: {
    calls: number;
    triangles: number;
    points: number;
    lines: number;
    geometries: number;
    textures: number;
    programs: number;
  };
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface LevelSummary {
  id: string;
  title: string;
  solution: Placements;
  /** Ring order that earns 3 stars (null without one). */
  melody: string[] | null;
  /** Placements that ring the melody when the stored solution does not (else null). */
  melodySolution: Placements | null;
  par: number;
}

/** One note of the last launched flight, as the audio system should ring it. */
export interface ExpectedNote {
  bodyId: string;
  source: string;
  /** Flight time of the flyby (seconds). */
  time: number;
  midi: number;
  /** GameController.flightId of that flight. */
  flightId: number;
}

export interface AudioDebugApi {
  state(): AudioEngineState;
  /** The event log (last 64 sounds), oldest first. */
  events(): AudioEvent[];
  expectedNotes(): ExpectedNote[];
  setSettings(partial: Partial<AppSettings>): AppSettings;
  /** Renders a voice through the real reverb and limiter offline and measures it. */
  renderOffline(voice: OfflineVoice, seconds?: number): Promise<OfflineRender>;
}

export interface GameDebugApi {
  readonly ready: boolean;
  readonly appName: string;
  snapshot(): GameSnapshot;
  levels(): LevelSummary[];
  /** Resolves once the level's entities are built. */
  loadLevel(index: number): Promise<void>;
  nextLevel(): Promise<void>;
  launch(): void;
  /** Commits placements for movable bodies (as a release would, without launching). */
  setPlacements(placements: Placements): void;
  placeBoard(): void;
  /** Requests the immersive-vr (starfield) fallback session, as enterXR does without AR. */
  enterVR(): void;
  /** Viewport CSS pixels of a board point ([x, z] or [x, y, z]); null if off screen. */
  screenPoint(boardPos: readonly number[]): ScreenPoint | null;
  /**
   * Viewport CSS pixels of a HUD or near-rim button element's center
   * (default the HUD Launch button).
   */
  hudScreenPoint(elementId?: string): ScreenPoint | null;
  /** World position (meters) of a HUD, near-rim button or level-select element's center. */
  uiWorldPoint(elementId: string): Triple | null;
  /** Fresh-save onboarding: ghostHandDone false and the attract loop on again (no interaction yet). */
  resetOnboarding(): void;
  /** Names (URLs) of every resource the page has loaded (Resource Timing). */
  resourceUrls(): string[];
  /** Per-frame renderer.info samples since the last reset (RenderStatsSystem). */
  renderStats(): RenderStatsSnapshot;
  resetRenderStats(): void;
  /** Writes the save now; false when storage refused it. */
  saveNow(): boolean;
  /** Removes the stored save (the running game is unchanged; the next change saves again). */
  clearSave(): boolean;
  /** Your Table sandbox controls (the same actions as the panel buttons). */
  readonly sandbox: SandboxDebugApi;
  /** Depth occlusion status: system, granted feature, depth frames, occludable entities, uniforms. */
  occlusion(): OcclusionStatus;
  /** Turns occlusion on or off (DepthSensingSystem enableOcclusion); returns the new status. */
  setOcclusion(on: boolean): OcclusionStatus;
  /** Real-object gravity spike probes (room features, planes, meshes, hit-test). */
  readonly spike: SpikeApi;
  /** The game audio engine: state, event log, expected notes, settings and offline renders. */
  readonly audio: AudioDebugApi;
}

export interface SandboxDebugApi {
  /** Loads Your Table target index (default 0); resolves once it is built. */
  enter(index?: number): Promise<void>;
  /** Back to the story level the sandbox was entered from; resolves once it is built. */
  exit(): Promise<void>;
  arm(hand?: 'left' | 'right'): void;
  disarm(): void;
  addPuck(): void;
  stepHeight(steps: number): void;
  clear(): void;
}

export interface OcclusionStatus {
  systemRegistered: boolean;
  /** The session granted 'depth-sensing'. */
  featureEnabled: boolean;
  depthUsage: string | null;
  /** DepthSensingSystem enableOcclusion. */
  enabled: boolean;
  /** Frames with XR depth data since the last render-stats reset. */
  depthFrames: number;
  /** Depth data this frame. */
  depthNow: boolean;
  occludableEntities: number;
  /** The shared occlusion uniforms hold a depth texture and occlusionEnabled. */
  uniformsBound: boolean;
  occlusionEnabledUniform: boolean;
  viewportSize: [number, number];
  rawValueToMeters: number;
  /** XRWebGLDepthInformation.depthNear and the depth texture size this frame (GPU path). */
  depthNear: number | null;
  depthSize: [number, number] | null;
}

export interface RenderStatsSnapshot {
  last: RenderCounts;
  max: RenderCounts;
  frames: number;
  depthFrames: number;
  programs: number;
  geometries: number;
  textures: number;
  autoReset: boolean;
}

declare global {
  interface Window {
    __game?: GameDebugApi;
  }
}

function triple(v: Vector3): Triple {
  return [v.x, v.y, v.z];
}

export function installDebugApi(world: World): GameDebugApi {
  const bodies = world.queryManager.registerQuery({ required: [BoardBody] });
  const v = new Vector3();
  // The default 250-entry Resource Timing buffer fills with dev modules before
  // XR starts; keep room so resourceUrls() sees what a session loads.
  performance.setResourceTimingBufferSize(10_000);

  const core = () => {
    const game = getGame(world);
    const board = getBoard(world);
    if (!game || !board) throw new Error('Game is not initialized yet');
    return { game, board };
  };

  /** Projects a world point to viewport CSS pixels. */
  const toScreen = (point: Vector3): ScreenPoint | null => {
    const camera = world.camera;
    camera.updateMatrixWorld();
    point.project(camera);
    if (point.z < -1 || point.z > 1) return null;
    const rect = world.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((point.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - point.y) / 2) * rect.height,
    };
  };

  /** A HUD, near-rim button or level-select element by id. */
  const uiElement = (elementId: string) =>
    getHud(world)?.panel.getElementById(elementId) ??
    getRimButton(world)?.panel.getElementById(elementId) ??
    getLevelSelect(world)?.panel.getElementById(elementId) ??
    getSandboxPanel(world)?.panel.getElementById(elementId);

  /** UIKit units are centimeters before the panel entity's own scale. */
  const panelSize = (panel: HudRuntime | RimButtonRuntime | LevelSelectRuntime | SandboxPanelRuntime | undefined): [number, number] | null => {
    const size = panel?.panel.document.computedSize;
    if (!panel || !size) return null;
    const s = panel.entity.object3D!.getWorldScale(new Vector3()).x * 0.01;
    return [size.width * s, size.height * s];
  };

  /** A hand visual is loaded when its adapter has one whose model hangs under the scene. */
  const handVisualLoaded = (hand: 'left' | 'right'): boolean => {
    let node = world.input.xr.visualAdapters.hand[hand].visual?.model ?? null;
    while (node) {
      if (node === world.scene) return true;
      node = node.parent;
    }
    return false;
  };

  /** Polls with timers (rAF does not run on the window during XR). */
  const levelBuilt = (): Promise<void> =>
    new Promise((resolve, reject) => {
      const started = performance.now();
      const check = () => {
        const game = getGame(world);
        if (game && getVisuals(world)?.builtRevision === game.levelRevision) resolve();
        else if (performance.now() - started > 5000) reject(new Error('Level was not built within 5 s'));
        else setTimeout(check, 16);
      };
      check();
    });

  const sandboxPucks = world.queryManager.registerQuery({ required: [WellPuck] });
  const occludables = world.queryManager.registerQuery({ required: [DepthOccludable] });
  const puckEntity = (id: string) => {
    for (const entity of sandboxPucks.entities) if (entity.getValue(WellPuck, 'wellId') === id) return entity;
    return undefined;
  };
  const sandboxRuntime = () => {
    const s = getSandbox(world);
    if (!s) throw new Error('RealObjectSystem is not registered');
    return s;
  };
  const occlusionStatus = (): OcclusionStatus => {
    const depth = world.getSystem(DepthSensingSystem);
    const session = world.session as (XRSession & { enabledFeatures?: string[]; depthUsage?: string }) | undefined;
    const vp = OCCLUSION_UNIFORMS.uViewportSize.value;
    return {
      systemRegistered: Boolean(depth),
      featureEnabled: Boolean(session?.enabledFeatures?.includes('depth-sensing')),
      depthUsage: session ? (session.depthUsage ?? null) : null,
      enabled: depth?.config.enableOcclusion.value ?? false,
      depthFrames: getRenderStats(world)?.depthFrames ?? 0,
      depthNow: Boolean(depth && (depth.gpuDepthData.length > 0 || depth.cpuDepthData.length > 0)),
      occludableEntities: occludables.entities.size,
      uniformsBound: OCCLUSION_UNIFORMS.occlusionEnabled.value && OCCLUSION_UNIFORMS.uXRDepthTextureArray.value !== null,
      occlusionEnabledUniform: OCCLUSION_UNIFORMS.occlusionEnabled.value,
      viewportSize: [vp.x, vp.y],
      rawValueToMeters: depth?.rawValueToMeters ?? 0,
      depthNear: (depth?.gpuDepthData[0] as { depthNear?: number } | undefined)?.depthNear ?? null,
      depthSize: depth?.gpuDepthData[0] ? [depth.gpuDepthData[0].width, depth.gpuDepthData[0].height] : null,
    };
  };

  const api: GameDebugApi = {
    get ready() {
      return Boolean(
        getGame(world) && getBoard(world) && getVisuals(world) && getHud(world) && getRimButton(world) && getLevelSelect(world) && getSandboxPanel(world),
      );
    },
    appName: APP_NAME,

    snapshot() {
      const { game, board } = core();
      const visuals = getVisuals(world);
      const hud = getHud(world);
      const rim = getRimButton(world);
      const root = board.entity.object3D!;
      root.updateWorldMatrix(true, true);

      const bodyList: BodySnapshot[] = [];
      for (const entity of bodies.entities) {
        const id = entity.getValue(BoardBody, 'bodyId') as string;
        const def = game.level.bodies.find((b) => b.id === id);
        const object = entity.object3D;
        if (!def || !object) continue;
        bodyList.push({
          id,
          kind: def.kind,
          movable: Boolean(def.movable),
          held: entity.hasComponent(Grabbed),
          hovered: entity.hasComponent(Hovered),
          board: triple(object.position),
          world: triple(object.getWorldPosition(v)),
        });
      }
      const order = new Map(game.level.bodies.map((b, i) => [b.id, i]));
      bodyList.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

      const cometBoard: Triple = [0, 0, 0];
      game.cometBoardPosition(cometBoard);
      const cometRoot = visuals?.comet.root;
      const info = world.renderer.info;
      const session = world.session;
      const pose = board.pose;
      const pause = getPause(world);
      const save = getSave(world);
      const onboarding = getOnboardingSession(world);
      const levelSelect = getLevelSelect(world);
      const chapter = getChapter(world);
      const sandbox = getSandbox(world);
      const sandboxPanel = getSandboxPanel(world);
      const hitLog = getHitLog(world);
      const root2 = board.entity.object3D!;
      return {
        mode: game.mode,
        level: { id: game.level.id, index: game.levelIndex, title: game.level.title, count: game.levels.length },
        levelBuilt: visuals?.builtRevision === game.levelRevision,
        phase: game.phase,
        solved: game.solved,
        lastOutcome: game.lastOutcome,
        attempts: game.attempts,
        flightTime: game.flightTime,
        flightDuration: game.lastResult?.time ?? 0,
        solvedLevelIds: [...game.solvedLevelIds],
        placements: JSON.parse(JSON.stringify(game.placements)) as Placements,
        bodies: bodyList,
        comet: {
          board: cometBoard,
          world: triple(root.localToWorld(v.set(cometBoard[0], cometBoard[1], cometBoard[2]))),
          visible: Boolean(cometRoot?.visible),
        },
        board: {
          source: board.placement.source,
          planeLabel: board.placement.planeLabel ?? null,
          planeId: board.placement.planeId ?? null,
          center: [...pose.center] as Triple,
          quaternion: [...pose.quaternion] as [number, number, number, number],
          radius: pose.radius,
          handle: triple(board.handleEntity.object3D!.getWorldPosition(v)),
          handleHeld: board.handleEntity.hasComponent(Grabbed),
          handleHovered: board.handleEntity.hasComponent(Hovered),
        },
        starfieldVisible: Boolean(world.scene.getObjectByName('Starfield')?.visible),
        session: {
          mode: currentSessionMode(world),
          blendMode: session?.environmentBlendMode ?? null,
          enabledFeatures: [...((session as (XRSession & { enabledFeatures?: string[] }) | undefined)?.enabledFeatures ?? [])],
          visibility: world.visibilityState.peek(),
        },
        hud: {
          ready: Boolean(hud),
          position: hud ? triple(hud.entity.object3D!.getWorldPosition(v)) : null,
          size: panelSize(hud),
          status: hud?.status ?? null,
        },
        attract: onboarding.attract,
        ghostHand: {
          visible: onboarding.ghostHandVisible,
          time: onboarding.ghostHandTime,
          done: getOnboarding(world).ghostHandDone,
        },
        levelSelect: {
          ready: Boolean(levelSelect),
          open: levelSelect?.open ?? false,
          buttonIds: [...(levelSelect?.buttonIds ?? [])],
          shownStars: [...(levelSelect?.shownStars ?? [])],
          position: levelSelect ? triple(levelSelect.entity.object3D!.getWorldPosition(v)) : null,
          size: panelSize(levelSelect),
        },
        chapterComplete: {
          shown: chapter?.shown ?? false,
          chapter: chapter?.chapter ?? 0,
          stars: chapter?.stars ?? 0,
          maxStars: chapter?.maxStars ?? 0,
        },
        rimButton: {
          ready: Boolean(rim),
          position: rim ? triple(rim.entity.object3D!.getWorldPosition(v)) : null,
          size: panelSize(rim),
          label: rim?.label ?? null,
          shown: rim?.shown ?? false,
        },
        handVisuals: { left: handVisualLoaded('left'), right: handVisualLoaded('right') },
        stars: { last: game.lastStars, best: Object.fromEntries(game.bestStars), rung: [...game.lastRung] },
        lastPathHash: game.lastResult?.pathHash ?? null,
        sandbox: {
          targetId: game.mode === 'sandbox' ? game.level.id : null,
          wells: (sandbox?.wells ?? []).map((w) => ({
            id: w.id,
            kind: w.kind,
            source: game.externalWells.find((e) => e.id === w.id)?.source ?? '',
            position: [...w.position] as Triple,
            world: triple(root2.localToWorld(v.set(w.position[0], 0, w.position[2]))),
            heightM: w.heightM,
            measuredHeightM: w.measuredHeightM,
            mass: w.mass,
            held: puckEntity(w.id)?.hasComponent(Grabbed) ?? false,
            hovered: puckEntity(w.id)?.hasComponent(Hovered) ?? false,
          })),
          activeWells: game.activeWells.length,
          armed: sandbox?.armed ?? false,
          armHand: sandbox?.armHand ?? null,
          pucks: sandboxPucks.entities.size,
          selectedId: sandbox?.selectedId ?? null,
          status: sandbox?.status ?? null,
          reticle: sandbox
            ? { ...sandbox.reticle, world: [...sandbox.reticle.world] as Triple, board: [...sandbox.reticle.board] as Triple }
            : null,
          panel: {
            shown: sandboxPanel?.shown ?? false,
            position: sandboxPanel ? triple(sandboxPanel.entity.object3D!.getWorldPosition(v)) : null,
            size: panelSize(sandboxPanel),
          },
          hitLog: {
            count: hitLog.count,
            total: hitLog.total,
            armed: hitLog.armed,
            lastHeightM: hitLog.count > 0 ? hitLog.heights[(hitLog.next + HIT_LOG_CAPACITY - 1) % HIT_LOG_CAPACITY] : null,
          },
        },
        pause: { paused: pause.paused, reason: pause.reason },
        save: { lastSavedAt: save?.lastSavedAt ?? null, problem: save?.problem ?? null },
        renderer: {
          calls: info.render.calls,
          triangles: info.render.triangles,
          points: info.render.points,
          lines: info.render.lines,
          geometries: info.memory.geometries,
          textures: info.memory.textures,
          programs: info.programs?.length ?? 0,
        },
      };
    },

    levels() {
      const { game } = core();
      return game.levels.map((l) => ({
        id: l.id,
        title: l.title,
        solution: JSON.parse(JSON.stringify(l.solution)) as Placements,
        melody: l.melody ? [...l.melody] : null,
        melodySolution: l.melodySolution ? (JSON.parse(JSON.stringify(l.melodySolution)) as Placements) : null,
        par: l.par ?? DEFAULT_PAR,
      }));
    },

    loadLevel(index) {
      core().game.loadLevel(index);
      return levelBuilt();
    },

    nextLevel() {
      core().game.nextLevel();
      return levelBuilt();
    },

    launch() {
      core().game.launch();
    },

    setPlacements(placements) {
      const { game } = core();
      for (const [id, p] of Object.entries(placements)) game.setPlacement(id, p);
    },

    placeBoard() {
      core().board.placeBoard();
    },

    enterVR() {
      enterXR(world, { ar: false, vr: true });
    },

    screenPoint(boardPos) {
      const { board } = core();
      const root = board.entity.object3D!;
      root.updateWorldMatrix(true, false);
      const [x, y, z] = boardPos.length >= 3 ? boardPos : [boardPos[0], 0, boardPos[1]];
      return toScreen(root.localToWorld(new Vector3(x, y, z)));
    },

    hudScreenPoint(elementId = 'launch-button') {
      const element = uiElement(elementId);
      if (!element) return null;
      element.updateWorldMatrix(true, false);
      return toScreen(new Vector3().setFromMatrixPosition(element.matrixWorld));
    },

    uiWorldPoint(elementId) {
      const element = uiElement(elementId);
      if (!element) return null;
      element.updateWorldMatrix(true, false);
      return triple(new Vector3().setFromMatrixPosition(element.matrixWorld));
    },

    resetOnboarding() {
      setOnboarding(world, { ghostHandDone: false });
      getOnboardingSession(world).interacted = false;
    },

    resourceUrls() {
      return performance.getEntriesByType('resource').map((entry) => entry.name);
    },

    renderStats() {
      const stats = getRenderStats(world);
      if (!stats) throw new Error('RenderStatsSystem is not registered');
      return {
        last: { ...stats.last },
        max: { ...stats.max },
        frames: stats.frames,
        depthFrames: stats.depthFrames,
        programs: stats.programs,
        geometries: stats.geometries,
        textures: stats.textures,
        autoReset: stats.autoReset,
      };
    },

    resetRenderStats() {
      getRenderStats(world)?.reset();
    },

    saveNow() {
      const save = getSave(world);
      if (!save) throw new Error('SaveSystem is not registered');
      return save.saveNow();
    },

    clearSave() {
      const save = getSave(world);
      if (!save) throw new Error('SaveSystem is not registered');
      return save.clear();
    },

    sandbox: {
      enter(index = 0) {
        core().game.loadSandbox(index);
        return levelBuilt();
      },
      exit() {
        getSandbox(world)?.disarm();
        core().game.exitSandbox();
        return levelBuilt();
      },
      arm(hand) {
        sandboxRuntime().arm(hand);
      },
      disarm() {
        sandboxRuntime().disarm();
      },
      addPuck() {
        sandboxRuntime().addPuck();
      },
      stepHeight(steps) {
        sandboxRuntime().stepHeight(steps);
      },
      clear() {
        sandboxRuntime().clear();
      },
    },

    occlusion() {
      return occlusionStatus();
    },

    setOcclusion(on) {
      const depth = world.getSystem(DepthSensingSystem);
      if (!depth) throw new Error('DepthSensingSystem is not registered');
      depth.config.enableOcclusion.value = Boolean(on);
      return occlusionStatus();
    },

    spike: createSpikeApi(world),

    audio: {
      state() {
        const engine = getAudio(world);
        if (!engine) throw new Error('GameAudioSystem is not registered');
        return engine.state();
      },
      events() {
        return getAudio(world)?.log.toArray() ?? [];
      },
      expectedNotes() {
        const { game } = core();
        return game.lastNotes.map((n) => ({
          bodyId: n.bodyId,
          source: n.source,
          time: n.time,
          midi: n.midi,
          flightId: game.flightId,
        }));
      },
      setSettings(partial) {
        return setSettings(world, partial);
      },
      renderOffline(voice, seconds = 2) {
        return renderVoiceOffline(voice, seconds);
      },
    },
  };

  window.__game = api;
  return api;
}
