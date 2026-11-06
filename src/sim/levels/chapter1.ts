import type { LevelDef } from '../level.js';

/**
 * Every stored solution must still solve when any one moved planet is
 * nudged this far (board units) in any direction: 1 cm on the 20 cm
 * fallback board, so imprecise hand placement still works.
 */
export const MIN_SOLUTION_MARGIN = 0.05;

/**
 * Chapter 1: one planet, then two planets, then a moon. Movable planets start
 * in a tray near the rim on the player's (+z) side. Each stored solution was
 * picked from solver candidates for the widest margin; measured margins are
 * about 0.075 (c1-l1), 0.065 (c1-l2) and 0.1 (c1-l3), all above
 * MIN_SOLUTION_MARGIN. levels.test.ts re-verifies every solution and margin,
 * and that c1-l2 has no one-planet solution (0.01 grid, robust or not).
 */
export const CHAPTER_1: LevelDef[] = [
  {
    // One bend: pull the comet toward the far side so it curves into the target.
    id: 'c1-l1',
    chapter: 1,
    order: 1,
    title: 'First Bend',
    comet: { position: [-0.95, 0], velocity: [0.45, 0] },
    target: { position: [0.6, -0.5], radius: 0.12 },
    bodies: [{ id: 'p1', kind: 'planet', position: [0, 0.85], movable: true }],
    solution: { p1: [-0.075, -0.4] },
  },
  {
    // The target sits just behind the comet's start: the comet has to swing
    // all the way round and come back. One planet cannot turn it that far
    // (no one-planet solution exists), so both planets must be used.
    id: 'c1-l2',
    chapter: 1,
    order: 2,
    title: 'Two Notes',
    comet: { position: [-0.9, 0.03], velocity: [0.41, -0.04] },
    target: { position: [-0.7, 0.2], radius: 0.15 },
    bodies: [
      { id: 'p1', kind: 'planet', position: [0.2, 0.88], movable: true },
      { id: 'p2', kind: 'planet', position: [0.5, 0.75], movable: true },
    ],
    solution: { p1: [-0.792, -0.32], p2: [-0.48, 0.12] },
  },
  {
    // A fixed planet with an orbiting moon guards the middle of the board.
    // Untouched, the comet runs into the moon; the planet must steer it
    // past the moon at the right moment.
    id: 'c1-l3',
    chapter: 1,
    order: 3,
    title: 'Moonrise',
    comet: { position: [-0.95, 0.16], velocity: [0.5, 0.02] },
    target: { position: [0.6, 0.42], radius: 0.14 },
    bodies: [
      { id: 'core', kind: 'planet', position: [0.09, 0.02] },
      {
        id: 'moon',
        kind: 'moon',
        // About the orbit's t = 0 point (phase 0.45).
        position: [0.33, 0.14],
        orbit: { parent: 'core', radius: 0.27, period: 6, phase: 0.45 },
      },
      { id: 'p1', kind: 'planet', position: [-0.2, 0.88], movable: true },
    ],
    solution: { p1: [0.068, 0.468] },
  },
];
