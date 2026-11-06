/**
 * Simulation constants. All lengths are board-normalized (board radius = 1),
 * time is in seconds.
 */

/** Fixed integration timestep. */
export const SIM_DT = 1 / 240;

/** Gravitational constant in board units. */
export const G = 1;

/** Plummer softening length; keeps close passes finite. */
export const EPS = 0.03;

/** A flight that lasts this long without another outcome times out. */
export const DEFAULT_MAX_TIME = 12;

/** Leaving this radius (horizontally, or this far in height) is out-of-bounds. */
export const DEFAULT_BOUNDS_RADIUS = 1.4;

/** Record a playback sample every this many steps. */
export const DEFAULT_RECORD_EVERY = 2;

/** Planet defaults; bodies.ts reads them so WELL_DENSITY has no import cycle. */
export const PLANET_DEFAULT_MASS = 0.03;
export const PLANET_DEFAULT_RADIUS = 0.07;

/**
 * Mass per radius cubed of a default planet. An external well that only has a
 * radius gets mass = WELL_DENSITY * radius^3, so it pulls like a planet of
 * that size.
 */
export const WELL_DENSITY =
  PLANET_DEFAULT_MASS /
  (PLANET_DEFAULT_RADIUS * PLANET_DEFAULT_RADIUS * PLANET_DEFAULT_RADIUS);
