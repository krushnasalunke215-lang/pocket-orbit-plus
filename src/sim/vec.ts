/**
 * Plain tuple vectors for the simulation. Board-normalized frame: the board
 * has radius 1 and lies in the XZ plane, +Y is height above the board, and
 * +Z points toward the player.
 */

/** A point on the board: [x, z]. */
export type Vec2 = readonly [number, number];

/** A point in board space: [x, y = height above the board, z]. */
export type Vec3 = readonly [number, number, number];

/** True when every component is a finite number. */
export function isFiniteVec(v: readonly number[]): boolean {
  for (let i = 0; i < v.length; i++) {
    if (!Number.isFinite(v[i])) return false;
  }
  return true;
}

/** Distance of a board point from the board center. */
export function vec2Length(v: Vec2): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1]);
}

/** Distance between two board points. */
export function vec2Distance(a: Vec2, b: Vec2): number {
  const dx = a[0] - b[0];
  const dz = a[1] - b[1];
  return Math.sqrt(dx * dx + dz * dz);
}
