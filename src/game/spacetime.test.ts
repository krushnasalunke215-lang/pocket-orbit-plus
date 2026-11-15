import { describe, expect, it } from 'vitest';
import { KIND_DEFAULTS, type BodyKind } from '../sim/bodies.js';
import { WELL_INFLUENCE_RADIUS } from '../sim/wells.js';
import {
  GRID_MAX_BODIES,
  GRID_MAX_BULGE,
  GRID_MIN_DIP,
  gridDip,
  gridHeight,
  gridPin,
  gridPull,
  wellPull,
} from './spacetime.js';

/** One default body of `kind` at the board center, packed for gridDip. */
function single(kind: BodyKind): number[] {
  const d = KIND_DEFAULTS[kind];
  return [0, 0, gridPull(kind, d.mass), d.influenceRadius];
}

describe('gridDip', () => {
  it('dips deepest under a black hole, less under a planet, least under a moon', () => {
    const hole = gridDip(0, 0, single('black-hole'), 1);
    const planet = gridDip(0, 0, single('planet'), 1);
    const moon = gridDip(0, 0, single('moon'), 1);
    expect(hole).toBeLessThan(planet);
    expect(planet).toBeLessThan(moon);
    expect(moon).toBeLessThan(0);
    // The same order holds a little away from the center.
    expect(gridDip(0.1, 0, single('black-hole'), 1)).toBeLessThan(gridDip(0.1, 0, single('planet'), 1));
    expect(gridDip(0.1, 0, single('planet'), 1)).toBeLessThan(gridDip(0.1, 0, single('moon'), 1));
  });

  it('bulges up under the white star (it pushes)', () => {
    expect(gridPull('repulsor', 0.025)).toBeLessThan(0);
    const bulge = gridDip(0, 0, single('repulsor'), 1);
    expect(bulge).toBeGreaterThan(0);
    expect(bulge).toBeLessThanOrEqual(GRID_MAX_BULGE);
  });

  it('is zero at and past the influence radius', () => {
    for (const kind of ['planet', 'moon', 'black-hole', 'repulsor'] as BodyKind[]) {
      const entry = single(kind);
      const infl = KIND_DEFAULTS[kind].influenceRadius;
      expect(gridDip(infl, 0, entry, 1), kind).toBe(0);
      expect(gridDip(0, infl * 1.5, entry, 1), kind).toBe(0);
      // Inside, it is not zero.
      expect(gridDip(infl * 0.3, 0, entry, 1), kind).not.toBe(0);
    }
  });

  it('deepens toward the body', () => {
    const entry = single('planet');
    let last = 0;
    for (const d of [0.34, 0.25, 0.15, 0.05, 0]) {
      const y = gridDip(d, 0, entry, 1);
      expect(y).toBeLessThan(last);
      last = y;
    }
  });

  it('holds the clamp with every body stacked on one point', () => {
    const holes: number[] = [];
    const stars: number[] = [];
    for (let i = 0; i < GRID_MAX_BODIES; i++) {
      holes.push(...single('black-hole'));
      stars.push(...single('repulsor'));
    }
    expect(gridDip(0, 0, holes, GRID_MAX_BODIES)).toBe(GRID_MIN_DIP);
    expect(gridDip(0, 0, stars, GRID_MAX_BODIES)).toBe(GRID_MAX_BULGE);
    // Entries past GRID_MAX_BODIES and past `count` are ignored.
    expect(gridDip(0, 0, [...single('black-hole'), ...single('repulsor')], 1)).toBe(gridDip(0, 0, single('black-hole'), 1));
    expect(gridDip(0, 0, holes, 0)).toBe(0);
  });

  it('keeps the rim flat: the drawn height is pinned to zero at r = 1', () => {
    // A black hole close to the rim still bends the plate inside, never the rim.
    const entry = [0.85, 0, gridPull('black-hole', KIND_DEFAULTS['black-hole'].mass), 0.4];
    expect(gridDip(1, 0, entry, 1)).toBeLessThan(0);
    expect(Math.abs(gridHeight(1, 0, entry, 1))).toBe(0);
    expect(gridHeight(0.85, 0, entry, 1)).toBe(gridDip(0.85, 0, entry, 1));
    expect(gridPin(0.5)).toBe(1);
    expect(gridPin(1.02)).toBe(0);
    expect(gridPin(0.95)).toBeGreaterThan(0);
    expect(gridPin(0.95)).toBeLessThan(1);
  });

  it('takes Your Table wells as attracting bodies', () => {
    const pull = wellPull({ id: 'w', position: [0.2, 0, -0.1], mass: 0.03, source: 'real-object' });
    expect(pull).toBe(0.03);
    const y = gridDip(0.2, -0.1, [0.2, -0.1, pull, WELL_INFLUENCE_RADIUS], 1);
    expect(y).toBeCloseTo(gridDip(0, 0, single('planet'), 1), 10);
  });
});
