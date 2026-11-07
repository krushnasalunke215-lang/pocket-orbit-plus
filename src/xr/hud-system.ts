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
import {
  getBoard,
  getChapter,
  getGame,
  getLevelSelect,
  getPause,
  markInteracted,
  setHud,
  type ChapterRuntime,
  type HudRuntime,
} from './runtime.js';
import { detectXRSupport, enterXR, type XRSupport } from './session.js';

/** The UIKitML is authored in Horizon kit pixel units: 10 units = 1 cm. */
const HUD_UNIT_SCALE = 0.1;
/** Re-place the HUD when the head moved this far (meters). */
const HEAD_MOVE_EPS = 0.02;
const FORWARD: readonly [number, number, number] = [0, 0, -1];

const FAILURE_TEXT: Record<Exclude<SimOutcome, 'solved'>, string> = {
  collision: 'Hit a planet',
  swallowed: 'Swallowed by the black hole',
  'out-of-bounds': 'Lost in space',
  timeout: 'Out of time',
};

function statusText(game: GameController, chapter: ChapterRuntime | undefined): string {
  if (chapter?.shown) return `Chapter ${chapter.chapter} complete: ${chapter.stars} of ${chapter.maxStars} stars`;
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
  readonly launch: UIKit.Text;
  readonly launchLabel: UIKit.Text;
  readonly next: UIKit.Text;
  readonly playAgain: UIKit.Text;
  readonly xr: UIKit.Text;
  readonly xrLabel: UIKit.Text;
}

/** True when the current level is its chapter's last (Next would wrap or change chapter). */
function isChapterEnd(game: GameController): boolean {
  const following = game.levels[game.levelIndex + 1];
  return !following || following.chapter !== game.level.chapter;
}

/**
 * The UIKitML HUD: title, level, status and the Levels, Launch/Replay, Next,
 * Play again and Enter AR/VR buttons. The panel entity takes hand rays,
 * gaze, the mouse (RayInteractable) and fingertip presses
 * (PokeInteractable). It sits beyond the board's far rim, turned toward the
 * viewer (see hudPose). Next on a chapter's last level opens the
 * chapter-complete moment instead of wrapping; during it, Play again (the
 * chapter's first level) replaces Launch and Next. Every click counts as
 * the first interaction (it ends the attract loop).
 */
export class HudSystem extends createSystem({}) {
  private entity: Entity | null = null;
  private elements: HudElements | null = null;
  private runtime: HudRuntime | null = null;
  private support: XRSupport = { ar: false, vr: false };
  private lastPhase: GamePhase | null = null;
  private lastLevelRevision = -1;
  private lastAttempts = -1;
  private lastChapterRevision = -1;
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
        if (getPause(this.world).paused) return;
        markInteracted(this.world);
        action();
      };
      target.addEventListener('click', listener);
      this.cleanupFuncs.push(() => target.removeEventListener('click', listener));
      return target;
    };
    const launch = onClick('launch-button', () => getGame(this.world)?.launch());
    const next = onClick('next-button', () => this.onNext());
    const playAgain = onClick('play-again-button', () => this.onPlayAgain());
    onClick('levels-button', () => {
      const levels = getLevelSelect(this.world);
      if (levels?.open) levels.hide();
      else levels?.show();
    });
    const xr = onClick('xr-button', () => enterXR(this.world, this.support));

    this.elements = {
      level: element('level-text'),
      status: element('status-text'),
      launch,
      launchLabel: element('launch-label'),
      next,
      playAgain,
      xr,
      xrLabel: element('xr-label'),
    };
    this.entity = entity;
    this.runtime = { panel, entity, status: '' };
    setHud(this.world, this.runtime);
  }

  /** Next level, or the chapter-complete moment on a chapter's last level. */
  private onNext(): void {
    const game = getGame(this.world);
    if (!game) return;
    const chapter = getChapter(this.world);
    if (chapter && isChapterEnd(game)) chapter.show(game.level.chapter);
    else game.nextLevel();
  }

  /** Back to the first level of the completed chapter. */
  private onPlayAgain(): void {
    const game = getGame(this.world);
    const moment = getChapter(this.world);
    const chapter = moment?.chapter ?? game?.level.chapter;
    if (!game) return;
    moment?.hide();
    const first = game.levels.findIndex((l) => l.chapter === chapter);
    game.loadLevel(Math.max(0, first));
  }

  update(): void {
    const game = getGame(this.world);
    const board = getBoard(this.world);
    const elements = this.elements;
    const entity = this.entity;
    if (!game || !board || !elements || !entity) return;

    const chapter = getChapter(this.world);
    const chapterRevision = chapter?.revision ?? 0;
    if (game.levelRevision !== this.lastLevelRevision) {
      elements.level.setProperties({ text: `Level ${game.levelIndex + 1}: ${game.level.title}` });
    }
    if (
      game.phase !== this.lastPhase ||
      game.levelRevision !== this.lastLevelRevision ||
      chapterRevision !== this.lastChapterRevision
    ) {
      const celebrating = Boolean(chapter?.shown);
      const status = statusText(game, chapter);
      elements.status.setProperties({ text: status });
      if (this.runtime) this.runtime.status = status;
      // The chapter status wraps to two lines; it takes the level line's place,
      // so the panel stays within HUD_SIZE.
      elements.level.setProperties({ display: celebrating ? 'none' : 'flex' });
      elements.next.setProperties({ display: game.phase === 'solved' && !celebrating ? 'flex' : 'none' });
      elements.launch.setProperties({ display: celebrating ? 'none' : 'flex' });
      elements.playAgain.setProperties({ display: celebrating ? 'flex' : 'none' });
      this.lastChapterRevision = chapterRevision;
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
