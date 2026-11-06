import { describe, expect, it } from 'vitest';
import { startPlacements, validateLevel } from '../level.js';
import { simulate } from '../simulate.js';
import { isRobust, solvesWithZeroMoves, verifySolution } from '../solver.js';
import { vec2Distance } from '../vec.js';
import { ALL_LEVELS } from './index.js';

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
});
