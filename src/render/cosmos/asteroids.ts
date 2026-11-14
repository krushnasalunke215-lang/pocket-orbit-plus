import { Color, DodecahedronGeometry, Euler, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Quaternion, Vector3 } from '@iwsdk/core';
import { noRaycast } from '../shaders/common.js';
import { createCosmosInkMaterial, createCosmosSurfaceMaterial } from '../shaders/cosmos.js';
import { PULSE_SCALE } from './planets.js';
import { mulberry32 } from './random.js';

/*
 * The asteroid belt: one InstancedMesh of chunky low-poly rocks (seeded
 * size, stretch and turn) in a ring 2.5-4 m around the cosmos center,
 * slightly tilted, about 0.25 m below eye level (setEyeHeight). The whole
 * belt turns about its axis on the decorative clock; no per-rock writes per
 * frame. With ink, an instanced hull outlines every rock.
 */

const ROCK_COLORS = [0x7a6a9a, 0x8c6d58, 0x5e6a86, 0x9a7f6a];
const SPIN = 0.012;

export interface AsteroidBelt {
  readonly root: Group;
  /** Eye height above the cosmos center (meters): the belt sits 0.25 m below it. */
  setEyeHeight(h: number): void;
  update(motionT: number): void;
  /** The belt's current turn (rad). */
  yaw(): number;
}

export function createAsteroidBelt(count: number, ink: boolean): AsteroidBelt {
  const root = new Group();
  root.name = 'AsteroidBelt';
  root.rotation.set(0.07, 0, 0.05);
  const spinner = new Group();
  root.add(spinner);

  const geometry = new DodecahedronGeometry(1, 0);
  const random = mulberry32(0xa57e);
  const colors = new Float32Array(count * 3);
  const c = new Color();
  const m = new Matrix4();
  const q = new Quaternion();
  const e = new Euler();
  const p = new Vector3();
  const s = new Vector3();
  const rocks = new InstancedMesh(geometry, createCosmosSurfaceMaterial({ bands: 0, dotRows: 8, pulseScale: { value: 0 } }), count);
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
    c.setHex(ROCK_COLORS[Math.floor(random() * ROCK_COLORS.length)]);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('aColor', new InstancedBufferAttribute(colors, 3));
  geometry.setAttribute('aBand', new InstancedBufferAttribute(colors.slice(), 3));
  geometry.setAttribute('aPulse', new InstancedBufferAttribute(new Float32Array(count), 1));
  rocks.renderOrder = -7.5;
  rocks.frustumCulled = false;
  rocks.raycast = noRaycast;
  spinner.add(rocks);
  if (ink) {
    const hull = new InstancedMesh(geometry, createCosmosInkMaterial(0.14, PULSE_SCALE), count);
    hull.name = 'AsteroidInk';
    hull.instanceMatrix = rocks.instanceMatrix;
    hull.renderOrder = -8;
    hull.frustumCulled = false;
    hull.raycast = noRaycast;
    spinner.add(hull);
  }

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
