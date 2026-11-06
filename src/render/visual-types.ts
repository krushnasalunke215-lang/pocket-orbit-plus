import type { Mesh, Object3D } from '@iwsdk/core';

/*
 * Render interfaces shared by the systems. Everything is in board-normalized
 * units (parented under the scaled board root) except the starfield, which
 * lives in world meters. Implementations may change; these signatures stay.
 */

/** Writable or readable xyz, e.g. a tuple or a typed array. */
export type XYZLike = { readonly [index: number]: number };

export type InteractionState = 'idle' | 'hover' | 'held';

export interface BodyVisual {
  readonly root: Object3D;
  /** Invisible, oversized grab target of a movable body. */
  readonly collider?: Mesh;
  setState(state: InteractionState): void;
  update(t: number): void;
  /** Frees per-instance GPU resources (shared ones stay). */
  dispose(): void;
}

export interface CometVisual {
  readonly root: Object3D;
  setVisible(visible: boolean): void;
  setPosition(board: XYZLike): void;
  update(dt: number, t: number): void;
}

export interface TrailVisual {
  readonly root: Object3D;
  /** Shows the first `count` xyz samples as the preview arc; 0 hides it. */
  showPreview(samples: Float32Array, count: number): void;
  beginFlight(): void;
  pushPoint(p: XYZLike): void;
  /** Starts a new line within the flight (a teleport jump): the next point does not connect. */
  breakLine(): void;
  endFlight(): void;
  clear(): void;
}

export interface TargetVisual {
  readonly root: Object3D;
  setSolved(solved: boolean): void;
  update(t: number): void;
}

export interface BoardVisual {
  readonly root: Object3D;
  update(t: number): void;
}

export interface Starfield {
  readonly root: Object3D;
}
