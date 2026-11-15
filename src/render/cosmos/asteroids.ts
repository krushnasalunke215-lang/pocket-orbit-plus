import { BufferAttribute, Euler, Group, IcosahedronGeometry, InstancedMesh, Matrix4, Quaternion, Vector3, type BufferGeometry } from '@iwsdk/core';
import { noRaycast } from '../shaders/common.js';
import { createCosmosPlanetMaterial } from '../shaders/cosmos.js';
import { planetAttributes, TILE, type PlanetLook } from './planets.js';
import { mulberry32 } from './random.js';

/*
 * The asteroid belt: one InstancedMesh of lumpy rocks (one seeded,
 * displaced icosphere baked once at module init, varied per rock by a
 * seeded size, stretch and turn) in a ring 2.5-4 m around the cosmos
 * center, slightly tilted, about 0.25 m below eye level (setEyeHeight). The
 * realistic planet material lights them from the sun with the moon and
 * mercury atlas tiles and a strong bump. The whole belt turns about its
 * axis on the decorative clock; no per-rock writes per frame.
 */

const SPIN = 0.012;
const ROCK_FALLBACKS = [0x5c544a, 0x6b5e50, 0x4e4a46, 0x625648];

/** Radius of the rock surface along unit direction (x, y, z): 0.75-1.15, smooth. */
function rockRadius(lumps: readonly number[], x: number, y: number, z: number): number {
  let r = 0;
  for (let k = 0; k < lumps.length; k += 4) {
    const d = lumps[k] * x + lumps[k + 1] * y + lumps[k + 2] * z;
    r += lumps[k + 3] * Math.max(0, d) ** 3;
  }
  return r;
}

/** IcosahedronGeometry(1, 1) displaced along each direction by seeded lumps, with smooth normals. */
function bakeRockGeometry(seed: number): BufferGeometry {
  const geometry = new IcosahedronGeometry(1, 1);
  const random = mulberry32(seed);
  const lumps: number[] = [];
  for (let k = 0; k < 9; k++) {
    const z = random() * 2 - 1;
    const a = random() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    lumps.push(Math.cos(a) * s, Math.sin(a) * s, z, (random() - 0.4) * 0.9);
  }
  const pos = geometry.getAttribute('position') as BufferAttribute;
  const radii = new Float32Array(pos.count);
  let lo = Infinity;
  let hi = -Infinity;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    radii[i] = rockRadius(lumps, v.x, v.y, v.z);
    lo = Math.min(lo, radii[i]);
    hi = Math.max(hi, radii[i]);
  }
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    v.multiplyScalar(0.75 + (0.4 * (radii[i] - lo)) / Math.max(1e-6, hi - lo));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  // Smooth normals: average the face normals of every corner at the same point.
  const normals = new Float32Array(pos.count * 3);
  const sums = new Map<string, Vector3>();
  const key = (i: number) => `${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    const n = new Vector3().subVectors(c, b).cross(a.clone().sub(b));
    for (let j = 0; j < 3; j++) {
      const k = key(i + j);
      const sum = sums.get(k);
      if (sum) sum.add(n);
      else sums.set(k, n.clone());
    }
  }
  for (let i = 0; i < pos.count; i++) {
    const n = sums.get(key(i))!.normalize();
    normals.set([n.x, n.y, n.z], i * 3);
  }
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  pos.needsUpdate = true;
  return geometry;
}

export interface AsteroidBelt {
  readonly root: Group;
  /** Eye height above the cosmos center (meters): the belt sits 0.25 m below it. */
  setEyeHeight(h: number): void;
  update(motionT: number): void;
  /** The belt's current turn (rad). */
  yaw(): number;
}

export function createAsteroidBelt(count: number): AsteroidBelt {
  const root = new Group();
  root.name = 'AsteroidBelt';
  root.rotation.set(0.07, 0, 0.05);
  const spinner = new Group();
  root.add(spinner);

  const geometry = bakeRockGeometry(0x0a57e0);
  const random = mulberry32(0xa57e);
  const m = new Matrix4();
  const q = new Quaternion();
  const e = new Euler();
  const p = new Vector3();
  const s = new Vector3();
  const looks: PlanetLook[] = [];
  const rocks = new InstancedMesh(geometry, createCosmosPlanetMaterial({ pulseScale: { value: 0 }, albedo: 0.42 }), count);
  rocks.name = 'AsteroidRocks';
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + (random() - 0.5) * 0.09;
    const r = 2.5 + 1.5 * random() ** 0.8;
    const size = 0.035 + 0.11 * random() ** 2.2;
    p.set(Math.sin(a) * r, (random() - 0.5) * 0.24, -Math.cos(a) * r);
    q.setFromEuler(e.set(random() * 6.28, random() * 6.28, random() * 6.28));
    s.set(size * (0.75 + 0.5 * random()), size * (0.6 + 0.4 * random()), size * (0.75 + 0.5 * random()));
    m.compose(p, q, s);
    rocks.setMatrixAt(i, m);
    looks.push({
      tile: random() < 0.5 ? TILE.moon : TILE.mercury,
      atmo: 0,
      atmoStrength: 0,
      bump: 0.18,
      glint: 0,
      night: 0.01,
      fallback: ROCK_FALLBACKS[Math.floor(random() * ROCK_FALLBACKS.length)],
    });
  }
  planetAttributes(geometry, looks);
  rocks.renderOrder = -7.5;
  rocks.frustumCulled = false;
  rocks.raycast = noRaycast;
  spinner.add(rocks);

  return {
    root,
    setEyeHeight(h) {
      root.position.y = h - 0.25;
    },
    update(motionT) {
      spinner.rotation.y = motionT * SPIN;
    },
    yaw() {
      return spinner.rotation.y;
    },
  };
}
