import { describe, expect, it } from 'vitest';
import type { LevelDef } from './level.js';
import { getLevel } from './levels/index.js';
import { isRobust, solveLevel, verifySolution } from './solver.js';

/** Mirror image of a one-bend puzzle: the target sits on the player's side. */
const FIXTURE: LevelDef = {
  id: 'solver-fixture',
  chapter: 0,
  order: 0,
  title: 'Solver fixture',
  comet: { position: [-0.95, 0], velocity: [0.45, 0] },
  target: { position: [0.6, 0.5], radius: 0.12 },
  bodies: [{ id: 'p1', kind: 'planet', position: [0, -0.85], movable: true }],
  solution: { p1: [0, -0.85] },
};

function expectRobustSolution(level: LevelDef): void {
  const solutions = solveLevel(level, { step: 0.1, maxSolutions: 1 });
  expect(solutions).toHaveLength(1);
  const [best] = solutions;
  expect(best.robust).toBe(true);
  expect(best.result.outcome).toBe('solved');
  expect(verifySolution(level, best.placements).solved).toBe(true);
  expect(isRobust(level, best.placements)).toBe(true);
}

describe('solveLevel', () => {
  it('finds a robust solution for the fixture level', () => {
    expectRobustSolution(FIXTURE);
  }, 10_000);

  it('finds a robust solution for c1-l1', () => {
    const level = getLevel('c1-l1');
    expect(level).toBeDefined();
    expectRobustSolution(level as LevelDef);
  }, 10_000);
});
