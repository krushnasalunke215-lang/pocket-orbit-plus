import { describe, expect, it } from 'vitest';
import { mulberry32 } from './random.js';
import { sampleStar, starColor, STAR_MAX_K, STAR_MIN_K, type StarSample } from './star-colors.js';

describe('starColor', () => {
  it('3,000 K is orange, 6,500 K near white, 20,000 K blue-white', () => {
    const c = [0, 0, 0];
    starColor(3000, c);
    expect(c[0]).toBeGreaterThan(c[1]);
    expect(c[1]).toBeGreaterThan(c[2]);
    starColor(6500, c);
    expect(Math.min(...c)).toBeGreaterThan(0.85);
    starColor(20000, c);
    expect(c[2]).toBeGreaterThan(c[0]);
    expect(Math.max(...c)).toBeCloseTo(1, 9);
  });
});

describe('sampleStar', () => {
  it('is deterministic per seed, in range, mostly faint with a few bright stars', () => {
    const draw = (seed: number) => {
      const random = mulberry32(seed);
      const out: StarSample = { temperature: 0, brightness: 0 };
      return Array.from({ length: 4000 }, () => ({ ...sampleStar(random, out) }));
    };
    const a = draw(42);
    expect(draw(42)).toEqual(a);
    expect(draw(43)).not.toEqual(a);
    for (const s of a) {
      expect(s.temperature).toBeGreaterThanOrEqual(STAR_MIN_K);
      expect(s.temperature).toBeLessThanOrEqual(STAR_MAX_K);
      expect(s.brightness).toBeGreaterThanOrEqual(0);
      expect(s.brightness).toBeLessThanOrEqual(1);
    }
    const faint = a.filter((s) => s.brightness < 0.3).length / a.length;
    const bright = a.filter((s) => s.brightness > 0.7).length / a.length;
    expect(faint).toBeGreaterThan(0.75);
    expect(bright).toBeGreaterThan(0.01);
    expect(bright).toBeLessThan(0.1);
    // Bright stars run hotter than faint ones on average.
    const mean = (list: StarSample[]) => list.reduce((sum, s) => sum + s.temperature, 0) / list.length;
    expect(mean(a.filter((s) => s.brightness > 0.5))).toBeGreaterThan(mean(a.filter((s) => s.brightness < 0.1)));
  });
});
