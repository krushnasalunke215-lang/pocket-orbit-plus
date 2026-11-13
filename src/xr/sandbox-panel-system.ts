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
import { createMutablePose, sandboxPanelPoseInto } from '../game/hud-layout.js';
import { handOfPointerEvent, isConfirmPinchClick, type PointerIdEvent } from './pointer-hand.js';
import {
  getBoard,
  getGame,
  getPause,
  getSandbox,
  markInteracted,
  setSandboxPanel,
  type SandboxPanelRuntime,
} from './runtime.js';

/** Authored in Horizon kit pixel units like the HUD: 10 units = 1 cm. */
const UNIT_SCALE = 0.1;
/** Re-place the panel when the head moved this far (meters), as the HUD. */
const HEAD_MOVE_EPS = 0.02;
/** Above the board's additive sprites, like the level select. */
const PANEL_RENDER_ORDER = 10;

/** Button ids and the label inside each (labels ignore pointers so a poke clicks). */
const BUTTONS = ['make-well', 'add-puck', 'height-down', 'height-up', 'clear-wells', 'next-target', 'exit-sandbox'] as const;

/**
 * The Your Table panel: Make well (arms the hit-test pinch for the hand
 * that pressed it, by ray or fingertip), Add puck,
 * height - / + with the selected well's height, Clear wells, Next target and
 * Back to the levels (the story level the sandbox was entered from), plus
 * the target title and a status line. Shown only in sandbox mode, beside
 * the HUD (sandboxPanelPose); while hidden it has no interactable
 * components. Clicks are ignored while paused, and so is the ray click of
 * a pinch that just placed a well (isConfirmPinchClick). The re-pose
 * writes into preallocated tuples (no allocation per frame).
 */
export class SandboxPanelSystem extends createSystem({}) {
  private entity: Entity | null = null;
  private runtime: SandboxPanelRuntime | null = null;
  private title: UIKit.Text | null = null;
  private status: UIKit.Text | null = null;
  private height: UIKit.Text | null = null;
  private lastRevision = -1;
  private lastLevelRevision = -1;
  private lastBoardVersion = -1;
  private readonly head = new Vector3();
  private readonly headTuple: [number, number, number] = [0, 0, 0];
  private readonly pose = createMutablePose();
  private readonly placedFrom = new Vector3(Infinity, Infinity, Infinity);

  init(): void {
    this.world.assets
      .instantiate<UIKitMLAsset>('sandbox-panel')
      .then((panel) => this.setup(panel))
      .catch((error: unknown) => console.error('[Sandbox] could not load sandbox-panel', error));
  }

  private setup(panel: UIKitMLAsset): void {
    const entity = this.world.createTransformEntity(panel);
    entity.object3D!.scale.setScalar(UNIT_SCALE);
    entity.object3D!.visible = false;
    const element = (id: string) => panel.requireElementById<UIKit.Text>(id);
    element('sandbox-root').setProperties({ renderOrder: PANEL_RENDER_ORDER });
    const actions: Record<(typeof BUTTONS)[number], (event: PointerIdEvent) => void> = {
      // The hand whose ray or fingertip pressed the button (else the last pinching hand).
      'make-well': (event) => getSandbox(this.world)?.arm(handOfPointerEvent(this.world, event) ?? undefined),
      'add-puck': () => getSandbox(this.world)?.addPuck(),
      'height-down': () => getSandbox(this.world)?.stepHeight(-1),
      'height-up': () => getSandbox(this.world)?.stepHeight(1),
      'clear-wells': () => getSandbox(this.world)?.clear(),
      'next-target': () => getGame(this.world)?.nextLevel(),
      'exit-sandbox': () => {
        getSandbox(this.world)?.disarm();
        getGame(this.world)?.exitSandbox();
      },
    };
    for (const id of BUTTONS) {
      const target = element(id);
      element(`${id}-label`).setProperties({ pointerEvents: 'none' });
      const listener = (event: PointerIdEvent) => {
        if (!this.runtime?.shown || getPause(this.world).paused || isConfirmPinchClick(this.world, event)) return;
        markInteracted(this.world);
        actions[id](event);
      };
      target.addEventListener('click', listener);
      this.cleanupFuncs.push(() => target.removeEventListener('click', listener));
    }
    this.title = element('sandbox-title');
    this.status = element('sandbox-status');
    this.height = element('height-label');
    this.entity = entity;
    this.runtime = { panel, entity, shown: false };
    setSandboxPanel(this.world, this.runtime);
  }

  update(): void {
    const runtime = this.runtime;
    const entity = this.entity;
    const game = getGame(this.world);
    const board = getBoard(this.world);
    const sandbox = getSandbox(this.world);
    if (!runtime || !entity || !game || !board || !sandbox) return;

    const show = game.mode === 'sandbox';
    if (show !== runtime.shown) {
      runtime.shown = show;
      entity.object3D!.visible = show;
      if (show) {
        entity.addComponent(RayInteractable);
        entity.addComponent(PokeInteractable);
        this.lastBoardVersion = -1;
      } else {
        entity.removeComponent(RayInteractable);
        entity.removeComponent(PokeInteractable);
      }
    }
    if (!show) return;

    if (game.levelRevision !== this.lastLevelRevision) {
      this.title?.setProperties({ text: game.level.title });
      this.lastLevelRevision = game.levelRevision;
    }
    if (sandbox.revision !== this.lastRevision) {
      this.status?.setProperties({ text: sandbox.status });
      const selected = sandbox.wells.find((w) => w.id === sandbox.selectedId);
      this.height?.setProperties({ text: selected ? `Height ${(selected.heightM * 100).toFixed(1)} cm` : 'Height -' });
      this.lastRevision = sandbox.revision;
    }

    const immersive = this.visibilityState.peek() !== VisibilityState.NonImmersive;
    if (immersive) this.player.head.getWorldPosition(this.head);
    else this.camera.getWorldPosition(this.head);
    if (board.version !== this.lastBoardVersion || this.head.distanceTo(this.placedFrom) > HEAD_MOVE_EPS) {
      this.headTuple[0] = this.head.x;
      this.headTuple[1] = this.head.y;
      this.headTuple[2] = this.head.z;
      const pose = sandboxPanelPoseInto(board.pose, this.headTuple, this.pose);
      const object = entity.object3D!;
      object.position.set(pose.position[0], pose.position[1], pose.position[2]);
      object.quaternion.set(pose.quaternion[0], pose.quaternion[1], pose.quaternion[2], pose.quaternion[3]);
      this.placedFrom.copy(this.head);
      this.lastBoardVersion = board.version;
    }
  }
}
