import { describe, expect, it } from 'vitest';
import { startPlacements, validateLevel } from '../level.js';
import { simulate } from '../simulate.js';
import { isRobust, solveLevel, solvesWithZeroMoves, verifySolution } from '../solver.js';
import { vec2Distance, type Vec2 } from '../vec.js';
import { MIN_SOLUTION_MARGIN } from './chapter1.js';
import { ALL_LEVELS, getLevel } from './index.js';

/** Directions of the margin check: every 22.5 degrees. */
const MARGIN_DIRECTIONS = 16;

describe('shipped levels', () => {
  it('have unique ids ordered by chapter, then order', () => {
    const ids = ALL_LEVELS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    const sorted = [...ALL_LEVELS].sort((a, b) => a.chapter - b.chapter || a.order - b.order);
    expect(sorted.map((l) => l.id)).toEqual(ids);
  });

  describe.each(ALL_LEVELS.map((level) => [level.id, level] as const))('%s', (_id, level) => {
    it('passes validateLevel', () => {
      expect(validateLevel(level)).toEqual([]);
    });

    it('has a stored solution that solves robustly in 2-8 s', () => {
      const { solved, result } = verifySolution(level, level.solution);
      expect(solved).toBe(true);
      expect(result.time).toBeGreaterThanOrEqual(2);
      expect(result.time).toBeLessThanOrEqual(8);
      expect(isRobust(level, level.solution)).toBe(true);
    });

    it(`still solves with any moved planet nudged by ${MIN_SOLUTION_MARGIN} in any direction`, () => {
      const failures: string[] = [];
      for (const id of Object.keys(level.solution)) {
        const [x, z] = level.solution[id];
        for (let k = 0; k < MARGIN_DIRECTIONS; k++) {
          const a = (2 * Math.PI * k) / MARGIN_DIRECTIONS;
          const nudged: Vec2 = [x + MIN_SOLUTION_MARGIN * Math.cos(a), z + MIN_SOLUTION_MARGIN * Math.sin(a)];
          if (!verifySolution(level, { ...level.solution, [id]: nudged }).solved) failures.push(`${id} at ${k}`);
        }
      }
      expect(failures).toEqual([]);
    });

    it('is not solved with zero moves, and every moved body travels at least 0.3', () => {
      expect(solvesWithZeroMoves(level)).toBe(false);
      const start = startPlacements(level);
      for (const id of Object.keys(level.solution)) {
        expect(vec2Distance(level.solution[id], start[id])).toBeGreaterThanOrEqual(0.3);
      }
    });

    it('produces identical flybys on every run, including one per moved body', () => {
      const a = simulate(level, level.solution);
      const b = simulate(level, level.solution);
      expect(b.flybys).toEqual(a.flybys);
      for (const id of Object.keys(level.solution)) {
        expect(a.flybys.some((f) => f.bodyId === id)).toBe(true);
      }
    });
  });

  it.each(['p1', 'p2'])(
    'c1-l2 "Two Notes" needs both planets: no solution moving only %s (0.01 grid)',
    (moved) => {
      const level = getLevel('c1-l2')!;
      const start = startPlacements(level);
      const fixed = Object.fromEntries(Object.keys(start).filter((id) => id !== moved).map((id) => [id, start[id]]));
      expect(Object.keys(fixed)).toHaveLength(1);
      const found = solveLevel(level, { step: 0.01, fixed, requireRobust: false, maxSolutions: 1 });
      expect(found.map((s) => s.placements[moved])).toEqual([]);
    },
    60_000,
  );
});
