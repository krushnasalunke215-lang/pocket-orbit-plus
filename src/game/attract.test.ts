import { describe, expect, it } from 'vitest';
import { startPlacements } from '../sim/level.js';
import { ALL_LEVELS } from '../sim/levels/index.js';
import { simulate } from '../sim/simulate.js';
import { ATTRACT_FADE, ATTRACT_GAP, attractFrame, attractPeriod, flightPositionAt } from './attract.js';

const level = ALL_LEVELS[0];
const result = simulate(level, startPlacements(level));
const frame = () => ({ position: [0, 0, 0], alpha: -1 });

describe('attract loop', () => {
  it('flies the zero-move flight, which misses', () => {
    expect(result.outcome).not.toBe('solved');
    expect(attractPeriod(result)).toBeCloseTo(result.time + ATTRACT_FADE + ATTRACT_GAP, 12);
  });

  it('starts at the comet start, fully visible', () => {
    const f = attractFrame(result, 0, frame());
    expect(f.position[0]).toBeCloseTo(level.comet.position[0], 6);
    expect(f.position[1]).toBeCloseTo(level.comet.height ?? 0, 6);
    expect(f.position[2]).toBeCloseTo(level.comet.position[1], 6);
    expect(f.alpha).toBe(1);
  });

  it('follows the flight path at real speed', () => {
    const t = result.time * 0.5;
    const f = attractFrame(result, t, frame());
    const expected = flightPositionAt(result, t, [0, 0, 0]);
    expect(f.position).toEqual(expected);
    expect(f.alpha).toBe(1);
  });

  it('fades out at the flight end', () => {
    const end = flightPositionAt(result, result.time, [0, 0, 0]);
    const f = attractFrame(result, result.time + ATTRACT_FADE / 2, frame());
    expect(f.position).toEqual(end);
    expect(f.alpha).toBeCloseTo(0.5, 6);
  });

  it('is invisible during the gap', () => {
    for (const k of [0.05, 0.5, 0.95]) {
      const f = attractFrame(result, result.time + ATTRACT_FADE + ATTRACT_GAP * k, frame());
      expect(f.alpha).toBe(0);
    }
  });

  it('repeats every period', () => {
    const period = attractPeriod(result);
    // Away from the phase boundaries, where float rounding of t % period may tip either way.
    for (const t of [0.01, 0.37, result.time * 0.8, result.time + 0.3, period - 0.01]) {
      const a = attractFrame(result, t, frame());
      const b = attractFrame(result, t + 3 * period, frame());
      expect(b.alpha).toBeCloseTo(a.alpha, 9);
      for (let i = 0; i < 3; i++) expect(b.position[i]).toBeCloseTo(a.position[i], 5);
    }
  });
});
