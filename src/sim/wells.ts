import { WELL_DENSITY } from './constants.js';
import { isFiniteVec, type Vec3 } from './vec.js';

/**
 * A gravity well that is not part of the level, such as a real object on the
 * user's table. Wells attract the comet and emit flyby events like level
 * bodies, but have no contact rule (the comet passes through them).
 */
export interface ExternalWell {
  readonly id: string;
  /** Board-normalized [x, height, z]. */
  readonly position: Vec3;
  /** Takes precedence over radius when both are given. */
  readonly mass?: number;
  /** Normalized size; mass defaults to WELL_DENSITY * radius^3. */
  readonly radius?: number;
  readonly source: 'real-object' | (string & {});
}

/** Flyby threshold for external wells (same as a default planet). */
export const WELL_INFLUENCE_RADIUS = 0.35;

function checkPositive(well: ExternalWell, name: 'mass' | 'radius'): void {
  const v = well[name];
  if (v !== undefined && !(Number.isFinite(v) && v > 0)) {
    throw new Error(`External well ${well.id}: ${name} must be a finite number > 0`);
  }
}

/** The well's mass. Throws when the well is invalid. */
export function wellMass(well: ExternalWell): number {
  if (!Array.isArray(well.position) || well.position.length !== 3 || !isFiniteVec(well.position)) {
    throw new Error(`External well ${well.id}: position must be a finite [x, y, z]`);
  }
  checkPositive(well, 'mass');
  checkPositive(well, 'radius');
  if (well.mass !== undefined) return well.mass;
  if (well.radius !== undefined) {
    return WELL_DENSITY * well.radius * well.radius * well.radius;
  }
  throw new Error(`External well ${well.id}: needs a mass or a radius`);
}

/** The well's radius, derived from its mass when not given. */
export function wellRadius(well: ExternalWell): number {
  return well.radius ?? Math.cbrt(wellMass(well) / WELL_DENSITY);
}
