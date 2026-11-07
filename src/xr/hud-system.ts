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
import { APP_NAME } from '../config.js';
import type { GameController, GamePhase } from '../game/controller.js';
import { hudPose } from '../game/hud-layout.js';
import type { SimOutcome } from '../sim/bodies.js';
import { getBoard, getGame, getPause, setHud } from './runtime.js';
import { detectXRSupport, enterXR, type XRSupport } from './session.js';

/** The UIKitML is authored in Horizon kit pixel units: 10 units = 1 cm. */
const HUD_UNIT_SCALE = 0.1;
/** Re-place the HUD when the head moved this far (meters). */
const HEAD_MOVE_EPS = 0.02;
const FORWARD: readonly [number, number, number] = [0, 0, -1];

const FAILURE_TEXT: Record<Exclude<SimOutcome, 'solved'>, string> = {
  collision: 'Hit a planet',
  swallowed: 'Swallowed',
  'out-of-bounds': 'Lost in space',
  timeout: 'Out of time',
};

function statusText(game: GameController): string {
  switch (game.phase) {
    case 'placing':
      return 'Drag a planet, then let go';
    case 'flying':
      return 'Watch it fly';
    case 'solved':
      return game.lastStars > 0 ? `Solved! ${game.lastStars} of 3 stars` : 'Solved!';
    case 'failed':
      return game.lastOutcome && game.lastOutcome !== 'solved' ? FAILURE_TEXT[game.lastOutcome] : 'Try again';
  }
}

interface HudElements {
  readonly level: UIKit.Text;
  readonly status: UIKit.Text;
  readonly launchLabel: UIKit.Text;
  readonly next: UIKit.Text;
  readonly xr: UIKit.Text;
  readonly xrLabel: UIKit.Text;
}

/**
 * The UIKitML HUD: title, level, status and the Launch/Replay, Next and
 * Enter AR/VR buttons. The panel entity takes hand rays, gaze, the mouse
 * (RayInteractable) and fingertip presses (PokeInteractable). It sits beyond
 * the board's far rim, turned toward the viewer (see hudPose).
 */
export class HudSystem extends createSystem({}) {
  private entity: Entity | null = null;
  private elements: HudElements | null = null;
  private support: XRSupport = { ar: false, vr: false };
  private lastPhase: GamePhase | null = null;
  private lastLevelRevision = -1;
  private lastAttempts = -1;
  private lastImmersive: boolean | null = null;
  private lastBoardVersion = -1;
  private readonly head = new Vector3();
  private readonly placedFrom = new Vector3(Infinity, Infinity, Infinity);

  init(): void {
    void detectXRSupport().then((support) => {
      this.support = support;
      this.lastImmersive = null; // refresh the Enter button
    });
    this.world.assets
      .instantiate<UIKitMLAsset>('hud-panel')
      .then((panel) => this.setup(panel))
      .catch((error: unknown) => console.error('[HUD] could not load hud-panel', error));
  }

  private setup(panel: UIKitMLAsset): void {
    const entity = this.world.createTransformEntity(panel);
    entity.object3D!.scale.setScalar(HUD_UNIT_SCALE);
    entity.addComponent(RayInteractable);
    entity.addComponent(PokeInteractable);
    panel.requireElementById<UIKit.Text>('title-text').setProperties({ text: APP_NAME });

    const element = (id: string) => panel.requireElementById<UIKit.Text>(id);
    const onClick = (id: string, action: () => void) => {
      const target = element(id);
      // Clicks are ignored while paused (XR blurred or hidden, page hidden).
      const listener = () => {
        if (!getPause(this.world).paused) action();
      };
      target.addEventListener('click', listener);
      this.cleanupFuncs.push(() => target.removeEventListener('click', listener));
      return target;
    };
    onClick('launch-button', () => getGame(this.world)?.launch());
    const next = onClick('next-button', () => getGame(this.world)?.nextLevel());
    const xr = onClick('xr-button', () => enterXR(this.world, this.support));

    this.elements = {
      level: element('level-text'),
      status: element('status-text'),
      launchLabel: element('launch-label'),
      next,
      xr,
      xrLabel: element('xr-label'),
    };
    this.entity = entity;
    setHud(this.world, { panel, entity });
  }

  update(): void {
    const game = getGame(this.world);
    const board = getBoard(this.world);
    const elements = this.elements;
    const entity = this.entity;
    if (!game || !board || !elements || !entity) return;

    if (game.levelRevision !== this.lastLevelRevision) {
      elements.level.setProperties({ text: `Level ${game.levelIndex + 1}: ${game.level.title}` });
    }
    if (game.phase !== this.lastPhase || game.levelRevision !== this.lastLevelRevision) {
      elements.status.setProperties({ text: statusText(game) });
      elements.next.setProperties({ display: game.phase === 'solved' ? 'flex' : 'none' });
    }
    if (game.attempts !== this.lastAttempts) {
      elements.launchLabel.setProperties({ text: game.attempts > 0 ? 'Replay' : 'Launch' });
    }
    const immersive = this.visibilityState.peek() !== VisibilityState.NonImmersive;
    if (immersive !== this.lastImmersive) {
      const offer = !immersive && (this.support.ar || this.support.vr);
      elements.xr.setProperties({ display: offer ? 'flex' : 'none' });
      elements.xrLabel.setProperties({ text: this.support.ar ? 'Enter AR' : 'Enter VR' });
    }
    this.lastLevelRevision = game.levelRevision;
    this.lastPhase = game.phase;
    this.lastAttempts = game.attempts;
    this.lastImmersive = immersive;

    // Viewer position: the XR head, or the desktop camera.
    if (immersive) this.player.head.getWorldPosition(this.head);
    else this.camera.getWorldPosition(this.head);
    if (board.version !== this.lastBoardVersion || this.head.distanceTo(this.placedFrom) > HEAD_MOVE_EPS) {
      const pose = hudPose(board.pose, { position: [this.head.x, this.head.y, this.head.z], forward: FORWARD });
      const object = entity.object3D!;
      object.position.set(pose.position[0], pose.position[1], pose.position[2]);
      object.quaternion.set(pose.quaternion[0], pose.quaternion[1], pose.quaternion[2], pose.quaternion[3]);
      this.placedFrom.copy(this.head);
      this.lastBoardVersion = board.version;
    }
  }
}
