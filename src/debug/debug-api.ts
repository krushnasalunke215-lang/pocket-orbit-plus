import { Grabbed, Hovered, Vector3, type World } from '@iwsdk/core';
import { APP_NAME } from '../config.js';
import type { BodyKind, SimOutcome } from '../sim/bodies.js';
import type { Placements } from '../sim/level.js';
import { BoardBody } from '../xr/components.js';
import {
  getBoard,
  getGame,
  getHud,
  getRenderStats,
  getRimButton,
  getVisuals,
  type HudRuntime,
  type RenderCounts,
  type RimButtonRuntime,
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

export interface GameSnapshot {
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
  /** HUD world position and size (meters, from the UIKit layout). */
  hud: { ready: boolean; position: Triple | null; size: [number, number] | null };
  /** Near-rim Launch/Replay button: world position, size (meters) and label. */
  rimButton: { ready: boolean; position: Triple | null; size: [number, number] | null; label: string | null };
  /** Whether each hand adapter has a loaded visual whose model is in the scene. */
  handVisuals: { left: boolean; right: boolean };
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

export interface GameDebugApi {
  readonly ready: boolean;
  readonly appName: string;
  snapshot(): GameSnapshot;
  levels(): { id: string; title: string; solution: Placements }[];
  /** Resolves once the level's entities are built. */
  loadLevel(index: number): Promise<void>;
  nextLevel(): Promise<void>;
  launch(): void;
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
  /** Names (URLs) of every resource the page has loaded (Resource Timing). */
  resourceUrls(): string[];
  /** Per-frame renderer.info samples since the last reset (RenderStatsSystem). */
  renderStats(): RenderStatsSnapshot;
  resetRenderStats(): void;
  /** Real-object gravity spike probes (room features, planes, meshes, hit-test). */
  readonly spike: SpikeApi;
}

export interface RenderStatsSnapshot {
  last: RenderCounts;
  max: RenderCounts;
  frames: number;
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

  /** UIKit units are centimeters before the panel entity's own scale. */
  const panelSize = (panel: HudRuntime | RimButtonRuntime | undefined): [number, number] | null => {
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

  const api: GameDebugApi = {
    get ready() {
      return Boolean(getGame(world) && getBoard(world) && getVisuals(world) && getHud(world) && getRimButton(world));
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
      return {
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
        },
        rimButton: {
          ready: Boolean(rim),
          position: rim ? triple(rim.entity.object3D!.getWorldPosition(v)) : null,
          size: panelSize(rim),
          label: rim?.label ?? null,
        },
        handVisuals: { left: handVisualLoaded('left'), right: handVisualLoaded('right') },
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
      const element =
        getHud(world)?.panel.getElementById(elementId) ?? getRimButton(world)?.panel.getElementById(elementId);
      if (!element) return null;
      element.updateWorldMatrix(true, false);
      return toScreen(new Vector3().setFromMatrixPosition(element.matrixWorld));
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
        programs: stats.programs,
        geometries: stats.geometries,
        textures: stats.textures,
        autoReset: stats.autoReset,
      };
    },

    resetRenderStats() {
      getRenderStats(world)?.reset();
    },

    spike: createSpikeApi(world),
  };

  window.__game = api;
  return api;
}
