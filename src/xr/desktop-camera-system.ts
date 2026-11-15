import { createSystem, Grabbed, Hovered, VisibilityState } from '@iwsdk/core';
import { DESKTOP_VIEW } from '../config.js';
import { BoardBody } from './components.js';
import { getLevelSelect, getSettings } from './runtime.js';

/** Seconds of one drift loop, and its reach (meters) across, up and toward the board. */
const PERIOD = 24;
const REACH = [0.015, 0.005, 0.008] as const;
/** The camera holds still this long after the last pointer input (ms), so mouse play never chases it. */
const IDLE_MS = 3000;

/**
 * The desktop (non-immersive) camera: the seated three-quarter view of
 * DESKTOP_VIEW, drifting slowly around it (about 1.5 cm on a 24 s loop) and
 * re-aimed at the same point every frame, so the board, the HUD and the
 * surrounding cosmos shift against each other and the 2D view reads as 3D.
 * It holds still (keeps its current pose, no jump) while a body is hovered
 * or held, within 3 s of any pointer input on the canvas, while the level
 * select is open, and with reduced motion. No allocation per frame.
 */
export class DesktopCameraSystem extends createSystem({
  hovered: { required: [BoardBody, Hovered] },
  grabbed: { required: [BoardBody, Grabbed] },
}) {
  private clock = 0;
  private lastPointer = -Infinity;
  private wasDesktop = false;

  init(): void {
    const canvas = this.renderer.domElement;
    const onPointer = () => {
      this.lastPointer = performance.now();
    };
    canvas.addEventListener('pointermove', onPointer);
    canvas.addEventListener('pointerdown', onPointer);
    this.cleanupFuncs.push(
      () => canvas.removeEventListener('pointermove', onPointer),
      () => canvas.removeEventListener('pointerdown', onPointer),
    );
  }

  update(delta: number): void {
    const desktop = this.visibilityState.peek() === VisibilityState.NonImmersive;
    if (!desktop) {
      this.wasDesktop = false;
      return;
    }
    // Back on the desktop (BoardPlacementSystem just reset the camera): start from the base pose.
    if (!this.wasDesktop) this.clock = 0;
    this.wasDesktop = true;

    const still =
      getSettings(this.world).reducedMotion ||
      (getLevelSelect(this.world)?.open ?? false) ||
      this.queries.hovered.entities.size > 0 ||
      this.queries.grabbed.entities.size > 0 ||
      performance.now() - this.lastPointer < IDLE_MS;
    if (!still) this.clock += delta;

    const a = (this.clock / PERIOD) * Math.PI * 2;
    const [px, py, pz] = DESKTOP_VIEW.viewPosition;
    const [lx, ly, lz] = DESKTOP_VIEW.viewLookAt;
    this.camera.position.set(px + REACH[0] * Math.sin(a), py + REACH[1] * Math.sin(2 * a), pz + REACH[2] * Math.sin(a));
    this.camera.lookAt(lx, ly, lz);
  }
}
