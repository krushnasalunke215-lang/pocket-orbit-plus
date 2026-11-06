import { BufferAttribute, BufferGeometry, Points, PointsMaterial } from '@iwsdk/core';
import { ROLE_COLORS } from './palette.js';
import type { Starfield } from './visual-types.js';

const STAR_COUNT = 1500;
const SKY_RADIUS = 40;
const SEED = 0x5eed;

/** Small deterministic PRNG (mulberry32) so the sky is the same every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const material = new PointsMaterial({
  color: ROLE_COLORS.star,
  size: 2,
  sizeAttenuation: false,
  transparent: true,
  opacity: 0.85,
  depthWrite: false,
  toneMapped: false,
});

/** About 1500 seeded stars on a 40 m sphere around the world origin. */
export function createStarfield(): Starfield {
  const random = mulberry32(SEED);
  const positions = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i++) {
    // Uniform direction on the sphere.
    const z = random() * 2 - 1;
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    positions[i * 3] = Math.cos(a) * r * SKY_RADIUS;
    positions[i * 3 + 1] = z * SKY_RADIUS;
    positions[i * 3 + 2] = Math.sin(a) * r * SKY_RADIUS;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  const root = new Points(geometry, material);
  root.name = 'Starfield';
  root.renderOrder = -10;
  return { root };
}
