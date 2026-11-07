import type { LevelDef } from '../level.js';

/**
 * Every stored solution must still solve when any one moved planet is
 * nudged this far (board units) in any direction: 1 cm on the 20 cm
 * fallback board, so imprecise hand placement still works.
 */
export const MIN_SOLUTION_MARGIN = 0.05;

/**
 * Near-rim sector kept free for the XR rim button: no movable start,
 * stored solution or melody solution may lie at board angle atan2(x, z)
 * in [minDeg, maxDeg] degrees at radius >= minRadius.
 */
export const RESERVED_RIM_SECTOR = { minDeg: -60, maxDeg: -15, minRadius: 0.7 } as const;

/**
 * Documented exception to MIN_SOLUTION_MARGIN: c1-l6's 3-star placement only
 * survives a nudge this large (4 mm on the 20 cm fallback board, about
 * 5.4 mm at table radius 0.27). A solver search found no placement ringing
 * p1, w1, hole that survives 0.03; the plain solve keeps 0.05. Tester
 * feedback decides whether Phase 3 adds a precision aid or retunes it.
 */
export const C1L6_MELODY_MARGIN = 0.02;

/**
 * Chapter 1: one planet, two planets, a moon, the black hole, the white
 * star (repulsor), then both together. Movable bodies start in a tray near
 * the rim on the player's (+z) side. Each stored solution was picked from
 * solver candidates for the widest margin; measured margins (largest nudge
 * in 16 directions that still solves) are about 0.075 (c1-l1), 0.065
 * (c1-l2), 0.1 (c1-l3), 0.125 (c1-l4), 0.1 (c1-l5) and 0.05 (c1-l6), all
 * at or above MIN_SOLUTION_MARGIN. Where two ring orders were close, the
 * stored solution was picked so its nudges keep its own ring order and do
 * not ring the melody by accident.
 *
 * `melody` is the ring order that earns 3 stars. When the stored solution
 * rings something else, `melodySolution` is a solver-picked placement that
 * rings the melody. levels.test.ts re-verifies every solution, margin and
 * melody, the reserved sector, and that c1-l2 has no solution moving only
 * one planet. c1-l6 is the documented exception: with the white star out of
 * the way the planet alone can solve it (1-2 stars), but only both bodies
 * ring its melody (3 stars).
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
    // Ringing the one planet is the whole song: the first solve earns 3 stars.
    melody: ['p1'],
    par: 3,
  },
  {
    // The target sits just behind the comet's start: the comet has to swing
    // all the way round and come back. One planet cannot turn it that far
    // (no one-planet solution with the other planet in its tray or parked on
    // the rim away from the flight), so both planets must be used.
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
    // The stored solution rings p1 then p2. The melody asks for the higher
    // note first: p2 by the comet's start, p1 near the middle (melody margin
    // about 0.025).
    melody: ['p2', 'p1'],
    melodySolution: { p1: [-0.53, 0.01], p2: [-0.85, -0.2] },
    par: 4,
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
    // The stored solution rings moon, core, p1. Placing the planet early, on
    // the near-left, rings p1 then the moon and skips the core (melody
    // margin about 0.025).
    melody: ['p1', 'moon'],
    melodySolution: { p1: [-0.48, 0.49] },
    par: 4,
  },
  {
    // A black hole sits just off the comet's path: untouched, the comet is
    // swallowed. A planet ahead of it lets the comet skim past the event
    // horizon, and the hole slings it round into the target behind.
    id: 'c1-l4',
    chapter: 1,
    order: 4,
    title: 'Event Horizon',
    comet: { position: [-0.95, 0], velocity: [0.45, 0] },
    target: { position: [0.68, 0.42], radius: 0.13 },
    bodies: [
      { id: 'hole', kind: 'black-hole', position: [0.4, 0.16] },
      { id: 'p1', kind: 'planet', position: [0.25, 0.85], movable: true },
    ],
    solution: { p1: [0.63, 0.03] },
    // The stored solution rings the hole, then the planet. Placing the
    // planet further back rings it first (melody margin about 0.1).
    melody: ['p1', 'hole'],
    melodySolution: { p1: [0.5, -0.16] },
    par: 4,
  },
  {
    // A fixed planet blocks the comet's path. The white star pushes instead
    // of pulling: placed on the far side of the path, it pushes the comet
    // past the planet and round the corner into the target.
    id: 'c1-l5',
    chapter: 1,
    order: 5,
    title: 'White Star',
    comet: { position: [-0.95, 0], velocity: [0.48, 0] },
    target: { position: [0.8, 0.28], radius: 0.13 },
    bodies: [
      { id: 'rock', kind: 'planet', position: [0.76, -0.06] },
      { id: 'w1', kind: 'repulsor', position: [0.3, 0.85], movable: true },
    ],
    solution: { w1: [0.14, -0.34] },
    // The stored solution rings only the white star. A later, closer push
    // lets the comet graze the planet so it rings too (melody margin about
    // 0.045).
    melody: ['w1', 'rock'],
    melodySolution: { w1: [0.45, -0.18] },
    par: 4,
  },
  {
    // The comet runs along the near rim and out of bounds. The planet pulls
    // it inward, toward a black hole by the near rim; the white star pushes
    // it past the hole and on into the target. With the white star left in
    // its tray, the planet alone cannot solve it. With the white star moved
    // out of the way, a planet-only solve exists, but it never rings the
    // melody: 3 stars need both bodies.
    id: 'c1-l6',
    chapter: 1,
    order: 6,
    title: 'Light and Dark',
    comet: { position: [-0.92, 0.16], velocity: [0.25, 0.44] },
    target: { position: [0.7, 0.47], radius: 0.13 },
    bodies: [
      { id: 'hole', kind: 'black-hole', position: [-0.05, 0.6] },
      { id: 'p1', kind: 'planet', position: [0.2, 0.88], movable: true },
      { id: 'w1', kind: 'repulsor', position: [0.5, 0.72], movable: true },
    ],
    solution: { p1: [-0.39, 0.38], w1: [0.15, 0.45] },
    // The stored solution rings planet, hole, white star. Pulling the comet
    // in earlier and putting the white star before the hole swaps the last
    // two notes. This placement's margin is only C1L6_MELODY_MARGIN.
    melody: ['p1', 'w1', 'hole'],
    melodySolution: { p1: [-0.49, 0.2], w1: [-0.2, 0.5] },
    par: 5,
  },
];
