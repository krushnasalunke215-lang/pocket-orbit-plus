/*
 * The procedural fallback sky (shown until the Milky Way panorama loads,
 * and under it if the load fails), baked once at init into RGBA8 sRGB
 * pixels of an equirectangular texture (SphereGeometry UVs: u around from
 * -X, v = 1 at the top; row 0 is the bottom). Realistic deep space: a
 * near-black base (RGB 2-5), a soft Milky Way band along the dome's local
 * equator (fbm brightness, ridged-noise dark dust lanes, a warm core toward
 * the dome's local +X, a grain of unresolved star clouds) and faint
 * desaturated wisps elsewhere. That is the same layout as the vendored
 * panorama, so the two cross-fade without a jump; cosmos-visual.ts turns
 * the dome so local +Y is GALAXY_NORMAL and local +X is GALAXY_CORE.
 * Seeded value-noise fbm on the view direction (no seam, no pole pinch).
 * Pure: imports nothing, deterministic.
 */

const TAU = Math.PI * 2;

function normalize3(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

/**
 * Normal of the Milky Way's great circle in the cosmos frame (board frame:
 * -Z ahead, +Y up). Close to the sun direction, so the band crosses the sky
 * diagonally (front-left horizon, near the zenith, back-right) and stays
 * about 85 degrees away from the sun.
 */
export const GALAXY_NORMAL: readonly [number, number, number] = normalize3(0.66, 0.52, -0.54);

/** The galactic core's direction (cosmos frame, on the band): front-left, about 30 degrees up. */
export const GALAXY_CORE: readonly [number, number, number] = (() => {
  const [nx, ny, nz] = GALAXY_NORMAL;
  const c = [-0.6, 0.45, -0.75];
  const k = c[0] * nx + c[1] * ny + c[2] * nz;
  return normalize3(c[0] - k * nx, c[1] - k * ny, c[2] - k * nz);
})();

/** sRGB colors (0-255). */
const BASE = [3, 4, 6];
const BAND = [40, 44, 56];
const CORE = [74, 62, 48];
const WISP = [10, 11, 14];

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

/** Ridged fbm: 1 along the noise's mid-level creases (the dust lanes), 0 elsewhere. */
function ridged(x: number, y: number, z: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(2 * noise3(x, y, z, seed + o * 733) - 1);
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    x *= 2.11;
    y *= 2.11;
    z *= 2.11;
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

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * RGBA8 sRGB pixels (width * height * 4) of the sky for `seed`. The noise
 * fields are evaluated on a half-resolution grid and interpolated; only the
 * star-cloud grain is per pixel.
 */
export function bakeSkyPixels(width: number, height: number, seed: number): Uint8Array {
  const gw = Math.ceil(width / 2) + 1;
  const gh = Math.ceil(height / 2) + 1;
  const n = gw * gh;
  const bandField = new Float32Array(n);
  const coreField = new Float32Array(n);
  const wispField = new Float32Array(n);
  const d = [0, 0, 0];
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      direction(i / (gw - 1), j / (gh - 1), d);
      const [x, y, z] = d;
      const k = j * gw + i;
      // The band: local equator, its width breathing with low-frequency noise.
      const width = 0.2 + 0.12 * fbm(x * 1.6 + 4.1, y * 1.6, z * 1.6, 2, seed + 11);
      const lat = (y + 0.05 * (fbm(x * 2.4, z * 2.4, 3.3, 2, seed + 23) - 0.5)) / width;
      const envelope = Math.exp(-lat * lat);
      const clouds = fbm(x * 3.2, y * 3.2 + 1.7, z * 3.2, 5, seed + 191);
      const lanes = ridged(x * 2.6 + 9.2, y * 6.5, z * 2.6, 3, seed + 307);
      const laneCut = 1 - 0.6 * smooth(0.45, 0.9, lanes) * smooth(0.25, 0.8, envelope);
      bandField[k] = envelope * (0.2 + 0.8 * smooth(0.3, 0.8, clouds)) * laneCut;
      // The core: toward local +X, flattened along the band.
      const along = Math.acos(Math.max(-1, Math.min(1, x)));
      coreField[k] = Math.exp(-(along * along) / (0.6 * 0.6)) * Math.exp(-(y * y) / (0.16 * 0.16)) * laneCut;
      // Faint wisps everywhere else.
      const w = fbm(x * 2.2 + 13.1, y * 2.2, z * 2.2 - 3.3, 4, seed + 577);
      wispField[k] = smooth(0.52, 0.8, w) * (1 - envelope);
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

  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const band = sample(bandField, u, v);
      const core = sample(coreField, u, v);
      const wisp = sample(wispField, u, v);
      // Unresolved star clouds: per-pixel grain, stronger inside the band.
      const grain = hash3(x, y, 7, seed + 911);
      const sparkle = grain > 0.985 ? 0.6 + 0.4 * band : 0.85 + 0.3 * grain;
      const k = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const value = BASE[c] + (BAND[c] * band + WISP[c] * wisp) * sparkle + CORE[c] * core;
        out[k + c] = Math.min(255, Math.round(value));
      }
      out[k + 3] = 255;
    }
  }
  return out;
}
