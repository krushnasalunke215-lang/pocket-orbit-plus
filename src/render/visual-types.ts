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
  /** Head, tail and halo opacity 0..1 (uniforms only); at 0 the next move emits no tail. */
  setOpacity(alpha: number): void;
  update(dt: number, t: number): void;
}

export interface TrailVisual {
  readonly root: Object3D;
  /**
   * Shows the first `count` xyz samples as the preview arc; 0 hides it. No
   * segment is drawn across any of the first `breakCount` entries of
   * `breaks` (teleport jumps, see PreviewPath.breaks).
   */
  showPreview(samples: Float32Array, count: number, breaks?: Int32Array, breakCount?: number): void;
  beginFlight(): void;
  pushPoint(p: XYZLike): void;
  /** Starts a new line within the flight (a teleport jump): the next point does not connect. */
  breakLine(): void;
  endFlight(): void;
  clear(): void;
  /** Reduced motion: flight trails stop fading with age (they still dim per newer flight). */
  setStatic(on: boolean): void;
}

/** The onboarding ghost hand and its translucent planet copy (board units). */
export interface GhostHandVisual {
  readonly root: Object3D;
  setVisible(visible: boolean): void;
  /** Left-handed mode: a mirrored left hand that reaches in from the player's left. */
  setLeftHanded(left: boolean): void;
  /**
   * Poses the hand `t` seconds into its loop: it pinches a planet copy at
   * board point `from` ([x, z]), carries it to `to` and lets go.
   */
  update(t: number, from: XYZLike, to: XYZLike): void;
}

/**
 * A Your Table well under the board root, centered on its board point: a
 * pulsing ring on the board plane, a pull ring at the well's influence
 * radius and a halo at the object's top. The puck variant adds a disc and
 * an invisible grab collider.
 */
export interface WellVisual {
  readonly root: Object3D;
  /** The puck's invisible, oversized grab target (scale it to the collider radius). */
  readonly collider?: Mesh;
  /** Height of the object's top above the board plane, in board units (the halo sits there). */
  setHeight(height: number): void;
  /** The well the height buttons change glows brighter. */
  setSelected(selected: boolean): void;
  setVisible(visible: boolean): void;
  update(t: number): void;
  /** Frees its sprite slots (geometry and materials are shared). */
  dispose(): void;
}
/** The hit-test reticle, in world meters on the hit surface (local +Y is the surface normal). */
export interface ReticleVisual {
  readonly root: Object3D;
  /** Shows the ring and dot; `onObject` picks bluish green (a well) or orange (puck fallback). */
  show(visible: boolean, onObject: boolean): void;
}
export interface TargetVisual {
  readonly root: Object3D;
  setSolved(solved: boolean): void;
  /** High contrast: a white outline under an opaque star glyph, and a solid capture ring. */
  setHighContrast(on: boolean): void;
  update(t: number): void;
}

export interface BoardVisual {
  readonly root: Object3D;
  update(t: number): void;
}

/** The chapter's constellation in the cosmos frame (meters): stars lit by solved levels, links between them. */
export interface ConstellationVisual {
  readonly root: Object3D;
  /** Star positions, one per chapter level (cosmos frame, meters). */
  setStars(points: readonly (readonly number[])[]): void;
  /** Lights or dims star `index`; `instant` skips the fade-in. */
  setLit(index: number, on: boolean, instant: boolean): void;
  /** A solve's flash on star `index` (it decays; none with reduced motion). */
  flash(index: number): void;
  /** Links between star index pairs; `animate` draws them in order over about 1.2 s. */
  setLinks(pairs: readonly (readonly [number, number])[], animate: boolean): void;
  update(dt: number, reducedMotion: boolean): void;
  litCount(): number;
  linkCount(): number;
  /** The links are still being drawn. */
  drawing(): boolean;
}

/**
 * The surrounding cosmos in world meters (sky dome, stars, planets, belt,
 * shooting stars). Its opacity and island mask are the shared
 * COSMOS_UNIFORMS, which CosmosSystem writes.
 */
export interface CosmosVisual {
  readonly root: Object3D;
  readonly constellation: ConstellationVisual;
  /** motionT: the decorative clock (still under reduced motion); realT, dt: the real clock. */
  update(motionT: number, realT: number, dt: number, reducedMotion: boolean): void;
  /** Eye height above the cosmos center (meters); the asteroid belt sits just below it. */
  setEyeHeight(height: number): void;
  /** Brightens and swells cosmos planet `index` (0 giant, 1 Neptune, 2 Uranus, 3 the Moon); it decays. */
  pulse(index: number, strength: number): void;
  pulseLevel(index: number): number;
  /** Shooting stars alive at real time `realT`. */
  activeShootingStars(realT: number): number;
  /** Debug: the first orbiting planet's position (cosmos frame) and the belt's turn, [x, y, z, yaw]. */
  motionProbe(): number[];
}
