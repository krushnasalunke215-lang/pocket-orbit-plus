import type { LevelDef } from '../level.js';

/**
 * Chapter 1: one planet, then two planets, then a moon. Movable planets start
 * in a tray near the rim on the player's (+z) side. Each stored solution was
 * picked from `npm run solve -- <id>` candidates for the widest margin: it
 * still solves when any one planet is nudged by up to 0.03 (0.075 in c1-l1)
 * in any of 8 directions. levels.test.ts re-verifies every solution.
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
    // The target sits behind the comet's start: turning back needs more than
    // one planet can bend (no robust one-planet layout exists), so both
    // planets must be used.
    id: 'c1-l2',
    chapter: 1,
    order: 2,
    title: 'Two Notes',
    comet: { position: [-0.35, -0.8], velocity: [0.45, 0] },
    target: { position: [-0.45, 0.6], radius: 0.18 },
    bodies: [
      { id: 'p1', kind: 'planet', position: [0.2, 0.88], movable: true },
      { id: 'p2', kind: 'planet', position: [0.5, 0.75], movable: true },
    ],
    solution: { p1: [0, -0.4], p2: [0.15, -0.55] },
  },
  {
    // A fixed planet with an orbiting moon guards the middle of the board.
    // Untouched, the comet runs into the moon; the planet must steer it
    // past the moon at the right moment.
    id: 'c1-l3',
    chapter: 1,
    order: 3,
    title: 'Moonrise',
    comet: { position: [-0.95, 0.15], velocity: [0.45, 0] },
    target: { position: [0.65, 0.45], radius: 0.13 },
    bodies: [
      { id: 'core', kind: 'planet', position: [0, -0.15] },
      {
        id: 'moon',
        kind: 'moon',
        // The orbit's t = 0 point (phase 0).
        position: [0.3, -0.15],
        orbit: { parent: 'core', radius: 0.3, period: 6 },
      },
      { id: 'p1', kind: 'planet', position: [-0.2, 0.88], movable: true },
    ],
    solution: { p1: [-0.45, 0.475] },
  },
];
