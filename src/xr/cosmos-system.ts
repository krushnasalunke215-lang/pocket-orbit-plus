import { createSystem, Quaternion, Vector3, VisibilityState } from '@iwsdk/core';
import { BOARD, COSMOS_FADE_SECONDS, COSMOS_QUALITY_PROFILES, SUN_DIRECTION } from '../config.js';
import { cosmosOpacity, islandWindow } from '../game/cosmos-rules.js';
import { isGlassesView } from '../game/quality-rules.js';
import { COSMOS_UNIFORMS, createCosmosVisual } from '../render/cosmos/cosmos-visual.js';
import { SUN_DIR_W } from '../render/shaders/common.js';
import { loadSpaceTextures, type SpaceTextureLoader } from '../render/space-textures.js';
import { cosmosQuality, graphicsState, markLiveGlassesLow } from './graphics-quality.js';
import { prewarmDisabled } from './shader-prewarm-system.js';
import { getBoard, getGame, getSettings, motionTime, setCosmos, type CosmosRuntime } from './runtime.js';
import { currentSessionMode } from './session.js';

/** The other space textures start loading on this update, after the first frames have rendered (the planet atlas starts at init). */
const TEXTURE_START_FRAME = 3;

/**
 * The surrounding cosmos (src/render/cosmos). Keeps its root at the board
 * center with the board's turn (board -Z ahead of the player), and writes
 * its shared opacity and mask uniforms every frame from cosmosOpacity: on
 * the desktop and in VR the cosmos is fully opaque; when an AR session
 * becomes visible it fades in over the room for COSMOS_FADE_SECONDS ("your
 * room dissolves into space"), as the Room view setting says (Mixed shows
 * the room only through a soft window over the board and the table, sized
 * from the board radius by islandWindow; Space fills the room,
 * Room hides it: no draw calls); Your Table caps it so real objects stay
 * clear. Its decorative motion runs on motionTime (still under reduced
 * motion), and no shooting star spawns under reduced motion. It also
 * starts the vendored space textures on its 3rd update (procedural
 * fallbacks until then) and keeps SUN_DIR_W in step with the board's turn.
 */
export class CosmosSystem extends createSystem({}) {
  private runtime!: CosmosRuntime;
  private lastBoardVersion = -1;
  private lastVisibility: VisibilityState = VisibilityState.NonImmersive;
  /** Real time the AR fade started (-1: none, the cosmos is fully faded in). */
  private fadeStart = -1;
  private fadeSeconds = COSMOS_FADE_SECONDS;
  private held = false;
  private replay = false;
  private frames = 0;
  private windowRadius = -1;
  private windowSandbox = false;
  /** The XR view was checked for the glasses' form factor in this session. */
  private viewChecked = false;
  private textures: SpaceTextureLoader | null = null;
  /** The planet atlas, requested at init so its upload lands before play (final-report #4). */
  private atlas: SpaceTextureLoader | null = null;
  private readonly head = new Vector3();
  private readonly boardTurn = new Quaternion();
  private readonly sunBoard = new Vector3();

  init(): void {
    const visual = createCosmosVisual(cosmosQuality());
    this.world.createTransformEntity(visual.root, { persistent: true });
    this.sunBoard.set(SUN_DIRECTION[0], SUN_DIRECTION[1], SUN_DIRECTION[2]).normalize();
    this.runtime = {
      visual,
      visible: true,
      opacity: 1,
      fade: 1,
      mask: 'none',
      island: islandWindow(BOARD.fallbackRadius, false),
      solveRise: false,
      replayFade: (seconds?: number) => {
        this.held = false;
        this.replay = true;
        this.fadeSeconds = seconds !== undefined && seconds > 0 ? seconds : COSMOS_FADE_SECONDS;
      },
      holdFade: () => {
        this.held = true;
      },
      textures: () => {
        const a = this.atlas?.status() ?? { requested: [], loaded: [], failed: [] };
        const b = this.textures?.status() ?? { requested: [], loaded: [], failed: [] };
        return { requested: [...b.requested, ...a.requested], loaded: [...a.loaded, ...b.loaded], failed: [...a.failed, ...b.failed] };
      },
    };
    setCosmos(this.world, this.runtime);
    if (!prewarmDisabled()) this.atlas = loadSpaceTextures(this.world.renderer, cosmosQuality().textureSize, 'atlas');
  }

  update(delta: number, time: number): void {
    this.frames++;
    if (this.frames === TEXTURE_START_FRAME) {
      this.textures = loadSpaceTextures(this.world.renderer, cosmosQuality().textureSize, this.atlas ? 'others' : 'all');
    }
    this.atlas?.tick(delta);
    this.textures?.tick(delta);

    const board = getBoard(this.world);
    const game = getGame(this.world);
    if (!board || !game) return;
    const visual = this.runtime.visual;
    const root = visual.root;
    if (board.version !== this.lastBoardVersion) {
      const { center, quaternion } = board.pose;
      root.position.set(center[0], center[1], center[2]);
      root.quaternion.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
      COSMOS_UNIFORMS.uBoardCenterW.value.set(center[0], center[1], center[2]);
      this.boardTurn.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
      SUN_DIR_W.value.copy(this.sunBoard).applyQuaternion(this.boardTurn);
      this.camera.getWorldPosition(this.head);
      visual.setEyeHeight(Math.min(1.2, Math.max(0.15, this.head.y - center[1])));
      this.lastBoardVersion = board.version;
    }

    const visibility = this.visibilityState.peek();
    if (this.lastVisibility === VisibilityState.NonImmersive && visibility !== VisibilityState.NonImmersive) {
      this.fadeStart = time;
      this.fadeSeconds = COSMOS_FADE_SECONDS;
    }
    this.lastVisibility = visibility;
    if (visibility === VisibilityState.NonImmersive) this.viewChecked = false;
    else if (!this.viewChecked) this.checkGlassesView(board.visual);
    if (this.replay) {
      this.fadeStart = time;
      this.replay = false;
    }
    // Desktop whenever the page is not immersive (world.session can outlive an ended session for a frame).
    const session = visibility === VisibilityState.NonImmersive ? 'none' : currentSessionMode(this.world);
    const fade = session !== 'immersive-ar' ? 1 : this.held ? 0 : this.fadeStart < 0 ? 1 : Math.min(1, (time - this.fadeStart) / this.fadeSeconds);
    const settings = getSettings(this.world);
    const state = cosmosOpacity({ session, roomView: settings.roomView, sandbox: game.mode === 'sandbox', fade01: fade });
    COSMOS_UNIFORMS.uCosmosOpacity.value = state.opacity;
    COSMOS_UNIFORMS.uMaskMode.value = state.mask === 'island' ? 1 : 0;
    const sandbox = game.mode === 'sandbox';
    const radius = board.pose.radius;
    if (radius !== this.windowRadius || sandbox !== this.windowSandbox) {
      const win = islandWindow(radius, sandbox);
      COSMOS_UNIFORMS.uIslandClear.value = win.clearM;
      COSMOS_UNIFORMS.uIslandFull.value = win.fullM;
      this.runtime.island = win;
      this.windowRadius = radius;
      this.windowSandbox = sandbox;
    }
    root.visible = state.visible && state.opacity > 0;
    this.runtime.visible = root.visible;
    this.runtime.opacity = state.opacity;
    this.runtime.fade = fade;
    this.runtime.mask = state.mask;

    visual.update(motionTime(this.world, time), time, delta, settings.reducedMotion);
  }

  /**
   * The Meta VR Glasses form factor, recognised by its narrow XR view (37°
   * left and right, 25° up, 43° down): a High page switches to the Low
   * profile in place (glints, dust, star and rock counts, the grid plate; the
   * loaded textures stay). ?quality=high keeps High. Once per session, on the
   * first frame with XR eye cameras.
   */
  private checkGlassesView(board: { setGridSegments(n: number): void }): void {
    const eye = this.world.renderer.xr.getCamera().cameras[0] as { projectionMatrix: { elements: ArrayLike<number> } } | undefined;
    if (!eye) return;
    this.viewChecked = true;
    const e = eye.projectionMatrix.elements;
    if (e[0] <= 0 || e[5] <= 0) return;
    const glasses = isGlassesView((1 - e[8]) / e[0], (1 + e[8]) / e[0], (1 + e[9]) / e[5], (1 - e[9]) / e[5]);
    const state = graphicsState();
    if (!glasses || state.tier === 'low' || state.source === 'url') return;
    const low = COSMOS_QUALITY_PROFILES.low;
    this.runtime.visual.applyQuality(low);
    board.setGridSegments(low.gridSegments);
    markLiveGlassesLow();
  }
}
