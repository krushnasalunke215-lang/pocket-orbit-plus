import { startPlacements, type LevelDef, type Placements } from './level.js';
import { bodyPositionAt, createSimBodies, simulate, type SimResult } from './simulate.js';
import type { Vec2 } from './vec.js';

/** Default robustness offset in board units (about 3 mm on a 20 cm board). */
export const ROBUST_DELTA = 0.015;

/** Search runs only need the outcome, so they record just the end points. */
const SEARCH_RECORD_EVERY = 1 << 30;

/** Minimum gap between a candidate body's surface and the comet start. */
const COMET_CLEARANCE = 0.05;

export interface Solution {
  readonly placements: Placements;
  readonly result: SimResult;
  /** All four axis neighbors at ±ROBUST_DELTA of every moved body solve. */
  readonly robust: boolean;
  /** Solving axis neighbors at ±2·ROBUST_DELTA (tiebreak; max 4 per body). */
  readonly neighborScore: number;
}

export interface SolveOptions {
  /** Grid spacing in board units (default 0.1). */
  readonly step?: number;
  /** Candidate positions lie within this radius (default 0.92). */
  readonly placeRadius?: number;
  /** Stop searching after this many solutions (default Infinity). */
  readonly maxSolutions?: number;
  /** Only keep robust solutions (default true). */
  readonly requireRobust?: boolean;
  /** Movable bodies held at these positions instead of searched. */
  readonly fixed?: Placements;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Points of a square grid with the given spacing, inside the disc. */
export function gridPoints(step: number, radius: number): Vec2[] {
  if (!(step > 0) || !(radius >= 0)) throw new Error('gridPoints needs step > 0 and radius >= 0');
  const n = Math.floor(radius / step + 1e-9);
  const r2 = radius * radius + 1e-9;
  const points: Vec2[] = [];
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const x = round6(i * step);
      const z = round6(j * step);
      if (x * x + z * z <= r2) points.push([x, z]);
    }
  }
  return points;
}

function solves(level: LevelDef, placements: Placements): boolean {
  return simulate(level, placements, { recordEvery: SEARCH_RECORD_EVERY }).outcome === 'solved';
}

function fullPlacements(level: LevelDef, placements: Placements): Placements {
  return { ...startPlacements(level), ...placements };
}

/** Counts axis neighbors at ±delta of every movable body that still solve. */
function solvingNeighbors(level: LevelDef, placements: Placements, delta: number, stopOnFail: boolean): number {
  let solving = 0;
  for (const id of Object.keys(placements)) {
    const [x, z] = placements[id];
    const offsets: Vec2[] = [
      [x + delta, z],
      [x - delta, z],
      [x, z + delta],
      [x, z - delta],
    ];
    for (const p of offsets) {
      if (solves(level, { ...placements, [id]: p })) solving++;
      else if (stopOnFail) return -1;
    }
  }
  return solving;
}

export function verifySolution(
  level: LevelDef,
  placements: Placements,
): { solved: boolean; result: SimResult } {
  const result = simulate(level, placements);
  return { solved: result.outcome === 'solved', result };
}

/** The placements solve and so do all four ±delta axis neighbors of every movable body. */
export function isRobust(level: LevelDef, placements: Placements, delta = ROBUST_DELTA): boolean {
  const full = fullPlacements(level, placements);
  return solves(level, full) && solvingNeighbors(level, full, delta, true) >= 0;
}

/** True when launching without moving anything already solves the level. */
export function solvesWithZeroMoves(level: LevelDef): boolean {
  return solves(level, startPlacements(level));
}

/**
 * True when one of the moved bodies overlaps another body (at t = 0), the
 * target or the comet start. Such layouts are skipped by the search.
 */
function overlaps(level: LevelDef, placements: Placements, movedIds: readonly string[]): boolean {
  const bodies = createSimBodies(level, placements);
  const pos = new Float64Array(bodies.count * 3);
  for (let i = 0; i < bodies.count; i++) bodyPositionAt(bodies, i, 0, pos, i * 3);
  const near = (i: number, x: number, z: number, gap: number) => {
    const dx = pos[i * 3] - x;
    const dz = pos[i * 3 + 2] - z;
    return dx * dx + dz * dz < gap * gap;
  };
  for (const id of movedIds) {
    const i = bodies.ids.indexOf(id);
    const r = bodies.radii[i];
    const [tx, tz] = level.target.position;
    const [cx, cz] = level.comet.position;
    if (near(i, tx, tz, r + level.target.radius)) return true;
    if (near(i, cx, cz, r + COMET_CLEARANCE)) return true;
    for (let j = 0; j < bodies.count; j++) {
      if (j !== i && near(i, pos[j * 3], pos[j * 3 + 2], r + bodies.radii[j])) return true;
    }
  }
  return false;
}

/**
 * Searches the cartesian product of grid points for every movable body not
 * in `fixed`, keeping solving layouts (robust ones only when requireRobust).
 * Results are sorted robust first, then by neighborScore, then grid order.
 */
export function solveLevel(level: LevelDef, options: SolveOptions = {}): Solution[] {
  const step = options.step ?? 0.1;
  const placeRadius = options.placeRadius ?? 0.92;
  const maxSolutions = options.maxSolutions ?? Infinity;
  const requireRobust = options.requireRobust ?? true;
  const fixed = options.fixed ?? {};

  const free = level.bodies.filter((b) => b.movable && !(b.id in fixed)).map((b) => b.id);
  const base: Placements = { ...startPlacements(level), ...fixed };
  const grid = gridPoints(step, placeRadius);
  const found: { placements: Placements; robust: boolean; neighborScore: number }[] = [];
  const idx = new Array<number>(free.length).fill(0);

  const total = free.length === 0 ? 1 : Math.pow(grid.length, free.length);
  for (let c = 0; c < total && found.length < maxSolutions; c++) {
    const placements: Record<string, Vec2> = { ...base };
    for (let k = 0; k < free.length; k++) placements[free[k]] = grid[idx[k]];
    // Advance the odometer for the next candidate.
    for (let k = free.length - 1; k >= 0; k--) {
      idx[k]++;
      if (idx[k] < grid.length) break;
      idx[k] = 0;
    }
    if (free.length > 0 && overlaps(level, placements, free)) continue;
    if (!solves(level, placements)) continue;
    const robust = solvingNeighbors(level, placements, ROBUST_DELTA, true) >= 0;
    if (requireRobust && !robust) continue;
    const neighborScore = solvingNeighbors(level, placements, 2 * ROBUST_DELTA, false);
    found.push({ placements, robust, neighborScore });
  }

  found.sort((a, b) => Number(b.robust) - Number(a.robust) || b.neighborScore - a.neighborScore);
  return found.map((s) => ({ ...s, result: simulate(level, s.placements) }));
}
