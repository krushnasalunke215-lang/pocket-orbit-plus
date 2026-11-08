import type { LevelDef, Placements } from '../level.js';
import type { ExternalWell } from '../wells.js';

/** A stored solve that uses gravity wells (real objects or pucks) besides the level's own bodies. */
export interface WellSolution {
  readonly placements: Placements;
  /** Board-plane wells (y = 0), with masses inside the real-object clamp range. */
  readonly wells: readonly ExternalWell[];
}

/** A "Your Table" sandbox target: a level, optionally solved with wells. */
export interface SandboxLevelDef extends LevelDef {
  /**
   * Present when the planet alone cannot reach the target. Then `solution`
   * is the planet placement of this solve, which only solves with its wells.
   */
  readonly wellSolution?: WellSolution;
}

/** Where the one movable planet starts (near rim, right of the handle). */
const TRAY: [number, number] = [0.15, 0.88];

/**
 * "Your Table" targets (chapter 0, the sandbox): the comet starts near the
 * left rim, one movable planet waits in the tray, and real objects on the
 * player's table (or well pucks) add gravity. Table 1 needs only the planet.
 * Tables 2 and 3 put the target behind the comet's start, where one planet
 * cannot turn it (sandbox.test.ts checks a 0.05 grid), so a well is needed.
 * Story levels never see wells; these targets exist for them. The stored
 * well solutions were picked from a planet x well grid search (0.1 grid,
 * mass 0.03: a cup about 16 cm tall) for surviving 0.02 planet and 0.03
 * well nudges.
 */
export const SANDBOX_LEVELS: readonly SandboxLevelDef[] = [
  {
    id: 'table-1',
    chapter: 0,
    order: 1,
    title: 'Your Table 1',
    comet: { position: [-0.95, 0], velocity: [0.45, 0] },
    target: { position: [0.6, -0.45], radius: 0.13 },
    bodies: [{ id: 'p1', kind: 'planet', position: TRAY, movable: true }],
    solution: { p1: [-0.65, -0.6] },
  },
  {
    // The comet must swing round and come back past its start.
    id: 'table-2',
    chapter: 0,
    order: 2,
    title: 'Your Table 2',
    comet: { position: [-0.9, 0.03], velocity: [0.41, -0.04] },
    target: { position: [-0.7, 0.2], radius: 0.15 },
    bodies: [{ id: 'p1', kind: 'planet', position: TRAY, movable: true }],
    solution: { p1: [-0.5, 0.1] },
    wellSolution: {
      placements: { p1: [-0.5, 0.1] },
      wells: [{ id: 'well-1', position: [-0.8, 0, -0.3], mass: 0.03, source: 'real-object' }],
    },
  },
  {
    // The target sits on the far side behind the start: a well ahead of the
    // comet turns it back after the planet bends it toward the far rim.
    id: 'table-3',
    chapter: 0,
    order: 3,
    title: 'Your Table 3',
    comet: { position: [-0.92, -0.15], velocity: [0.44, 0.04] },
    target: { position: [-0.7, -0.4], radius: 0.15 },
    bodies: [{ id: 'p1', kind: 'planet', position: TRAY, movable: true }],
    solution: { p1: [-0.9, 0.1] },
    wellSolution: {
      placements: { p1: [-0.9, 0.1] },
      wells: [{ id: 'well-1', position: [-0.5, 0, -0.1], mass: 0.03, source: 'real-object' }],
    },
  },
];
