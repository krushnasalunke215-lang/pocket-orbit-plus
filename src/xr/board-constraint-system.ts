import {
  createSystem,
  GrabSystem,
  Grabbed,
  Vector2,
  Vector3,
  VisibilityState,
  type Entity,
} from '@iwsdk/core';
import { PLACE_RADIUS } from '../config.js';
import { clampToDisc, intersectRayWithBoardPlane } from '../game/board-math.js';
import { isOverBoard, shouldLaunch } from '../game/launch-gate.js';
import type { Vec2 } from '../sim/vec.js';
import { BoardBody } from './components.js';
import { getBoard, getGame } from './runtime.js';

type Hand = 'left' | 'right';

/** Per-held-body drag bookkeeping (board units). */
interface DragState {
  readonly bodyId: string;
  readonly levelRevision: number;
  /** Committed placement when the grab began; the snap-back target. */
  readonly preGrab: Vec2;
  readonly height: number;
  /** Unclamped board point under the hand / cursor. */
  rawX: number;
  rawZ: number;
  /** False when the desktop cursor ray misses the board plane. */
  rawValid: boolean;
  /** Last clamped position this system wrote. */
  lastX: number;
  lastZ: number;
  previewX: number;
  previewZ: number;
  hand: Hand | null;
}

const PREVIEW_STEP = 0.002;

/**
 * Keeps held planets on the board and decides what a release does.
 *
 * Runs after GrabSystem. While a body has Grabbed, its raw board point is:
 * in XR, the built-in grab's position dropped vertically onto the board; on
 * the desktop, where the camera ray through the cursor meets the board plane
 * (so the planet sits under the cursor). The point is clamped to the disc
 * and drives the preview arc. On release the gate launches the comet only
 * if the release was over the board and the hand was tracked within the
 * last 100 ms; otherwise the planet snaps back to where it was.
 */
export class BoardConstraintSystem extends createSystem({
  held: { required: [BoardBody, Grabbed] },
}) {
  private readonly drags = new Map<number, DragState>();
  private readonly lastTracked: Record<Hand, number> = { left: -Infinity, right: -Infinity };
  private readonly ndc = new Vector2();
  private hasPointer = false;
  private readonly origin = new Vector3();
  private readonly through = new Vector3();
  private readonly originTuple: [number, number, number] = [0, 0, 0];
  private readonly throughTuple: [number, number, number] = [0, 0, 0];
  private readonly hit: [number, number] = [0, 0];
  private readonly bodyPos = [0, 0, 0];
  private grab: GrabSystem | undefined;

  init(): void {
    this.grab = this.world.getSystem(GrabSystem);
    const canvas = this.renderer.domElement;
    const onPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      this.ndc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      this.hasPointer = true;
    };
    canvas.addEventListener('pointermove', onPointer);
    canvas.addEventListener('pointerdown', onPointer);
    this.cleanupFuncs.push(
      () => canvas.removeEventListener('pointermove', onPointer),
      () => canvas.removeEventListener('pointerdown', onPointer),
      this.queries.held.subscribe('qualify', (entity) => this.onGrab(entity)),
      this.queries.held.subscribe('disqualify', (entity) => this.onRelease(entity)),
    );
  }

  update(): void {
    const game = getGame(this.world);
    if (!game) return;
    const immersive = this.visibilityState.peek() !== VisibilityState.NonImmersive;
    for (const entity of this.queries.held.entities) {
      const drag = this.drags.get(entity.index);
      const object = entity.object3D;
      if (!drag || !object) continue;

      if (immersive) {
        // The grab handle writes a new position only when the pointer moved;
        // anything else is our own clamped write from the previous frame.
        if (object.position.x !== drag.lastX || object.position.z !== drag.lastZ) {
          drag.rawX = object.position.x;
          drag.rawZ = object.position.z;
          drag.rawValid = true;
        }
        this.recordTracking(entity, drag);
      } else {
        this.updateDesktopRaw(drag);
      }

      let x = drag.rawX;
      let z = drag.rawZ;
      const len = Math.hypot(x, z);
      if (len > PLACE_RADIUS) {
        x *= PLACE_RADIUS / len;
        z *= PLACE_RADIUS / len;
      }
      object.position.set(x, drag.height, z);
      drag.lastX = x;
      drag.lastZ = z;
      if (Math.hypot(x - drag.previewX, z - drag.previewZ) > PREVIEW_STEP) {
        drag.previewX = x;
        drag.previewZ = z;
        game.setDraft(drag.bodyId, [x, z]);
      }
    }
  }

  private onGrab(entity: Entity): void {
    const game = getGame(this.world);
    const object = entity.object3D;
    if (!game || !object) return;
    const bodyId = entity.getValue(BoardBody, 'bodyId') as string;
    const committed = game.placements[bodyId];
    if (!committed) return;
    if (game.phase !== 'placing') game.cancelFlight();
    // The grab may already have moved the object this frame (GrabSystem
    // updates its handle before tagging Grabbed), so take the height from
    // the game, not from the object.
    game.bodyBoardPosition(bodyId, this.bodyPos);
    this.drags.set(entity.index, {
      bodyId,
      levelRevision: game.levelRevision,
      preGrab: committed,
      height: this.bodyPos[1],
      rawX: committed[0],
      rawZ: committed[1],
      rawValid: true,
      lastX: Number.NaN,
      lastZ: Number.NaN,
      previewX: committed[0],
      previewZ: committed[1],
      hand: null,
    });
  }

  private onRelease(entity: Entity): void {
    const drag = this.drags.get(entity.index);
    this.drags.delete(entity.index);
    const game = getGame(this.world);
    if (!drag || !game || drag.levelRevision !== game.levelRevision) return;

    const immersive = this.visibilityState.peek() !== VisibilityState.NonImmersive;
    if (!immersive) this.updateDesktopRaw(drag);
    const overBoard = drag.rawValid && isOverBoard([drag.rawX, 0, drag.rawZ]);
    // Check the release frame itself too, so one slow frame (> 100 ms) with
    // the hand still tracked does not count as lost tracking.
    if (immersive) this.recordTracking(entity, drag);
    // The mouse has no tracking concept (null); a hand must be fresh.
    const msSinceTracked = immersive && drag.hand ? performance.now() - this.lastTracked[drag.hand] : null;

    if (shouldLaunch({ overBoard, msSinceTracked })) {
      game.setPlacement(drag.bodyId, clampToDisc([drag.rawX, drag.rawZ]));
      game.launch();
    } else {
      game.clearDraft();
      entity.object3D?.position.set(drag.preGrab[0], drag.height, drag.preGrab[1]);
    }
  }

  /** Remembers when the holding hand's target ray was last tracked. */
  private recordTracking(entity: Entity, drag: DragState): void {
    const hand = this.grab?.getHolderHand(entity) ?? null;
    if (hand) drag.hand = hand;
    const frame = this.world.xrFrame;
    const space = this.world.xrReferenceSpace;
    if (!drag.hand || !frame || !space) return;
    const source = this.input.xr.getPrimaryInputSource(drag.hand);
    if (source && frame.getPose(source.targetRaySpace, space)) {
      this.lastTracked[drag.hand] = performance.now();
    }
  }

  /** Desktop: where the camera ray through the cursor meets the board plane. */
  private updateDesktopRaw(drag: DragState): void {
    const board = getBoard(this.world);
    if (!board || !this.hasPointer) return;
    const root = board.entity.object3D!;
    root.updateWorldMatrix(true, false);
    this.camera.getWorldPosition(this.origin);
    this.through.set(this.ndc.x, this.ndc.y, 0.5).unproject(this.camera);
    root.worldToLocal(this.origin);
    root.worldToLocal(this.through);
    this.originTuple[0] = this.origin.x;
    this.originTuple[1] = this.origin.y;
    this.originTuple[2] = this.origin.z;
    this.throughTuple[0] = this.through.x;
    this.throughTuple[1] = this.through.y;
    this.throughTuple[2] = this.through.z;
    const hit = intersectRayWithBoardPlane(this.originTuple, this.throughTuple, drag.height, this.hit);
    if (hit) {
      drag.rawX = hit[0];
      drag.rawZ = hit[1];
      drag.rawValid = true;
    } else {
      drag.rawValid = false;
    }
  }
}
