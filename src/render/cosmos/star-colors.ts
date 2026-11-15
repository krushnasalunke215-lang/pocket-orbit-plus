/*
 * Star colours and the star population (pure: imports nothing).
 *   starColor(tempK, out): the colour of a blackbody at tempK (Tanner
 *     Helland's fit, sRGB, converted to linear RGB), normalized to max 1.
 *   sampleStar(random, out): one star of the field: a brightness from a
 *     power law (about 80% faint, a few percent bright) and a temperature
 *     from 2,800 to 30,000 K, weighted toward cool for faint stars and hot
 *     for bright ones (as a naked-eye sky looks).
 */

export const STAR_MIN_K = 2800;
export const STAR_MAX_K = 30000;

const clamp255 = (x: number): number => Math.min(255, Math.max(0, x));
const toLinear = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

/** Linear RGB of a blackbody at `tempK`, normalized so the largest channel is 1. */
export function starColor(tempK: number, out: number[]): number[] {
  const t = Math.min(400, Math.max(10, tempK / 100));
  const r = t <= 66 ? 255 : clamp255(329.698727446 * Math.pow(t - 60, -0.1332047592));
  const g = t <= 66 ? clamp255(99.4708025861 * Math.log(t) - 161.1195681661) : clamp255(288.1221695283 * Math.pow(t - 60, -0.0755148492));
  const b = t >= 66 ? 255 : t <= 19 ? 0 : clamp255(138.5177312231 * Math.log(t - 10) - 305.0447927307);
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const m = Math.max(lr, lg, lb, 1e-6);
  out[0] = lr / m;
  out[1] = lg / m;
  out[2] = lb / m;
  return out;
}

export interface StarSample {
  /** Kelvin. */
  temperature: number;
  /** 0..1 (the power law: most stars near 0). */
  brightness: number;
}

/** One star from `random` (uniform 0..1), written into `out`. */
export function sampleStar(random: () => number, out: StarSample): StarSample {
  const brightness = Math.pow(random(), 6);
  // Faint stars skew cool (exponent 4: median about 4,500 K), bright ones hot (exponent 1.3).
  const exponent = 4 - 2.7 * Math.min(1, brightness * 1.6);
  out.brightness = brightness;
  out.temperature = STAR_MIN_K + (STAR_MAX_K - STAR_MIN_K) * Math.pow(random(), exponent);
  return out;
}
