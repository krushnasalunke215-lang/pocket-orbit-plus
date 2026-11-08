import { describe, expect, it } from 'vitest';
import {
  addWell,
  classifyHit,
  clampHeight,
  heightStep,
  jitterMm,
  MAX_OBJECT_HEIGHT_M,
  MAX_WELL_MASS,
  MAX_WELLS,
  MIN_OBJECT_HEIGHT_M,
  MIN_WELL_MASS,
  PUCK_HEIGHT_M,
  wellFromBoardPoint,
  wellMassForHeight,
} from './real-object.js';

describe('real-object wells', () => {
  it('maps height to mass monotonically within the clamp', () => {
    expect(MIN_OBJECT_HEIGHT_M).toBe(0.015);
    expect(MAX_OBJECT_HEIGHT_M).toBe(0.3);
    expect(wellMassForHeight(MIN_OBJECT_HEIGHT_M)).toBeCloseTo(MIN_WELL_MASS, 12);
    expect(wellMassForHeight(MAX_OBJECT_HEIGHT_M)).toBeCloseTo(MAX_WELL_MASS, 12);
    // Below and above the clamp, and nonsense heights, stay in range.
    expect(wellMassForHeight(0)).toBe(wellMassForHeight(MIN_OBJECT_HEIGHT_M));
    expect(wellMassForHeight(-1)).toBe(wellMassForHeight(MIN_OBJECT_HEIGHT_M));
    expect(wellMassForHeight(Number.NaN)).toBe(wellMassForHeight(MIN_OBJECT_HEIGHT_M));
    expect(wellMassForHeight(2)).toBe(wellMassForHeight(MAX_OBJECT_HEIGHT_M));
    let last = -Infinity;
    for (let h = MIN_OBJECT_HEIGHT_M; h <= MAX_OBJECT_HEIGHT_M + 1e-9; h += 0.005) {
      const m = wellMassForHeight(h);
      expect(m).toBeGreaterThan(last);
      last = m;
    }
  });

  it('gives a 16.3 cm cup about a default planet’s pull (0.03), a coaster 0.01, the tallest the black hole’s 0.06', () => {
    expect(wellMassForHeight(0.163)).toBeCloseTo(0.03, 3);
    expect(MIN_WELL_MASS).toBe(0.01);
    expect(MAX_WELL_MASS).toBe(0.06);
  });

  it('classifies hits: object, too low (the table) or off the board', () => {
    expect(classifyHit([0.3, 0.6, 0.6], 0.163)).toBe('object');
    expect(classifyHit([0.3, 0.05, 0.6], 0.01)).toBe('too-low');
    expect(classifyHit([0.3, 0, 0.6], 0)).toBe('too-low');
    expect(classifyHit([0.3, 0, 0.6], -0.02)).toBe('too-low');
    expect(classifyHit([0.3, 0, 0.6], Number.NaN)).toBe('too-low');
    expect(classifyHit([0.8, 0.5, 0.7], 0.12)).toBe('off-board');
    expect(classifyHit([1, 0.5, 0], 0.12)).toBe('object');
  });

  it('builds a board-plane well under the hit', () => {
    const well = wellFromBoardPoint('well-1', [0.3, 0.6, 0.62], 0.163);
    expect(well).toEqual({ id: 'well-1', position: [0.3, 0, 0.62], mass: wellMassForHeight(0.163), source: 'real-object' });
    expect(wellFromBoardPoint('well-2', [0, 0.2, 0], PUCK_HEIGHT_M, 'well-puck').source).toBe('well-puck');
  });

  it('holds at most MAX_WELLS wells and never mutates the list', () => {
    let list: ReturnType<typeof addWell> = [];
    for (let i = 1; i <= MAX_WELLS; i++) {
      const before = list!;
      list = addWell(before, wellFromBoardPoint(`well-${i}`, [0.1 * i, 0, 0.3], 0.1));
      expect(list).toHaveLength(i);
      expect(before).toHaveLength(i - 1);
    }
    expect(MAX_WELLS).toBe(3);
    expect(addWell(list!, wellFromBoardPoint('well-4', [0, 0, 0.5], 0.1))).toBeNull();
    expect(list).toHaveLength(3);
  });

  it('steps the height by 1 cm within the clamp', () => {
    expect(heightStep(0.05, 1)).toBeCloseTo(0.06, 12);
    expect(heightStep(0.05, 2)).toBeCloseTo(0.07, 12);
    expect(heightStep(0.05, -1)).toBeCloseTo(0.04, 12);
    expect(heightStep(0.02, -1)).toBe(MIN_OBJECT_HEIGHT_M);
    expect(heightStep(0.295, 1)).toBe(MAX_OBJECT_HEIGHT_M);
    let h = PUCK_HEIGHT_M;
    for (let i = 0; i < 10; i++) h = heightStep(h, 1);
    expect(h).toBe(0.15);
    expect(clampHeight(0.5)).toBe(MAX_OBJECT_HEIGHT_M);
  });

  it('measures hit jitter as the RMS distance from the mean in millimeters', () => {
    expect(jitterMm(new Float32Array(90), 0)).toBe(0);
    expect(jitterMm([0.1, 0.5, -1.7], 1)).toBe(0);
    // Identical hits (the emulator's exact geometry): no jitter.
    const same = new Float64Array(30 * 3);
    for (let i = 0; i < 30; i++) same.set([0.075, 0.587, -1.746], i * 3);
    expect(jitterMm(same, 30)).toBeCloseTo(0, 9);
    // Two points 4 mm apart: each 2 mm from the mean.
    expect(jitterMm([0, 0, 0, 0.004, 0, 0], 2)).toBeCloseTo(2, 9);
    // Only the first `count` samples count.
    expect(jitterMm([0, 0, 0, 0.004, 0, 0, 1, 1, 1], 2)).toBeCloseTo(2, 9);
  });
});
