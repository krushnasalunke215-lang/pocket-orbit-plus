import {
  createSystem,
  PokeInteractable,
  RayInteractable,
  Vector3,
  VisibilityState,
  type Entity,
  type UIKit,
  type UIKitMLAsset,
} from '@iwsdk/core';
import { levelSelectPose } from '../game/hud-layout.js';
import {
  getBoard,
  getGame,
  getPause,
  getSettings,
  getSettingsRevision,
  markInteracted,
  setLevelSelect,
  setSettings,
  type LevelSelectRuntime,
} from './runtime.js';

/** Authored in Horizon kit pixel units like the HUD: 10 units = 1 cm. */
const UNIT_SCALE = 0.1;
/** Level buttons in the panel (level-1 .. level-6). */
const SLOTS = 6;
const VOLUME_STEP = 0.1;
/** Re-place the open panel only when the head moved this far (a poke must not chase it). */
const HEAD_MOVE_EPS = 0.25;
/** Above every board visual's renderOrder (the ghost planet copy uses 5). */
const PANEL_RENDER_ORDER = 10;
const STAR_LIT = '#f0e442';
const STAR_DIM = '#5b6170';
const FORWARD: readonly [number, number, number] = [0, 0, -1];

interface SlotElements {
  readonly button: UIKit.Text;
  readonly label: UIKit.Text;
  readonly stars: UIKit.Text;
  readonly icons: readonly UIKit.Text[];
}

/**
 * The level-select panel: a 3 x 2 grid of the chapter's levels with each
 * solved level's best stars (unsolved levels show none; nothing is
 * locked), the Your Table button (opens the sandbox) and the audio settings
 * (mute, volume, quiet), which edit the runtime AppSettings that SaveSystem
 * persists and GameAudioSystem applies. Hidden by default; the HUD Levels
 * button opens it (show()). A level click loads that level and closes it.
 * While open it sits 0.45 m from the head toward the board (levelSelectPose)
 * and takes hand rays, gaze, the mouse and fingertip pokes; while hidden it
 * has no interactable components, so it can take no ray or poke. Clicks are
 * ignored while the game is paused.
 */
export class LevelSelectSystem extends createSystem({}) {
  private entity: Entity | null = null;
  private runtime: LevelSelectRuntime | null = null;
  private slots: SlotElements[] = [];
  private muteLabel: UIKit.Text | null = null;
  private volumeLabel: UIKit.Text | null = null;
  private quietLabel: UIKit.Text | null = null;
  private lastStarsRevision = -1;
  private lastSettingsRevision = -1;
  private lastBoardVersion = -1;
  private needsPose = false;
  private readonly head = new Vector3();
  private readonly placedFrom = new Vector3(Infinity, Infinity, Infinity);

  init(): void {
    this.world.assets
      .instantiate<UIKitMLAsset>('level-select')
      .then((panel) => this.setup(panel))
      .catch((error: unknown) => console.error('[LevelSelect] could not load level-select', error));
  }

  private setup(panel: UIKitMLAsset): void {
    const entity = this.world.createTransformEntity(panel);
    entity.object3D!.scale.setScalar(UNIT_SCALE);
    entity.object3D!.visible = false;

    const element = (id: string) => panel.requireElementById<UIKit.Text>(id);
    // Draw after the board's additive sprites (renderOrder up to 5), so no
    // halo glows through the open panel (renderOrder is inherited in UIKit).
    element('levels-root').setProperties({ renderOrder: PANEL_RENDER_ORDER });
    const onClick = (id: string, action: () => void) => {
      const target = element(id);
      const listener = () => {
        if (!this.runtime?.open || getPause(this.world).paused) return;
        markInteracted(this.world);
        action();
      };
      target.addEventListener('click', listener);
      this.cleanupFuncs.push(() => target.removeEventListener('click', listener));
      return target;
    };

    const levels = getGame(this.world)?.levels ?? [];
    const buttonIds: string[] = [];
    for (let i = 0; i < SLOTS; i++) {
      const id = `level-${i + 1}`;
      const button = onClick(id, () => this.pickLevel(i));
      const label = element(`${id}-label`);
      if (i < levels.length) {
        label.setProperties({ text: `${i + 1}  ${levels[i].title}` });
        buttonIds.push(id);
      } else {
        button.setProperties({ display: 'none' });
      }
      const slot: SlotElements = {
        button,
        label,
        stars: element(`${id}-stars`),
        icons: [1, 2, 3].map((k) => element(`${id}-star-${k}`)),
      };
      // A poke must press and release the same object to click: the label
      // and the stars line ignore pointers, so both land on the button.
      for (const inner of [slot.label, slot.stars, ...slot.icons]) inner.setProperties({ pointerEvents: 'none' });
      this.slots.push(slot);
    }
    onClick('close-levels', () => this.hide());
    onClick('sandbox-button', () => {
      const game = getGame(this.world);
      if (!game || game.sandboxLevels.length === 0) return;
      game.loadSandbox(0);
      this.hide();
    });
    element('sandbox-label').setProperties({ pointerEvents: 'none' });
    onClick('mute-button', () => setSettings(this.world, { muted: !getSettings(this.world).muted }));
    onClick('volume-down', () => this.stepVolume(-VOLUME_STEP));
    onClick('volume-up', () => this.stepVolume(VOLUME_STEP));
    onClick('quiet-button', () => setSettings(this.world, { quiet: !getSettings(this.world).quiet }));
    this.muteLabel = element('mute-label');
    this.volumeLabel = element('volume-label');
    this.quietLabel = element('quiet-label');

    this.entity = entity;
    this.runtime = {
      panel,
      entity,
      open: false,
      buttonIds,
      shownStars: buttonIds.map(() => 0),
      show: () => this.show(),
      hide: () => this.hide(),
    };
    setLevelSelect(this.world, this.runtime);
  }

  private show(): void {
    const runtime = this.runtime;
    const entity = this.entity;
    if (!runtime || !entity || runtime.open) return;
    runtime.open = true;
    entity.object3D!.visible = true;
    entity.addComponent(RayInteractable);
    entity.addComponent(PokeInteractable);
    this.needsPose = true;
    // Refresh the stars and settings on the next update.
    this.lastStarsRevision = -1;
    this.lastSettingsRevision = -1;
  }

  private hide(): void {
    const runtime = this.runtime;
    const entity = this.entity;
    if (!runtime || !entity || !runtime.open) return;
    runtime.open = false;
    entity.object3D!.visible = false;
    entity.removeComponent(RayInteractable);
    entity.removeComponent(PokeInteractable);
  }

  private pickLevel(index: number): void {
    const game = getGame(this.world);
    if (!game || index >= game.levels.length) return;
    game.loadLevel(index);
    this.hide();
  }

  private stepVolume(step: number): void {
    const v = getSettings(this.world).volume;
    // Snap to the 0.1 grid, so 0.8 - 0.1 shows 70% and not 69.99...%.
    setSettings(this.world, { volume: Math.round((v + step) * 10) / 10 });
  }

  update(): void {
    const runtime = this.runtime;
    const entity = this.entity;
    const game = getGame(this.world);
    const board = getBoard(this.world);
    if (!runtime?.open || !entity || !game || !board) return;

    if (game.starsRevision !== this.lastStarsRevision) {
      for (let i = 0; i < runtime.buttonIds.length; i++) {
        const best = game.bestStars.get(game.levels[i].id) ?? 0;
        const slot = this.slots[i];
        runtime.shownStars[i] = best;
        slot.stars.setProperties({ display: best > 0 ? 'flex' : 'none' });
        for (let k = 0; k < 3; k++) slot.icons[k].setProperties({ color: k < best ? STAR_LIT : STAR_DIM });
      }
      this.lastStarsRevision = game.starsRevision;
    }
    const settingsRevision = getSettingsRevision(this.world);
    if (settingsRevision !== this.lastSettingsRevision) {
      const s = getSettings(this.world);
      this.muteLabel?.setProperties({ text: s.muted ? 'Unmute' : 'Mute' });
      this.volumeLabel?.setProperties({ text: `${Math.round(s.volume * 100)}%` });
      this.quietLabel?.setProperties({ text: s.quiet ? 'Quiet: on' : 'Quiet: off' });
      this.lastSettingsRevision = settingsRevision;
    }

    // Viewer position: the XR head, or the desktop camera (as HudSystem).
    const immersive = this.visibilityState.peek() !== VisibilityState.NonImmersive;
    if (immersive) this.player.head.getWorldPosition(this.head);
    else this.camera.getWorldPosition(this.head);
    if (this.needsPose || board.version !== this.lastBoardVersion || this.head.distanceTo(this.placedFrom) > HEAD_MOVE_EPS) {
      const pose = levelSelectPose(board.pose, { position: [this.head.x, this.head.y, this.head.z], forward: FORWARD });
      const object = entity.object3D!;
      object.position.set(pose.position[0], pose.position[1], pose.position[2]);
      object.quaternion.set(pose.quaternion[0], pose.quaternion[1], pose.quaternion[2], pose.quaternion[3]);
      this.placedFrom.copy(this.head);
      this.lastBoardVersion = board.version;
      this.needsPose = false;
    }
  }
}
