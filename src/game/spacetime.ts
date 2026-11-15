import { BODY_BEHAVIORS, type BodyKind } from '../sim/bodies.js';
import { wellMass, type ExternalWell } from '../sim/wells.js';

/*
 * The spacetime grid under the board (pure): every body bends the plate by
 * its pull, so a black hole is a deep funnel, a planet a softer dip, a moon
 * a shallow one, and the white star (which pushes) a low bulge. The board
 * plate's vertex shader (src/render/shaders/board.ts) mirrors gridDip line
 * for line (as gridHeight: pinned flat at the rim); the tests pin the shape.
 * Board units throughout.
 */

/** Bodies (level bodies and Your Table wells) the grid shader takes. */
export const GRID_MAX_BODIES = 12;
/** Depth per unit pull at the softening distance. */
export const GRID_DIP_SCALE = 0.15;
/** Softening length: the funnel stays finite and round under the body. */
export const GRID_SOFTENING = 0.06;
/** The funnel fades out from this fraction of the influence radius to zero at it. */
export const GRID_FADE_START = 0.6;
/** Deepest dip and highest bulge (board units; the bodies float VISUAL_LIFT 0.22 above the plane). */
export const GRID_MIN_DIP = -0.16;
export const GRID_MAX_BULGE = 0.06;

/** Signed pull of a body: its mass, negative for a body that pushes (the white star). */
export function gridPull(kind: BodyKind, mass: number): number {
  return BODY_BEHAVIORS[kind].gravitySign * mass;
}

/** Pull of a Your Table well (wells only attract). Throws on an invalid well, like wellMass. */
export function wellPull(well: ExternalWell): number {
  return wellMass(well);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Height of the plate at board point (x, z): the sum over the first `count`
 * entries (packed [x, z, pull, influence], at most GRID_MAX_BODIES) of
 * -GRID_DIP_SCALE * pull / sqrt(d² + soft²), tapered to zero between
 * GRID_FADE_START * influence and the influence radius, clamped to
 * [GRID_MIN_DIP, GRID_MAX_BULGE]. Zero at and past every influence radius.
 */
export function gridDip(x: number, z: number, entries: ArrayLike<number>, count: number): number {
  const n = Math.min(count, GRID_MAX_BODIES);
  let y = 0;
  for (let i = 0; i < n; i++) {
    const k = i * 4;
    const dx = x - entries[k];
    const dz = z - entries[k + 1];
    const influence = entries[k + 3];
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d >= influence) continue;
    const taper = 1 - smoothstep(GRID_FADE_START * influence, influence, d);
    y += (-GRID_DIP_SCALE * entries[k + 2] * taper) / Math.sqrt(d * d + GRID_SOFTENING * GRID_SOFTENING);
  }
  return Math.min(GRID_MAX_BULGE, Math.max(GRID_MIN_DIP, y));
}

/** The plate is pinned at its rim: the bend fades from this board radius to zero at r = 1. */
export const GRID_PIN_START = 0.9;

/** 1 inside GRID_PIN_START, easing to 0 at the rim (r = 1) and beyond, so the rim stays a flat circle. */
export function gridPin(r: number): number {
  return 1 - smoothstep(GRID_PIN_START, 1, r);
}

/** The drawn plate height at (x, z): gridDip pinned at the rim. */
export function gridHeight(x: number, z: number, entries: ArrayLike<number>, count: number): number {
  return gridDip(x, z, entries, count) * gridPin(Math.sqrt(x * x + z * z));
}
