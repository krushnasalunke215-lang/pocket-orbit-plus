import { describe, expect, it } from 'vitest';
import { matchesMelody, rungSequence } from '../../game/song.js';
import { startPlacements, validateLevel, type LevelDef, type Placements } from '../level.js';
import { simulate } from '../simulate.js';
import { ROBUST_DELTA, isRobust, solveLevel, solvesWithZeroMoves, verifySolution } from '../solver.js';
import { vec2Distance, vec2Length, type Vec2 } from '../vec.js';
import { C1L6_MELODY_MARGIN, MIN_SOLUTION_MARGIN, RESERVED_RIM_SECTOR } from './chapter1.js';
import { ALL_LEVELS, getLevel } from './index.js';

/** Directions of the margin check: every 22.5 degrees. */
const MARGIN_DIRECTIONS = 16;

function inReservedSector([x, z]: Vec2): boolean {
  const deg = (Math.atan2(x, z) * 180) / Math.PI;
  const { minDeg, maxDeg, minRadius } = RESERVED_RIM_SECTOR;
  return vec2Length([x, z]) >= minRadius && deg >= minDeg && deg <= maxDeg;
}

/** The four ±delta axis neighbors of every placed body. */
function axisNeighbors(placements: Placements, delta: number): Placements[] {
  const out: Placements[] = [];
  for (const id of Object.keys(placements)) {
    const [x, z] = placements[id];
    const offsets: Vec2[] = [
      [x + delta, z],
      [x - delta, z],
      [x, z + delta],
      [x, z - delta],
    ];
    for (const p of offsets) out.push({ ...placements, [id]: p });
  }
  return out;
}

describe('shipped levels', () => {
  it('have unique ids ordered by chapter, then order', () => {
    const ids = ALL_LEVELS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    const sorted = [...ALL_LEVELS].sort((a, b) => a.chapter - b.chapter || a.order - b.order);
    expect(sorted.map((l) => l.id)).toEqual(ids);
  });

  it('are the six levels of chapter 1', () => {
    expect(ALL_LEVELS.map((l) => [l.id, l.chapter, l.order])).toEqual([
      ['c1-l1', 1, 1],
      ['c1-l2', 1, 2],
      ['c1-l3', 1, 3],
      ['c1-l4', 1, 4],
      ['c1-l5', 1, 5],
      ['c1-l6', 1, 6],
    ]);
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

    it('has a melody that a robust placement rings, also at every axis neighbor', () => {
      expect(level.melody?.length).toBeGreaterThan(0);
      const p = level.melodySolution ?? level.solution;
      const { solved, result } = verifySolution(level, p);
      expect(solved).toBe(true);
      expect(rungSequence(level, result.flybys)).toEqual(level.melody);
      expect(matchesMelody(level, result.flybys)).toBe(true);
      expect(isRobust(level, p)).toBe(true);
      for (const q of axisNeighbors(p, ROBUST_DELTA)) {
        expect(rungSequence(level, simulate(level, q).flybys), JSON.stringify(q)).toEqual(level.melody);
      }
      // A separate melody solution exists only when the stored one rings something else.
      if (level.melodySolution) {
        expect(matchesMelody(level, simulate(level, level.solution).flybys)).toBe(false);
      }
    });

    it('keeps the reserved rim sector free of start, solution and melody points', () => {
      const points: [string, Vec2][] = [
        ...Object.entries(startPlacements(level)).map(([id, p]) => [`start ${id}`, p] as [string, Vec2]),
        ...Object.entries(level.solution).map(([id, p]) => [`solution ${id}`, p] as [string, Vec2]),
        ...Object.entries(level.melodySolution ?? {}).map(([id, p]) => [`melodySolution ${id}`, p] as [string, Vec2]),
      ];
      expect(points.filter(([, p]) => inReservedSector(p)).map(([label]) => label)).toEqual([]);
    });
  });

  it('rejects bad notes, melodies, melody solutions and par', () => {
    const base = getLevel('c1-l2')!;
    const problems = (patch: Partial<LevelDef>) => validateLevel({ ...base, ...patch } as LevelDef);
    expect(problems({ melody: [] })).toEqual(['c1-l2: melody is empty']);
    expect(problems({ melody: ['p1', 'ghost'] })).toEqual(['c1-l2: melody names unknown body ghost']);
    expect(problems({ melodySolution: { p1: [0, 0] } })).toEqual(['c1-l2: melodySolution is missing movable body p2']);
    expect(problems({ melodySolution: { p1: [0, 0], p2: [2, 0] } })).toEqual([
      'c1-l2: melodySolution p2 is outside radius 1',
    ]);
    expect(problems({ melodySolution: { p1: [0, 0], p2: [0.1, 0], core: [0, 0] } })).toEqual([
      'c1-l2: melodySolution names non-movable or unknown body core',
    ]);
    for (const par of [0, -1, 1.5]) expect(problems({ par })).toEqual(['c1-l2: par must be a positive integer']);
    const bodies = base.bodies.map((b, i) => (i === 0 ? { ...b, note: 1.5 } : b));
    expect(problems({ bodies })).toEqual(['c1-l2: body p1 note is not an integer']);
    expect(problems({ bodies: base.bodies.map((b) => ({ ...b, note: -7 })) })).toEqual([]);
  });

  it('c1-l4 "Event Horizon" teaches the black hole: zero moves end swallowed', () => {
    const level = getLevel('c1-l4')!;
    const zero = simulate(level, startPlacements(level));
    expect(zero.outcome).toBe('swallowed');
    expect(level.bodies.find((b) => b.id === zero.endBodyId)?.kind).toBe('black-hole');
  });

  it('c1-l5 "White Star" teaches the white star: the player moves it and the solution flies past it', () => {
    const level = getLevel('c1-l5')!;
    const white = level.bodies.filter((b) => b.kind === 'repulsor');
    expect(white.length).toBeGreaterThan(0);
    expect(white.every((b) => b.movable)).toBe(true);
    const flybys = simulate(level, level.solution).flybys;
    expect(flybys.some((f) => white.some((b) => b.id === f.bodyId))).toBe(true);
  });

  it('c1-l6 "Light and Dark" flies past both the black hole and the white star', () => {
    const level = getLevel('c1-l6')!;
    const kinds = new Set(simulate(level, level.solution).flybys.map((f) => level.bodies.find((b) => b.id === f.bodyId)?.kind));
    expect(kinds.has('black-hole')).toBe(true);
    expect(kinds.has('repulsor')).toBe(true);
    const movable = level.bodies.filter((b) => b.movable).map((b) => b.kind).sort();
    expect(movable).toEqual(['planet', 'repulsor']);
  });

  it(`c1-l6 3-star placement rings p1, w1, hole every run and survives a ${C1L6_MELODY_MARGIN} nudge`, () => {
    const level = getLevel('c1-l6')!;
    const p = level.melodySolution!;
    expect(p).toEqual({ p1: [-0.49, 0.2], w1: [-0.2, 0.5] });
    const a = simulate(level, p);
    const b = simulate(level, p);
    expect(a.outcome).toBe('solved');
    expect(b.flybys).toEqual(a.flybys);
    expect(b.pathHash).toBe(a.pathHash);
    expect(rungSequence(level, a.flybys)).toEqual(['p1', 'w1', 'hole']);
    const failures: string[] = [];
    for (const id of Object.keys(p)) {
      const [x, z] = p[id];
      for (let k = 0; k < MARGIN_DIRECTIONS; k++) {
        const ang = (2 * Math.PI * k) / MARGIN_DIRECTIONS;
        const nudged: Vec2 = [x + C1L6_MELODY_MARGIN * Math.cos(ang), z + C1L6_MELODY_MARGIN * Math.sin(ang)];
        if (!verifySolution(level, { ...p, [id]: nudged }).solved) failures.push(`${id} at ${k}`);
      }
    }
    expect(failures).toEqual([]);
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
