import { describe, expect, it } from 'vitest';
import { bakeSkyPixels } from './sky-pixels.js';

describe('bakeSkyPixels', () => {
  it('is deterministic per seed and sized width * height * 4', () => {
    const a = bakeSkyPixels(64, 32, 7);
    const b = bakeSkyPixels(64, 32, 7);
    const c = bakeSkyPixels(64, 32, 8);
    expect(a.length).toBe(64 * 32 * 4);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
    // Opaque, and more than one printed tone.
    for (let i = 3; i < a.length; i += 4) expect(a[i]).toBe(255);
    const colors = new Set<number>();
    for (let i = 0; i < a.length; i += 4) colors.add((a[i] << 16) | (a[i + 1] << 8) | a[i + 2]);
    expect(colors.size).toBeGreaterThanOrEqual(3);
  });

  it('bakes 1024 x 512 in under 1.5 s', () => {
    const started = performance.now();
    const pixels = bakeSkyPixels(1024, 512, 0x5eed);
    const ms = performance.now() - started;
    console.log(`bakeSkyPixels 1024x512: ${ms.toFixed(0)} ms`);
    expect(pixels.length).toBe(1024 * 512 * 4);
    expect(ms).toBeLessThan(1500);
  });
});
