import type { Vec3 } from '../sim/vec.js';
import type { ExternalWell } from '../sim/wells.js';

/*
 * "Your Table": real objects on the player's table become gravity wells.
 * A hit-test point on an object (board coordinates) and its height above
 * the board plane (meters) give a well on the board plane under the object;
 * taller objects pull harder. Pure, so the mapping is unit-tested.
 */

/** Wells the sandbox holds at most (real objects and pucks together). */
export const MAX_WELLS = 3;
/** Hits lower than this above the board plane count as the table itself (meters). */
export const MIN_OBJECT_HEIGHT_M = 0.015;
/** Heights above this are clamped (meters). */
export const MAX_OBJECT_HEIGHT_M = 0.3;
/** Well mass at MIN_OBJECT_HEIGHT_M (a coaster). */
export const MIN_WELL_MASS = 0.01;
/** Well mass at MAX_OBJECT_HEIGHT_M: the black hole's mass. */
export const MAX_WELL_MASS = 0.06;
/**
 * Exponent of the height-to-mass curve. With 1.4 a 16.3 cm cup (the IWER
 * spike's measured hit) pulls like a default planet (mass 0.03).
 */
export const WELL_MASS_CURVE = 1.4;
/** Height the +/- buttons add or remove per press (meters). */
export const HEIGHT_STEP_M = 0.01;
/** Height a new well puck starts with (meters). */
export const PUCK_HEIGHT_M = 0.05;
/** Board radius beyond which a hit is off the board. */
export const OFF_BOARD_RADIUS = 1;

export type HitClass = 'object' | 'too-low' | 'off-board';

/** Clamps a height to [MIN_OBJECT_HEIGHT_M, MAX_OBJECT_HEIGHT_M]; NaN becomes the minimum. */
export function clampHeight(heightM: number): number {
  if (!(heightM > MIN_OBJECT_HEIGHT_M)) return MIN_OBJECT_HEIGHT_M;
  return Math.min(MAX_OBJECT_HEIGHT_M, heightM);
}

/** Mass of a well for an object this tall: monotonic, clamped to [MIN_WELL_MASS, MAX_WELL_MASS]. */
export function wellMassForHeight(heightM: number): number {
  const t = (clampHeight(heightM) - MIN_OBJECT_HEIGHT_M) / (MAX_OBJECT_HEIGHT_M - MIN_OBJECT_HEIGHT_M);
  return MIN_WELL_MASS + (MAX_WELL_MASS - MIN_WELL_MASS) * Math.pow(t, WELL_MASS_CURVE);
}

/**
 * What a confirming pinch at this hit does: 'off-board' beyond the board's
 * radius (horizontally), 'too-low' when the hit is the table (or a flat
 * thing on it), else 'object'.
 */
export function classifyHit(boardPoint: Vec3, heightM: number): HitClass {
  if (Math.hypot(boardPoint[0], boardPoint[2]) > OFF_BOARD_RADIUS) return 'off-board';
  if (!(heightM >= MIN_OBJECT_HEIGHT_M)) return 'too-low';
  return 'object';
}

/** A well on the board plane under the hit point, as heavy as the object is tall. */
export function wellFromBoardPoint(
  id: string,
  boardPoint: Vec3,
  heightM: number,
  source: ExternalWell['source'] = 'real-object',
): ExternalWell {
  return { id, position: [boardPoint[0], 0, boardPoint[2]], mass: wellMassForHeight(heightM), source };
}

/** The list with `well` appended, or null when it already holds MAX_WELLS (the list is not changed). */
export function addWell(list: readonly ExternalWell[], well: ExternalWell): ExternalWell[] | null {
  if (list.length >= MAX_WELLS) return null;
  return [...list, well];
}

/** The height after `steps` presses of +/- (negative is down), clamped. */
export function heightStep(heightM: number, steps: number): number {
  // Snap to whole millimeters so repeated presses do not drift.
  return clampHeight(Math.round((heightM + steps * HEIGHT_STEP_M) * 1000) / 1000);
}

/**
 * Jitter of a hit-test point: the root-mean-square distance (millimeters) of
 * the last `count` xyz samples (meters, packed) from their mean. 0 for fewer
 * than two samples.
 */
export function jitterMm(samples: ArrayLike<number>, count: number): number {
  const n = Math.min(count, Math.floor(samples.length / 3));
  if (n < 2) return 0;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (let i = 0; i < n; i++) {
    mx += samples[i * 3];
    my += samples[i * 3 + 1];
    mz += samples[i * 3 + 2];
  }
  mx /= n;
  my /= n;
  mz /= n;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const dx = samples[i * 3] - mx;
    const dy = samples[i * 3 + 1] - my;
    const dz = samples[i * 3 + 2] - mz;
    sum += dx * dx + dy * dy + dz * dz;
  }
  return Math.sqrt(sum / n) * 1000;
}
