import { describe, expect, it } from 'vitest';
import { bakeSkyPixels, GALAXY_CORE, GALAXY_NORMAL } from './sky-pixels.js';

/** Mean sRGB luminance (0..1) of the rows whose latitude (radians) passes `keep`. */
function meanLuminance(pixels: Uint8Array, width: number, height: number, keep: (lat: number) => boolean): number {
  let sum = 0;
  let count = 0;
  for (let y = 0; y < height; y++) {
    const lat = ((y + 0.5) / height - 0.5) * Math.PI;
    if (!keep(lat)) continue;
    for (let x = 0; x < width; x++) {
      const k = (y * width + x) * 4;
      sum += (0.2126 * pixels[k] + 0.7152 * pixels[k + 1] + 0.0722 * pixels[k + 2]) / 255;
      count++;
    }
  }
  return sum / count;
}

describe('bakeSkyPixels', () => {
  it('is deterministic per seed, opaque and sized width * height * 4', () => {
    const a = bakeSkyPixels(64, 32, 7);
    const b = bakeSkyPixels(64, 32, 7);
    const c = bakeSkyPixels(64, 32, 8);
    expect(a.length).toBe(64 * 32 * 4);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
    for (let i = 3; i < a.length; i += 4) expect(a[i]).toBe(255);
  });

  it('is near-black deep space with the band brighter than 60 degrees off it', () => {
    const w = 256;
    const h = 128;
    const pixels = bakeSkyPixels(w, h, 0x5eed);
    const mean = meanLuminance(pixels, w, h, () => true);
    const band = meanLuminance(pixels, w, h, (lat) => Math.abs(lat) < (5 * Math.PI) / 180);
    const off = meanLuminance(pixels, w, h, (lat) => Math.abs(Math.abs(lat) - Math.PI / 3) < (5 * Math.PI) / 180);
    expect(mean).toBeLessThan(0.06);
    expect(band).toBeGreaterThan(off * 1.5);
  });

  it('bakes 512 x 256 in under 400 ms', () => {
    const started = performance.now();
    const pixels = bakeSkyPixels(512, 256, 0x5eed);
    const ms = performance.now() - started;
    console.log(`bakeSkyPixels 512x256: ${ms.toFixed(0)} ms`);
    expect(pixels.length).toBe(512 * 256 * 4);
    expect(ms).toBeLessThan(400);
  });

  it('puts the galactic core on the band (unit vectors, perpendicular)', () => {
    const dot = GALAXY_CORE[0] * GALAXY_NORMAL[0] + GALAXY_CORE[1] * GALAXY_NORMAL[1] + GALAXY_CORE[2] * GALAXY_NORMAL[2];
    expect(Math.abs(dot)).toBeLessThan(1e-9);
    expect(Math.hypot(...GALAXY_NORMAL)).toBeCloseTo(1, 9);
    expect(Math.hypot(...GALAXY_CORE)).toBeCloseTo(1, 9);
  });
});
