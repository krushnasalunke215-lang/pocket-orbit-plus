import {
  Color,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
} from '@iwsdk/core';
import { PALETTE } from '../palette.js';
import { markRange, noRaycast } from '../shaders/common.js';
import { createCosmosInkMaterial, createCosmosRingMaterial, createCosmosSurfaceMaterial } from '../shaders/cosmos.js';

/*
 * The cosmos planets in the cosmos frame (world meters; the root sits at
 * the board center, board -Z ahead of the player, +X to the right):
 *   0  the giant ringed gas planet, looming left-forward about 15 degrees
 *      above the eyes, spinning slowly;
 *   1  a sky-blue planet, 2 a bluish-green planet, 3 a pink moon, on slow
 *      orbits around the center at different distances and heights (real
 *      stereo depth and parallax).
 * The giant is an instanced mesh of one so it shares the small planets'
 * toon program; each mesh has an instanced ink hull sharing its matrices.
 * pulse(index) brightens a planet's rim and swells it (the L4 echo).
 */

export const GIANT_RADIUS = 2.2;
/** Giant planet center in the cosmos frame (about 8.5 m away, left-forward). */
export const GIANT_POSITION = [-4.6, 3.0, -7.1] as const;
/** Ring radii in giant radii. */
const RING_INNER = 1.35;
const RING_OUTER = 2.25;

interface Orbit {
  radius: number;
  height: number;
  size: number;
  speed: number;
  phase: number;
  color: number;
  band: number;
}

/** Small planets 1-3 (cosmos indices). */
const ORBITS: readonly Orbit[] = [
  { radius: 5.5, height: 1.2, size: 0.5, speed: 0.024, phase: -0.55, color: PALETTE.skyBlue, band: 0xb9e3fa },
  { radius: 7.0, height: 2.4, size: 0.7, speed: -0.015, phase: 0.85, color: PALETTE.bluishGreen, band: 0x7fdcc0 },
  { radius: 3.5, height: 0.3, size: 0.2, speed: 0.05, phase: 2.6, color: PALETTE.reddishPurple, band: 0xf0c4dc },
];

export const COSMOS_PLANET_COUNT = 1 + ORBITS.length;

/** Size swell per unit pulse (0 with reduced motion). */
export const PULSE_SCALE = { value: 0.15 };

const scratch = {
  m: new Matrix4(),
  q: new Quaternion(),
  p: new Vector3(),
  s: new Vector3(),
  e: new Euler(),
  c: new Color(),
};

function instanceColors(geometry: BufferGeometry, count: number, colors: readonly number[], bands: readonly number[]): InstancedBufferAttribute {
  const color = new Float32Array(count * 3);
  const band = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    scratch.c.setHex(colors[i]);
    color.set([scratch.c.r, scratch.c.g, scratch.c.b], i * 3);
    scratch.c.setHex(bands[i]);
    band.set([scratch.c.r, scratch.c.g, scratch.c.b], i * 3);
  }
  geometry.setAttribute('aColor', new InstancedBufferAttribute(color, 3));
  geometry.setAttribute('aBand', new InstancedBufferAttribute(band, 3));
  const pulse = new InstancedBufferAttribute(new Float32Array(count), 1).setUsage(DynamicDrawUsage);
  geometry.setAttribute('aPulse', pulse);
  return pulse;
}

export interface CosmosPlanets {
  readonly root: Group;
  update(motionT: number, dt: number): void;
  pulse(index: number, strength: number): void;
  /** Current pulse level of planet `index` (debug). */
  pulseLevel(index: number): number;
  /** World-frame instance matrix of a small planet (debug: proves motion stops). */
  readonly smallMesh: InstancedMesh;
}

export function createCosmosPlanets(ink: boolean): CosmosPlanets {
  const root = new Group();
  root.name = 'CosmosPlanets';

  // 0. The giant.
  const giantGeometry = new SphereGeometry(1, 64, 40);
  const giantPulse = instanceColors(giantGeometry, 1, [0xff9a3c], [0xd8572a]);
  const giant = new InstancedMesh(giantGeometry, createCosmosSurfaceMaterial({ bands: 7, dotRows: 44, pulseScale: PULSE_SCALE }), 1);
  giant.name = 'GiantPlanet';
  const giantTilt = new Quaternion().setFromEuler(new Euler(0.95, 0.4, 0.32));
  const ring = new Mesh(
    new RingGeometry(RING_INNER, RING_OUTER, 128, 1).rotateX(-Math.PI / 2),
    createCosmosRingMaterial(0xffe2a8, 0xf0a860, RING_INNER, RING_OUTER),
  );
  ring.name = 'GiantRing';
  ring.position.set(GIANT_POSITION[0], GIANT_POSITION[1], GIANT_POSITION[2]);
  ring.quaternion.copy(giantTilt);
  ring.scale.setScalar(GIANT_RADIUS);
  ring.renderOrder = -7;

  // 1-3. The small planets and the moon.
  const smallGeometry = new SphereGeometry(1, 32, 20);
  const smallPulse = instanceColors(
    smallGeometry,
    ORBITS.length,
    ORBITS.map((o) => o.color),
    ORBITS.map((o) => o.band),
  );
  const small = new InstancedMesh(smallGeometry, createCosmosSurfaceMaterial({ bands: 5, dotRows: 18, pulseScale: PULSE_SCALE }), ORBITS.length);
  small.name = 'CosmosSmallPlanets';
  small.instanceMatrix.setUsage(DynamicDrawUsage);

  const meshes: InstancedMesh[] = [giant, small];
  if (ink) {
    for (const [mesh, width] of [[giant, 0.03], [small, 0.08]] as const) {
      const hull = new InstancedMesh(mesh.geometry, createCosmosInkMaterial(width, PULSE_SCALE), mesh.count);
      hull.name = `${mesh.name}Ink`;
      hull.instanceMatrix = mesh.instanceMatrix;
      hull.renderOrder = -8;
      meshes.push(hull);
    }
  }
  for (const mesh of meshes) {
    mesh.frustumCulled = false;
    mesh.raycast = noRaycast;
    if (mesh.renderOrder === 0) mesh.renderOrder = -7.5;
    root.add(mesh);
  }
  ring.raycast = noRaycast;
  ring.frustumCulled = false;
  root.add(ring);

  const pulses = new Float32Array(COSMOS_PLANET_COUNT);
  let lastMotion = Number.NaN;

  const writeGiant = (t: number) => {
    const { m, q, p, s } = scratch;
    q.setFromAxisAngle(p.set(0, 1, 0), t * 0.03);
    q.premultiply(giantTilt);
    m.compose(p.set(GIANT_POSITION[0], GIANT_POSITION[1], GIANT_POSITION[2]), q, s.setScalar(GIANT_RADIUS));
    giant.setMatrixAt(0, m);
    giant.instanceMatrix.needsUpdate = true;
  };
  const writeSmall = (t: number) => {
    const { m, q, p, s, e } = scratch;
    for (let i = 0; i < ORBITS.length; i++) {
      const o = ORBITS[i];
      const a = o.phase + t * o.speed;
      q.setFromEuler(e.set(0.2, t * 0.2 + i, 0));
      m.compose(p.set(Math.sin(a) * o.radius, o.height, -Math.cos(a) * o.radius), q, s.setScalar(o.size));
      small.setMatrixAt(i, m);
    }
    small.instanceMatrix.needsUpdate = true;
  };
  writeGiant(0);
  writeSmall(0);

  const writePulse = (index: number, value: number) => {
    const attribute = index === 0 ? giantPulse : smallPulse;
    const slot = index === 0 ? 0 : index - 1;
    (attribute.array as Float32Array)[slot] = value;
    markRange(attribute, slot, 1);
  };

  return {
    root,
    smallMesh: small,
    update(motionT, dt) {
      if (motionT !== lastMotion) {
        writeGiant(motionT);
        writeSmall(motionT);
        lastMotion = motionT;
      }
      const decay = Math.exp(-dt * 2.2);
      for (let i = 0; i < COSMOS_PLANET_COUNT; i++) {
        if (pulses[i] === 0) continue;
        pulses[i] = pulses[i] < 0.01 ? 0 : pulses[i] * decay;
        writePulse(i, pulses[i]);
      }
    },
    pulse(index, strength) {
      if (index < 0 || index >= COSMOS_PLANET_COUNT) return;
      pulses[index] = Math.min(1, Math.max(pulses[index], strength));
      writePulse(index, pulses[index]);
    },
    pulseLevel(index) {
      return pulses[index] ?? 0;
    },
  };
}
