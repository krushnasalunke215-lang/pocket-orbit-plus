import { describe, expect, it } from 'vitest';
import { MAX_WELL_MASS, MIN_WELL_MASS } from '../../game/real-object.js';
import { startPlacements, validateLevel } from '../level.js';
import { simulate } from '../simulate.js';
import { solveLevel, solvesWithZeroMoves, verifySolution } from '../solver.js';
import { vec2Length, type Vec2 } from '../vec.js';
import { RESERVED_RIM_SECTOR } from './chapter1.js';
import { ALL_LEVELS } from './index.js';
import { SANDBOX_LEVELS } from './sandbox.js';

/** Stored wells keep this far from the board center (where the comet often crosses). */
const CENTER_CLEARANCE = 0.2;

function inReservedSector([x, z]: Vec2): boolean {
  const deg = (Math.atan2(x, z) * 180) / Math.PI;
  const { minDeg, maxDeg, minRadius } = RESERVED_RIM_SECTOR;
  return vec2Length([x, z]) >= minRadius && deg >= minDeg && deg <= maxDeg;
}

describe('Your Table sandbox targets', () => {
  it('are table-1 .. table-3 of chapter 0, with ids no story level uses', () => {
    expect(SANDBOX_LEVELS.map((l) => [l.id, l.chapter, l.order, l.title])).toEqual([
      ['table-1', 0, 1, 'Your Table 1'],
      ['table-2', 0, 2, 'Your Table 2'],
      ['table-3', 0, 3, 'Your Table 3'],
    ]);
    const story = new Set(ALL_LEVELS.map((l) => l.id));
    expect(SANDBOX_LEVELS.filter((l) => story.has(l.id))).toEqual([]);
  });

  describe.each(SANDBOX_LEVELS.map((level) => [level.id, level] as const))('%s', (_id, level) => {
    it('passes validateLevel, starts near the left rim with one movable planet, and fails untouched', () => {
      expect(validateLevel(level)).toEqual([]);
      expect(level.comet.position[0]).toBeLessThan(-0.85);
      expect(level.bodies.filter((b) => b.movable).map((b) => b.kind)).toEqual(['planet']);
      expect(solvesWithZeroMoves(level)).toBe(false);
      for (const [id, p] of Object.entries(startPlacements(level))) expect(inReservedSector(p), id).toBe(false);
      for (const [id, p] of Object.entries(level.solution)) expect(inReservedSector(p), id).toBe(false);
    });

    it('solves deterministically: the planet alone, or with its stored wells', () => {
      const wells = level.wellSolution?.wells ?? [];
      const placements = level.wellSolution?.placements ?? level.solution;
      const a = simulate(level, placements, { externalWells: wells });
      const b = simulate(level, placements, { externalWells: wells });
      expect(a.outcome).toBe('solved');
      expect(a.time).toBeGreaterThanOrEqual(2);
      expect(a.time).toBeLessThanOrEqual(8);
      expect(b.pathHash).toBe(a.pathHash);
      expect(b.flybys).toEqual(a.flybys);
      for (const well of wells) expect(a.flybys.some((f) => f.bodyId === well.id && f.source === 'real-object')).toBe(true);
    });
  });

  it('table-1 needs only the planet: its stored solution solves without wells', () => {
    const level = SANDBOX_LEVELS[0];
    expect(level.wellSolution).toBeUndefined();
    expect(verifySolution(level, level.solution).solved).toBe(true);
  });

  it.each(['table-2', 'table-3'])(
    '%s needs a well: no planet-only solution on a 0.05 grid, and the stored planet alone misses',
    (id) => {
      const level = SANDBOX_LEVELS.find((l) => l.id === id)!;
      expect(level.wellSolution?.wells.length).toBeGreaterThan(0);
      expect(verifySolution(level, level.solution).solved).toBe(false);
      const found = solveLevel(level, { step: 0.05, requireRobust: false, maxSolutions: 1 });
      expect(found.map((s) => s.placements)).toEqual([]);
    },
    60_000,
  );

  it('stores real-object wells on the board plane, in the mass clamp range, away from the center and the rim button', () => {
    for (const level of SANDBOX_LEVELS) {
      for (const well of level.wellSolution?.wells ?? []) {
        const [x, y, z] = well.position;
        expect(well.source, well.id).toBe('real-object');
        expect(y).toBe(0);
        expect(well.mass).toBeGreaterThanOrEqual(MIN_WELL_MASS);
        expect(well.mass).toBeLessThanOrEqual(MAX_WELL_MASS);
        expect(Math.hypot(x, z)).toBeGreaterThanOrEqual(CENTER_CLEARANCE);
        expect(Math.hypot(x, z)).toBeLessThanOrEqual(1);
        expect(inReservedSector([x, z]), `${level.id} ${well.id}`).toBe(false);
      }
    }
  });
});
