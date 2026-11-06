import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  SphereGeometry,
  Vector2,
} from '@iwsdk/core';
import { HALOS } from './halo-sprites.js';
import { ROLE_COLORS } from './palette.js';
import { markRange, noRaycast, setSharedTime } from './shaders/common.js';
import { tailMaterial } from './shaders/tail.js';
import type { CometVisual } from './visual-types.js';

/*
 * Comet: a small additive white head with an orange halo slot, and a
 * particle tail in a 256-slot ring buffer. The root stays at the board
 * origin; the head moves, and tail particles keep the board position they
 * were emitted at, so the tail streams behind the head. Two particles are
 * emitted per frame whenever the head moves.
 */

const TAIL_CAPACITY = 256;
const EMIT_PER_FRAME = 2;
/** A jump longer than this (level change, replay) is a teleport: no particles. */
const MAX_STEP = 0.25;
const HALO_SIZE = 0.17;

const headGeometry = new SphereGeometry(0.026, 16, 12);
const headMaterial = new MeshBasicMaterial({
  color: ROLE_COLORS.comet,
  transparent: true,
  blending: AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
});

/** Deterministic jitter source (mulberry32). */
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

const drawingBuffer = new Vector2();

export function createCometVisual(): CometVisual {
  const root = new Group();
  root.name = 'Comet';
  const head = new Group();
  head.name = 'CometHead';
  const headMesh = new Mesh(headGeometry, headMaterial);
  headMesh.renderOrder = 4;
  head.add(headMesh);

  const positions = new BufferAttribute(new Float32Array(TAIL_CAPACITY * 3), 3).setUsage(DynamicDrawUsage);
  const births = new BufferAttribute(new Float32Array(TAIL_CAPACITY).fill(-1e4), 1).setUsage(DynamicDrawUsage);
  const velocities = new BufferAttribute(new Float32Array(TAIL_CAPACITY * 3), 3).setUsage(DynamicDrawUsage);
  const tailGeometry = new BufferGeometry();
  tailGeometry.setAttribute('position', positions);
  tailGeometry.setAttribute('aBirth', births);
  tailGeometry.setAttribute('aVel', velocities);
  const tail = new Points(tailGeometry, tailMaterial);
  tail.name = 'CometTail';
  tail.frustumCulled = false;
  tail.renderOrder = 3;
  tail.raycast = noRaycast;
  // Point sizes are in pixels: keep the board-unit size right for the current target.
  tail.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(drawingBuffer);
    tailMaterial.uniforms.uPixelScale.value = drawingBuffer.y * 0.5;
  };
  root.add(tail, head);

  const halo = HALOS.allocate(ROLE_COLORS.cometTrail, 0.6);
  const random = mulberry32(0xc0e7);
  const last = [0, 0, 0];
  let hasLast = false;
  let next = 0;

  const emit = (x: number, y: number, z: number, vx: number, vy: number, vz: number, t: number) => {
    const p = positions.array as Float32Array;
    const b = births.array as Float32Array;
    const v = velocities.array as Float32Array;
    const k = next * 3;
    const j = 0.006;
    p[k] = x + (random() - 0.5) * j;
    p[k + 1] = y + (random() - 0.5) * j;
    p[k + 2] = z + (random() - 0.5) * j;
    // Drift slowly backward along the motion, with a little spread.
    v[k] = -vx * 0.12 + (random() - 0.5) * 0.05;
    v[k + 1] = -vy * 0.12 + (random() - 0.5) * 0.05;
    v[k + 2] = -vz * 0.12 + (random() - 0.5) * 0.05;
    b[next] = t;
    markRange(positions, next, 1);
    markRange(velocities, next, 1);
    markRange(births, next, 1);
    next = (next + 1) % TAIL_CAPACITY;
  };

  return {
    root,
    setVisible(visible) {
      root.visible = visible;
      if (!visible) hasLast = false;
    },
    setPosition(p) {
      head.position.set(p[0], p[1], p[2]);
    },
    update(dt, t) {
      setSharedTime(t);
      const hp = head.position;
      if (root.visible) {
        const dx = hp.x - last[0];
        const dy = hp.y - last[1];
        const dz = hp.z - last[2];
        const step = Math.hypot(dx, dy, dz);
        if (hasLast && step > 1e-5 && step < MAX_STEP) {
          const inv = dt > 0 ? 1 / dt : 0;
          for (let i = 1; i <= EMIT_PER_FRAME; i++) {
            const f = i / EMIT_PER_FRAME;
            emit(last[0] + dx * f, last[1] + dy * f, last[2] + dz * f, dx * inv, dy * inv, dz * inv, t - dt * (1 - f));
          }
        }
        last[0] = hp.x;
        last[1] = hp.y;
        last[2] = hp.z;
        hasLast = true;
      }
      HALOS.setPosition(halo, hp.x, hp.y, hp.z);
      HALOS.setSize(halo, root.visible ? HALO_SIZE : 0);
    },
  };
}
