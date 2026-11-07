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

/** Parking spots on the rim for the one-body guard. */
const RIM_PARK_RADIUS = 0.9;
const RIM_PARK_PATH_CLEARANCE = 0.15;
const RIM_PARK_MIN_SEPARATION_DEG = 30;

/**
 * Four rim points at radius 0.9 for parking the unused body: outside the
 * reserved sector, at least 0.15 from every sample of the stored solution's
 * flight, picked farthest from that flight first and at least 30° apart.
 */
function rimParkingPoints(level: LevelDef): Vec2[] {
  const path = simulate(level, level.solution, { recordEvery: 1 });
  const pathDistance = ([x, z]: Vec2) => {
    let best = Infinity;
    for (let i = 0; i < path.sampleCount; i++) {
      best = Math.min(best, Math.hypot(path.samples[i * 3] - x, path.samples[i * 3 + 2] - z));
    }
    return best;
  };
  const candidates: { deg: number; p: Vec2; d: number }[] = [];
  for (let deg = -175; deg <= 180; deg += 5) {
    const a = (deg * Math.PI) / 180;
    const p: Vec2 = [RIM_PARK_RADIUS * Math.sin(a), RIM_PARK_RADIUS * Math.cos(a)];
    const d = pathDistance(p);
    if (!inReservedSector(p) && d >= RIM_PARK_PATH_CLEARANCE) candidates.push({ deg, p, d });
  }
  candidates.sort((a, b) => b.d - a.d || a.deg - b.deg);
  const picked: typeof candidates = [];
  const apart = (a: number, b: number) => {
    const diff = Math.abs(a - b) % 360;
    return Math.min(diff, 360 - diff) >= RIM_PARK_MIN_SEPARATION_DEG;
  };
  for (const c of candidates) {
    if (picked.length < 4 && picked.every((q) => apart(q.deg, c.deg))) picked.push(c);
  }
  return picked.map((c) => c.p);
}

const MULTI_BODY_LEVELS = ALL_LEVELS.filter((l) => Object.keys(startPlacements(l)).length >= 2);

/** Levels with two movable bodies where one body alone may solve (see the guard below). */
const ONE_BODY_SOLVE_EXCEPTIONS = new Set(['c1-l6']);

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

  it.each(MULTI_BODY_LEVELS.map((l) => l.id))('%s has four rim parking points for the one-body guard', (id) => {
    expect(rimParkingPoints(getLevel(id)!)).toHaveLength(4);
  });

  // One-body guard: with every other movable body parked at its tray start or
  // on the rim out of the flight's way, moving one body alone never solves.
  // c1-l2's tray-start case is the finer 0.01-grid test above.
  //
  // Documented exception: c1-l6 "Light and Dark" gets only the tray-start
  // guard. Once the white star is moved out of the way, the planet alone can
  // reach the target, so a 1-star solve may use the planet alone; 3 stars
  // (the melody p1, w1, hole) need both bodies, which the test after this
  // one checks.
  const guardCases = MULTI_BODY_LEVELS.flatMap((level) => {
    const start = startPlacements(level);
    const ids = Object.keys(start);
    const parkings: [string, Vec2 | null][] = [
      ...(level.id === 'c1-l2' ? [] : [['its tray start', null] as [string, null]]),
      ...(ONE_BODY_SOLVE_EXCEPTIONS.has(level.id) ? [] : rimParkingPoints(level))
        .map((p): [string, Vec2] => [`rim [${p[0].toFixed(3)}, ${p[1].toFixed(3)}]`, p]),
    ];
    return ids.flatMap((moved) =>
      ids
        .filter((other) => other !== moved)
        .flatMap((other) =>
          parkings.map(([label, p]) => [level.id, moved, other, label, p] as const),
        ),
    );
  });
  it.each(guardCases)(
    '%s: no solution moving only %s with %s parked at %s (0.02 grid)',
    (levelId, moved, other, _label, park) => {
      const level = getLevel(levelId)!;
      const start = startPlacements(level);
      const fixed: Record<string, Vec2> = {};
      for (const id of Object.keys(start)) if (id !== moved) fixed[id] = start[id];
      if (park) fixed[other] = park;
      const found = solveLevel(level, { step: 0.02, fixed, requireRobust: false, maxSolutions: 1 });
      expect(found.map((s) => s.placements[moved])).toEqual([]);
    },
    60_000,
  );

  // The exception's promise: no planet-only placement earns 3 stars. With the
  // white star in its tray or parked on the rim (same grid and parking points
  // as the guard), no solving planet placement rings the melody.
  const c1l6 = getLevel('c1-l6')!;
  const c1l6Parkings: [string, Vec2][] = [
    ['its tray start', startPlacements(c1l6).w1],
    ...rimParkingPoints(c1l6).map((p): [string, Vec2] => [`rim [${p[0].toFixed(3)}, ${p[1].toFixed(3)}]`, p]),
  ];
  it.each(c1l6Parkings)(
    'c1-l6: no planet-only solve rings the 3-star melody with w1 parked at %s (0.02 grid)',
    (_label, park) => {
      expect(c1l6.melody).toEqual(['p1', 'w1', 'hole']);
      const found = solveLevel(c1l6, { step: 0.02, fixed: { w1: park }, requireRobust: false });
      const threeStar = found.filter((s) => matchesMelody(c1l6, s.result.flybys)).map((s) => s.placements.p1);
      expect(threeStar).toEqual([]);
    },
    60_000,
  );
});
