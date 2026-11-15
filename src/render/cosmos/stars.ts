import {
  BufferAttribute,
  BufferGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  PlaneGeometry,
  Points,
} from '@iwsdk/core';
import { noRaycast } from '../shaders/common.js';
import { createGlintMaterial, createStarPointsMaterial } from '../shaders/cosmos.js';
import { mulberry32, randomDirection } from './random.js';
import { GALAXY_CORE, GALAXY_NORMAL } from './sky-pixels.js';
import { sampleStar, starColor, type StarSample } from './star-colors.js';

/*
 * The star field at infinity, in the cosmos frame (meters):
 *   CosmosStars: one Points draw of `count` fine stars on a 55 m shell
 *     (inside the 60 m sky dome, behind every planet), about 40% gathered
 *     toward the Milky Way band (GALAXY_NORMAL); blackbody colours and a
 *     power-law brightness (star-colors.ts); 1.4-3.2 px.
 *   CosmosGlints (`glints`): one instanced billboard pool on the GLINT_COUNT
 *     brightest stars: a soft core and four thin diffraction spikes whose
 *     length grows with brightness. Drawn after the planets so their depth
 *     hides the glints behind them.
 */

export const STAR_SHELL = 55;
const GLINT_COUNT = 40;
const BAND_FRACTION = 0.4;
const SEED = 0x5eed;

/** A standard normal sample (Box-Muller). */
function gaussian(random: () => number): number {
  const u = Math.max(1e-9, random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

export function createStars(count: number, glints: boolean): Group {
  const random = mulberry32(SEED);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const brightness = new Float32Array(count);
  const [nx, ny, nz] = GALAXY_NORMAL;
  const [cx, cy, cz] = GALAXY_CORE;
  // The band's second in-plane axis: normal x core.
  const ex = ny * cz - nz * cy;
  const ey = nz * cx - nx * cz;
  const ez = nx * cy - ny * cx;
  const d = [0, 0, 0];
  const c = [0, 0, 0];
  const star: StarSample = { temperature: 0, brightness: 0 };
  for (let i = 0; i < count; i++) {
    if (random() < BAND_FRACTION) {
      const a = random() * Math.PI * 2;
      const h = gaussian(random) * 0.12;
      d[0] = cx * Math.cos(a) + ex * Math.sin(a) + nx * h;
      d[1] = cy * Math.cos(a) + ey * Math.sin(a) + ny * h;
      d[2] = cz * Math.cos(a) + ez * Math.sin(a) + nz * h;
      const l = Math.hypot(d[0], d[1], d[2]);
      d[0] /= l;
      d[1] /= l;
      d[2] /= l;
    } else randomDirection(random, d);
    positions[i * 3] = d[0] * STAR_SHELL;
    positions[i * 3 + 1] = d[1] * STAR_SHELL;
    positions[i * 3 + 2] = d[2] * STAR_SHELL;
    sampleStar(random, star);
    starColor(star.temperature, c);
    // Linear intensity: faint stars barely above the sky, the brightest burn.
    const intensity = 0.07 + 1.9 * star.brightness;
    colors[i * 3] = c[0] * intensity;
    colors[i * 3 + 1] = c[1] * intensity;
    colors[i * 3 + 2] = c[2] * intensity;
    sizes[i] = 1.4 + 1.8 * Math.sqrt(star.brightness);
    phases[i] = random();
    brightness[i] = star.brightness;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new BufferAttribute(phases, 1));
  const points = new Points(geometry, createStarPointsMaterial());
  points.name = 'CosmosStarField';
  points.frustumCulled = false;
  points.renderOrder = -9;
  points.raycast = noRaycast;

  const root = new Group();
  root.name = 'CosmosStars';
  root.add(points);
  if (glints) root.add(glintLayer(positions, colors, brightness));
  return root;
}

function glintLayer(positions: Float32Array, colors: Float32Array, brightness: Float32Array): InstancedMesh {
  const order = Array.from(brightness.keys()).sort((a, b) => brightness[b] - brightness[a]);
  const n = Math.min(GLINT_COUNT, order.length);
  const offsets = new Float32Array(n * 3);
  const tints = new Float32Array(n * 3);
  const sizes = new Float32Array(n);
  const spikes = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const i = order[k];
    const b = brightness[i];
    offsets.set(positions.subarray(i * 3, i * 3 + 3), k * 3);
    // The core is the point star's; the glint adds a soft halo and the spikes, a little dimmer.
    tints[k * 3] = colors[i * 3] * 0.6;
    tints[k * 3 + 1] = colors[i * 3 + 1] * 0.6;
    tints[k * 3 + 2] = colors[i * 3 + 2] * 0.6;
    // Half-size in meters at 55 m: about 0.35-0.9 m (spikes of roughly 10-25 px on a Quest).
    sizes[k] = 0.35 + 0.55 * b;
    spikes[k] = 0.5 + 0.5 * b;
  }
  const geometry = new PlaneGeometry(2, 2);
  geometry.setAttribute('aOffset', new InstancedBufferAttribute(offsets, 3));
  geometry.setAttribute('aColor', new InstancedBufferAttribute(tints, 3));
  geometry.setAttribute('aSize', new InstancedBufferAttribute(sizes, 1));
  geometry.setAttribute('aSpike', new InstancedBufferAttribute(spikes, 1));
  const mesh = new InstancedMesh(geometry, createGlintMaterial(), n);
  mesh.name = 'CosmosGlints';
  mesh.frustumCulled = false;
  // After the planets, so their depth hides the glints behind them.
  mesh.renderOrder = -6.5;
  mesh.raycast = noRaycast;
  return mesh;
}
