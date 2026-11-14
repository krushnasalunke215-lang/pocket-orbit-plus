import { BufferAttribute, BufferGeometry, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh } from '@iwsdk/core';
import { markRange, noRaycast } from '../shaders/common.js';
import { createStreakMaterial } from '../shaders/cosmos.js';
import { mulberry32 } from './random.js';

/*
 * Occasional shooting stars: one InstancedMesh of SLOTS streak quads. On a
 * seeded schedule (every 6-14 s of the real clock) a streak starts above
 * the horizon 8-10 m out and crosses the sky in LIFE seconds; the shader
 * animates it from the shared clock, so a spawn is the only write. Nothing
 * spawns while reduced motion is on.
 */

const SLOTS = 4;
const LIFE = 0.9;

export interface ShootingStars {
  readonly mesh: InstancedMesh;
  update(realT: number, reducedMotion: boolean): void;
  /** Streaks alive at real time `realT`. */
  active(realT: number): number;
}

const quadPosition = new BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0]), 3);
const quadIndex = new BufferAttribute(new Uint16Array([0, 1, 2, 2, 1, 3]), 1);

export function createShootingStars(): ShootingStars {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', quadPosition);
  geometry.setIndex(quadIndex);
  const start = new InstancedBufferAttribute(new Float32Array(SLOTS * 3), 3).setUsage(DynamicDrawUsage);
  const vel = new InstancedBufferAttribute(new Float32Array(SLOTS * 3), 3).setUsage(DynamicDrawUsage);
  const birth = new InstancedBufferAttribute(new Float32Array(SLOTS).fill(-1e4), 1).setUsage(DynamicDrawUsage);
  geometry.setAttribute('aStart', start);
  geometry.setAttribute('aVel', vel);
  geometry.setAttribute('aBirth', birth);
  const mesh = new InstancedMesh(geometry, createStreakMaterial(LIFE, 0.035), SLOTS);
  mesh.name = 'ShootingStars';
  mesh.frustumCulled = false;
  mesh.renderOrder = -6.5;
  mesh.raycast = noRaycast;

  const random = mulberry32(0x57a2);
  let next = 4;
  let slot = 0;
  const births = birth.array as Float32Array;

  let wasReduced = false;

  return {
    mesh,
    update(realT, reducedMotion) {
      if (reducedMotion && !wasReduced) {
        // Reduced motion turned on: any streak in flight disappears now.
        births.fill(-1e4);
        markRange(birth, 0, SLOTS);
      }
      wasReduced = reducedMotion;
      if (realT < next) return;
      next = realT + 6 + 8 * random();
      if (reducedMotion) return;
      const a = random() * Math.PI * 2;
      const r = 8 + 2 * random();
      const el = 0.35 + 0.5 * random();
      const s = start.array as Float32Array;
      const v = vel.array as Float32Array;
      const k = slot * 3;
      s[k] = Math.cos(a) * Math.cos(el) * r;
      s[k + 1] = Math.sin(el) * r;
      s[k + 2] = Math.sin(a) * Math.cos(el) * r;
      // Across the sky (tangent to the circle), dipping a little.
      const dir = random() < 0.5 ? 1 : -1;
      v[k] = -Math.sin(a) * 7 * dir;
      v[k + 1] = -1.6;
      v[k + 2] = Math.cos(a) * 7 * dir;
      births[slot] = realT;
      markRange(start, slot, 1);
      markRange(vel, slot, 1);
      markRange(birth, slot, 1);
      slot = (slot + 1) % SLOTS;
    },
    active(realT) {
      let n = 0;
      for (let i = 0; i < SLOTS; i++) if (realT - births[i] >= 0 && realT - births[i] <= LIFE) n++;
      return n;
    },
  };
}
