import { createSystem, Vector3, VisibilityState, type Entity, type UIKit, type UIKitMLAsset } from '@iwsdk/core';
import { FrameStats } from '../game/frame-stats.js';
import { createMutablePose, debugOverlayPoseInto } from '../game/hud-layout.js';
import { jitterMm } from '../game/real-object.js';
import { getBoard, getGame, getHitLog, getRenderStats, getSandbox, HIT_LOG_SIZE } from './runtime.js';

/** Authored in Horizon kit pixel units like the HUD: 10 units = 1 cm. */
const UNIT_SCALE = 0.1;
/** Re-place the panel when the head moved this far (meters), as the HUD. */
const HEAD_MOVE_EPS = 0.02;
/** Above the board's additive sprites, like the other panels. */
const PANEL_RENDER_ORDER = 10;
/** Text refresh period (ms): 2 Hz. */
const TEXT_PERIOD_MS = 500;
/** Console JSON line period (ms). */
const LOG_PERIOD_MS = 5000;
/** A gap longer than this is a pause (hidden page, no frames), not a frame. */
const MAX_FRAME_MS = 1000;
const DOM_ID = 'debug-overlay';

/** True when the page URL asks for the tester overlay (?debug=1). */
export function debugOverlayRequested(search: string): boolean {
  return new URLSearchParams(search).get('debug') === '1';
}

/**
 * The ?debug=1 tester overlay (registered only with that URL parameter, in
 * production builds too; it never touches window.__game). Shows the rolling
 * average fps and the 1% low (FrameStats over performance.now() deltas), the
 * draw calls and triangles of the last frame (RenderStats), and in Your Table
 * while well placement is armed the reticle hit's height above the board and
 * its jitter over the last HIT_LOG_SIZE hits (HitLog). In XR the lines show
 * on a small UIKitML panel left of the HUD (no input components); on desktop
 * in a fixed DOM div #debug-overlay. Every 5 s it logs one JSON line
 * { fps, low1, calls, triangles, hitHeightCm, jitterMm } with console.info.
 *
 * Allocation: update() allocates nothing per frame. The text lines, the
 * 1% low sort (in a preallocated scratch array) and the JSON line are built
 * only at 2 Hz and every 5 s; the re-pose writes into preallocated tuples.
 */
export class DebugOverlaySystem extends createSystem({}) {
  private readonly stats = new FrameStats();
  private readonly head = new Vector3();
  private readonly headTuple: [number, number, number] = [0, 0, 0];
  private readonly pose = createMutablePose();
  private readonly placedFrom = new Vector3(Infinity, Infinity, Infinity);
  private entity: Entity | null = null;
  private fpsText: UIKit.Text | null = null;
  private renderText: UIKit.Text | null = null;
  private hitText: UIKit.Text | null = null;
  private dom: HTMLDivElement | null = null;
  private lastNow = -1;
  private nextTextAt = 0;
  private nextLogAt = 0;
  private lastBoardVersion = -1;
  private lastImmersive: boolean | null = null;
  // Latest values, refreshed at 2 Hz (the JSON line reuses them).
  private fps = 0;
  private low1 = 0;
  private hitHeightCm: number | null = null;
  private hitJitterMm: number | null = null;

  init(): void {
    const dom = document.createElement('div');
    dom.id = DOM_ID;
    dom.setAttribute('aria-live', 'off');
    Object.assign(dom.style, {
      position: 'fixed',
      left: '8px',
      bottom: '8px',
      zIndex: '10',
      padding: '6px 8px',
      background: 'rgba(10, 14, 22, 0.78)',
      color: '#fafaf7',
      font: '12px/1.35 ui-monospace, Consolas, monospace',
      whiteSpace: 'pre',
      pointerEvents: 'none',
      borderRadius: '4px',
    });
    dom.textContent = 'fps -';
    // The first text once frames are in; the first JSON line after 5 s.
    this.nextTextAt = performance.now() + TEXT_PERIOD_MS;
    this.nextLogAt = performance.now() + LOG_PERIOD_MS;
    document.body.appendChild(dom);
    this.dom = dom;
    this.cleanupFuncs.push(() => dom.remove());

    this.world.assets
      .instantiate<UIKitMLAsset>('debug-overlay')
      .then((panel) => this.setup(panel))
      .catch((error: unknown) => console.error('[Debug] could not load debug-overlay', error));
  }

  private setup(panel: UIKitMLAsset): void {
    panel.name = 'debug-overlay';
    const entity = this.world.createTransformEntity(panel);
    entity.object3D!.scale.setScalar(UNIT_SCALE);
    entity.object3D!.visible = false;
    const element = (id: string) => panel.requireElementById<UIKit.Text>(id);
    element('debug-root').setProperties({ renderOrder: PANEL_RENDER_ORDER, pointerEvents: 'none' });
    this.fpsText = element('fps-text');
    this.renderText = element('render-text');
    this.hitText = element('hit-text');
    this.entity = entity;
    this.lastBoardVersion = -1;
    this.lastImmersive = null;
  }

  update(): void {
    const now = performance.now();
    if (this.lastNow >= 0) {
      const ms = now - this.lastNow;
      if (ms <= MAX_FRAME_MS) this.stats.push(ms);
    }
    this.lastNow = now;

    const immersive = this.visibilityState.peek() !== VisibilityState.NonImmersive;
    if (immersive !== this.lastImmersive) {
      if (this.entity) this.entity.object3D!.visible = immersive;
      if (this.dom) this.dom.style.display = immersive ? 'none' : 'block';
      this.lastImmersive = immersive;
      this.lastBoardVersion = -1;
    }
    if (now >= this.nextTextAt) {
      this.nextTextAt = now + TEXT_PERIOD_MS;
      this.refreshText(immersive);
    }
    if (now >= this.nextLogAt) {
      this.nextLogAt = now + LOG_PERIOD_MS;
      this.logLine();
    }
    if (immersive) this.placePanel();
  }

  /** 2 Hz: recompute the numbers and write the text (string allocation happens here only). */
  private refreshText(immersive: boolean): void {
    this.fps = this.stats.averageFps();
    this.low1 = this.stats.onePercentLowFps();
    const render = getRenderStats(this.world)?.last;
    const calls = render?.calls ?? 0;
    const triangles = render?.triangles ?? 0;

    const game = getGame(this.world);
    const sandbox = getSandbox(this.world);
    const inSandbox = game?.mode === 'sandbox';
    const log = getHitLog(this.world);
    const hit = inSandbox && sandbox?.armed === true && sandbox.reticle.hit !== 'miss' && log.count > 0;
    if (hit) {
      this.hitHeightCm = log.heights[(log.next + HIT_LOG_SIZE - 1) % HIT_LOG_SIZE]! * 100;
      this.hitJitterMm = jitterMm(log.positions, log.count);
    } else {
      this.hitHeightCm = null;
      this.hitJitterMm = null;
    }

    const fpsLine = `fps ${this.fps.toFixed(1)} avg | 1% low ${this.low1.toFixed(1)}`;
    const renderLine = `calls ${calls} | tris ${Math.round(triangles / 1000)}k`;
    const hitLine =
      this.hitHeightCm !== null && this.hitJitterMm !== null
        ? `hit ${this.hitHeightCm.toFixed(1)} cm above board | jitter ${this.hitJitterMm.toFixed(1)} mm (${log.count} frames)`
        : 'hit: none';

    if (immersive) {
      this.fpsText?.setProperties({ text: fpsLine });
      this.renderText?.setProperties({ text: renderLine });
      this.hitText?.setProperties({ text: hitLine, display: inSandbox ? 'flex' : 'none' });
    } else if (this.dom) {
      this.dom.textContent = inSandbox ? `${fpsLine}\n${renderLine}\n${hitLine}` : `${fpsLine}\n${renderLine}`;
    }
  }

  /** Every 5 s: one JSON line testers can paste into a report. */
  private logLine(): void {
    const render = getRenderStats(this.world)?.last;
    const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
    console.info(
      JSON.stringify({
        fps: round1(this.fps),
        low1: round1(this.low1),
        calls: render?.calls ?? 0,
        triangles: render?.triangles ?? 0,
        hitHeightCm: round1(this.hitHeightCm),
        jitterMm: round1(this.hitJitterMm),
      }),
    );
  }

  /** Beside the HUD; re-posed when the board moves or the head moves 2 cm. */
  private placePanel(): void {
    const entity = this.entity;
    const board = getBoard(this.world);
    if (!entity || !board) return;
    this.player.head.getWorldPosition(this.head);
    if (board.version === this.lastBoardVersion && this.head.distanceTo(this.placedFrom) <= HEAD_MOVE_EPS) return;
    this.headTuple[0] = this.head.x;
    this.headTuple[1] = this.head.y;
    this.headTuple[2] = this.head.z;
    const pose = debugOverlayPoseInto(board.pose, this.headTuple, this.pose);
    const object = entity.object3D!;
    object.position.set(pose.position[0], pose.position[1], pose.position[2]);
    object.quaternion.set(pose.quaternion[0], pose.quaternion[1], pose.quaternion[2], pose.quaternion[3]);
    this.placedFrom.copy(this.head);
    this.lastBoardVersion = board.version;
  }
}
