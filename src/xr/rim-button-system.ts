import {
  createSystem,
  Grabbed,
  PokeInteractable,
  RayInteractable,
  Vector3,
  VisibilityState,
  type Entity,
  type UIKit,
  type UIKitMLAsset,
} from '@iwsdk/core';
import { rimButtonPose } from '../game/hud-layout.js';
import { BoardBody } from './components.js';
import {
  getBoard,
  getChapter,
  getGame,
  getLevelSelect,
  getPause,
  markInteracted,
  setRimButton,
  type RimButtonRuntime,
} from './runtime.js';

/** Authored in Horizon kit pixel units like the HUD: 10 units = 1 cm. */
const UNIT_SCALE = 0.1;
/**
 * Re-place the button when the head moved this far (meters) since it was
 * last placed. Much larger than the HUD's 2 cm: the button's distance clamp
 * depends on the head position, and looking down at it (the head pivots
 * about 10 cm) or leaning in to press it must not move it out from under
 * the fingertip. Standing up or changing seats still re-places it.
 */
const HEAD_MOVE_EPS = 0.25;
const FORWARD: readonly [number, number, number] = [0, 0, -1];

/**
 * The near-rim Launch/Replay button: a small UIKitML panel beside the
 * board's near rim on the player's left (see rimButtonPose), reachable by a
 * fingertip (PokeInteractable) and by hand rays, gaze and the mouse
 * (RayInteractable). A click launches unless a planet or the board handle is
 * held, so a poke with one hand never fires a flight mid-drag with the
 * other, or while the game is paused, or while the level select is open
 * (at the table pose it sits a few centimeters in front of this button).
 * During the chapter-complete moment it is hidden and takes no input, like
 * the HUD's Launch/Replay (the moment offers only Levels and Play again).
 * The HUD keeps its own Launch/Replay button.
 */
export class RimButtonSystem extends createSystem({
  heldBodies: { required: [BoardBody, Grabbed] },
}) {
  private entity: Entity | null = null;
  private label: UIKit.Text | null = null;
  private runtime: RimButtonRuntime | null = null;
  private lastAttempts = -1;
  private lastBoardVersion = -1;
  private readonly head = new Vector3();
  private readonly placedFrom = new Vector3(Infinity, Infinity, Infinity);

  init(): void {
    this.world.assets
      .instantiate<UIKitMLAsset>('rim-button')
      .then((panel) => this.setup(panel))
      .catch((error: unknown) => console.error('[RimButton] could not load rim-button', error));
  }

  private setup(panel: UIKitMLAsset): void {
    const entity = this.world.createTransformEntity(panel);
    entity.object3D!.scale.setScalar(UNIT_SCALE);
    entity.addComponent(RayInteractable);
    entity.addComponent(PokeInteractable);

    const button = panel.requireElementById<UIKit.Text>('rim-launch-button');
    const listener = () => this.onClick();
    button.addEventListener('click', listener);
    this.cleanupFuncs.push(() => button.removeEventListener('click', listener));

    this.label = panel.requireElementById<UIKit.Text>('rim-launch-label');
    this.entity = entity;
    this.runtime = { panel, entity, label: 'Launch', shown: true };
    setRimButton(this.world, this.runtime);
  }

  /** Shows the button with its input components, or hides it with none (as LevelSelectSystem). */
  private setShown(entity: Entity, runtime: RimButtonRuntime, shown: boolean): void {
    runtime.shown = shown;
    entity.object3D!.visible = shown;
    if (shown) {
      entity.addComponent(RayInteractable);
      entity.addComponent(PokeInteractable);
    } else {
      entity.removeComponent(RayInteractable);
      entity.removeComponent(PokeInteractable);
    }
  }

  private onClick(): void {
    const game = getGame(this.world);
    if (!game || getPause(this.world).paused || !this.runtime?.shown) return;
    // The open level select sits just in front of this button; a poke through it must not launch.
    if (getLevelSelect(this.world)?.open) return;
    markInteracted(this.world);
    if (this.queries.heldBodies.entities.size > 0) return;
    if (getBoard(this.world)?.handleEntity.hasComponent(Grabbed)) return;
    game.launch();
  }

  update(): void {
    const game = getGame(this.world);
    const board = getBoard(this.world);
    const entity = this.entity;
    const label = this.label;
    const runtime = this.runtime;
    if (!game || !board || !entity || !label || !runtime) return;

    // No launch under the chapter-complete moment (it ends on any level load).
    const show = !getChapter(this.world)?.shown;
    if (show !== runtime.shown) this.setShown(entity, runtime, show);

    if (game.attempts !== this.lastAttempts) {
      runtime.label = game.attempts > 0 ? 'Replay' : 'Launch';
      label.setProperties({ text: runtime.label });
      this.lastAttempts = game.attempts;
    }

    // Viewer position: the XR head, or the desktop camera (as HudSystem).
    const immersive = this.visibilityState.peek() !== VisibilityState.NonImmersive;
    if (immersive) this.player.head.getWorldPosition(this.head);
    else this.camera.getWorldPosition(this.head);
    if (board.version !== this.lastBoardVersion || this.head.distanceTo(this.placedFrom) > HEAD_MOVE_EPS) {
      const pose = rimButtonPose(board.pose, { position: [this.head.x, this.head.y, this.head.z], forward: FORWARD });
      const object = entity.object3D!;
      object.position.set(pose.position[0], pose.position[1], pose.position[2]);
      object.quaternion.set(pose.quaternion[0], pose.quaternion[1], pose.quaternion[2], pose.quaternion[3]);
      this.placedFrom.copy(this.head);
      this.lastBoardVersion = board.version;
    }
  }
}
