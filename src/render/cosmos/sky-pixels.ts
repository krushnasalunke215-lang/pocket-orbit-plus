/*
 * The comic nebula sky, baked once at init into RGBA8 pixels of an
 * equirectangular texture (SphereGeometry UVs: u around from -X, v = 1 at
 * the top; row 0 is the bottom). Seeded 3D value-noise fbm on the view
 * direction (so there is no seam and no pole pinch) is posterized into four
 * printed tones: deep navy, violet, then magenta or teal clouds, with a
 * brighter galactic band, ink lines around the bright clouds and halftone
 * dots leading into each tone. Pure: imports nothing, deterministic.
 */

const TAU = Math.PI * 2;

/** sRGB tones, darkest first; the two cloud tones come in a magenta and a teal family. */
const NAVY = [9, 12, 38];
const VIOLET = [40, 24, 92];
const MAGENTA = [150, 42, 128];
const MAGENTA_HOT = [214, 84, 156];
const TEAL = [24, 128, 150];
const TEAL_HOT = [52, 178, 186];
const INK = [5, 6, 16];
const MAGENTA_TONES = [NAVY, VIOLET, MAGENTA, MAGENTA_HOT];
const TEAL_TONES = [NAVY, VIOLET, TEAL, TEAL_HOT];
/** Field thresholds between the four tones. */
const T1 = 0.46;
const T2 = 0.6;
const T3 = 0.76;
/** Halftone dots grow over this field range below each threshold. */
const DOT_RAMP = 0.07;
/** Dot rows pole to pole (about 2.5 degrees apart). */
const DOT_ROWS = 72;

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  let fx = x - ix;
  let fy = y - iy;
  let fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const a = hash3(ix, iy, iz, seed);
  const b = hash3(ix + 1, iy, iz, seed);
  const c = hash3(ix, iy + 1, iz, seed);
  const d = hash3(ix + 1, iy + 1, iz, seed);
  const e = hash3(ix, iy, iz + 1, seed);
  const f = hash3(ix + 1, iy, iz + 1, seed);
  const g = hash3(ix, iy + 1, iz + 1, seed);
  const h = hash3(ix + 1, iy + 1, iz + 1, seed);
  const x0 = a + (b - a) * fx;
  const x1 = c + (d - c) * fx;
  const x2 = e + (f - e) * fx;
  const x3 = g + (h - g) * fx;
  const y0 = x0 + (x1 - x0) * fy;
  const y1 = x2 + (x3 - x2) * fy;
  return y0 + (y1 - y0) * fz;
}

function fbm(x: number, y: number, z: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise3(x, y, z, seed + o * 1013);
    norm += amp;
    amp *= 0.5;
    x *= 2.03;
    y *= 2.03;
    z *= 2.03;
  }
  return sum / norm;
}

/** Direction of texture coordinate (u, v) on three's SphereGeometry. */
function direction(u: number, v: number, out: number[]): void {
  const phi = u * TAU;
  const theta = (1 - v) * Math.PI;
  const s = Math.sin(theta);
  out[0] = -Math.cos(phi) * s;
  out[1] = Math.cos(theta);
  out[2] = Math.sin(phi) * s;
}

/** Distance in cell units to the nearest halftone dot (rows evenly spaced, dots evenly spaced per row). */
function halftone(dx: number, dy: number, dz: number): number {
  const lat = Math.asin(Math.max(-1, Math.min(1, dy)));
  const r = (lat * DOT_ROWS) / Math.PI;
  const row = Math.floor(r + 0.5);
  const latC = (row * Math.PI) / DOT_ROWS;
  const n = Math.max(1, Math.floor(Math.cos(latC) * DOT_ROWS * 2 + 0.5));
  const lon = (Math.atan2(dz, dx) / TAU + 0.5) * n;
  const col = Math.floor(lon + 0.5);
  const ex = ((lon - col) * 2 * DOT_ROWS * Math.cos(lat)) / n;
  return Math.hypot(ex, r - row);
}

/**
 * RGBA8 pixels (width * height * 4) of the sky for `seed`. The noise fields
 * are evaluated on a half-resolution grid and interpolated, so a 1024 x 512
 * bake costs about a quarter of a full-resolution one.
 */
export function bakeSkyPixels(width: number, height: number, seed: number): Uint8Array {
  const gw = Math.ceil(width / 2) + 1;
  const gh = Math.ceil(height / 2) + 1;
  const field = new Float32Array(gw * gh);
  const hue = new Float32Array(gw * gh);
  const d = [0, 0, 0];
  // The galactic band: a great circle tilted across the sky.
  const gx = 0.32;
  const gy = 0.87;
  const gz = -0.37;
  const gl = Math.hypot(gx, gy, gz);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      direction(i / (gw - 1), j / (gh - 1), d);
      const [x, y, z] = d;
      // Domain warp makes the clouds swirl.
      const wx = fbm(x * 1.4 + 11.3, y * 1.4, z * 1.4, 3, seed) - 0.5;
      const wy = fbm(x * 1.4, y * 1.4 + 7.1, z * 1.4, 3, seed + 77) - 0.5;
      const n = fbm(x * 2.1 + wx * 1.6, y * 2.1 + wy * 1.6, z * 2.1 - wx, 4, seed + 191);
      const along = (x * gx + y * gy + z * gz) / gl;
      const band = Math.exp(-(along * along) / (0.2 * 0.2));
      field[j * gw + i] = n * 0.84 + band * (0.14 + 0.3 * n);
      hue[j * gw + i] = noise3(x * 1.3 + 3.7, y * 1.3, z * 1.3 - 5.2, seed + 409);
    }
  }

  const sample = (grid: Float32Array, u: number, v: number): number => {
    const fx = u * (gw - 1);
    const fy = v * (gh - 1);
    const x0 = Math.min(gw - 2, Math.floor(fx));
    const y0 = Math.min(gh - 2, Math.floor(fy));
    const tx = fx - x0;
    const ty = fy - y0;
    const k = y0 * gw + x0;
    const top = grid[k] + (grid[k + 1] - grid[k]) * tx;
    const bottom = grid[k + gw] + (grid[k + gw + 1] - grid[k + gw]) * tx;
    return top + (bottom - top) * ty;
  };

  // Tone index and field per pixel first (the ink pass reads neighbours).
  const tones = new Uint8Array(width * height);
  const values = new Float32Array(width * height);
  const hues = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const f = sample(field, u, v);
      const k = y * width + x;
      values[k] = f;
      hues[k] = sample(hue, u, v);
      tones[k] = f < T1 ? 0 : f < T2 ? 1 : f < T3 ? 2 : 3;
    }
  }

  const out = new Uint8Array(width * height * 4);
  const put = (k: number, c: readonly number[]) => {
    out[k * 4] = c[0];
    out[k * 4 + 1] = c[1];
    out[k * 4 + 2] = c[2];
    out[k * 4 + 3] = 255;
  };
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const k = y * width + x;
      const tone = tones[k];
      const palette = hues[k] > 0.52 ? TEAL_TONES : MAGENTA_TONES;
      // Ink line where a bright cloud (tone 2+) meets a darker tone.
      if (tone >= 2) {
        const left = tones[y * width + ((x + width - 1) % width)];
        const right = tones[y * width + ((x + 1) % width)];
        const down = y > 0 ? tones[k - width] : tone;
        const up = y < height - 1 ? tones[k + width] : tone;
        if (left < 2 || right < 2 || down < 2 || up < 2) {
          put(k, INK);
          continue;
        }
      }
      // Halftone dots of the next tone just below each threshold.
      const f = values[k];
      const next = tone === 0 ? T1 : tone === 1 ? T2 : tone === 2 ? T3 : 2;
      const toNext = (f - (next - DOT_RAMP)) / DOT_RAMP;
      if (tone < 3 && toNext > 0) {
        direction((x + 0.5) / width, v, d);
        const dist = halftone(d[0], d[1], d[2]);
        if (dist < 0.55 * Math.sqrt(toNext)) {
          put(k, palette[tone + 1]);
          continue;
        }
      }
      put(k, palette[tone]);
    }
  }
  return out;
}
