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
import { markRange, noRaycast } from '../shaders/common.js';
import { createCosmosPlanetMaterial, createCosmosRingMaterial } from '../shaders/cosmos.js';

/*
 * The cosmos planets in the cosmos frame (world meters; the root sits at
 * the board center, board -Z ahead of the player, +X to the right), laid
 * out in depth layers for stereo parallax:
 *   0  the ringed giant (Saturn map), about 12.4 m away left-forward and
 *      15 degrees above the eyes, about 32 degrees across, so it reaches into
 *      the peripheral view; it spins on its tilted axis;
 *   far: 1 Neptune (8 m), 2 Uranus on its side (11 m), 4 Mars (14 m);
 *   mid: 3 the Moon (3.2 m, tidally locked);
 *   and two small moons orbiting the giant just outside its ring.
 * Orbits are Kepler-like (omega = K / r^1.5, the 3.2 m Moon about 3 min per
 * orbit on the motion clock), so inner bodies move faster; each body spins
 * at its own rate. One realistic planet program lights them all from the
 * sun (src/render/shaders/cosmos.ts). pulse(index) brightens a planet's rim
 * and swells it (the L4 echo; slots 0-3).
 */

export const GIANT_RADIUS = 3.4;
/** Giant planet center in the cosmos frame (about 12.4 m from the eyes, left-forward, 15 degrees up). */
export const GIANT_POSITION = [-6.9, 3.7, -9.8] as const;
/** Ring radii in giant radii (Saturn's C ring inner edge to the A ring outer edge). */
const RING_INNER = 1.24;
const RING_OUTER = 2.27;
/**
 * The giant's spin axis (= ring normal), cosmos frame: 38 degrees from
 * vertical, leaning toward the player and a little toward the sun, so the
 * ring opens about 19 degrees to the eyes and its sunlit face shows.
 */
const GIANT_AXIS = new Vector3(0.541, 0.788, 0.298).normalize();
const GIANT_SPIN = 0.02;

/** Orbit rate constant: omega = K / r^1.5 (rad/s on the motion clock). */
const KEPLER_K = 0.2;

/** Atlas tiles (2 columns x 4 rows, row 0 at the top of the image). */
export const TILE = { earth: 0, uranus: 1, moon: 2, mercury: 3, jupiter: 4, neptune: 5, mars: 6, ice: 7 } as const;

/** How one body looks to the realistic planet material. */
export interface PlanetLook {
  tile: number;
  /** Atmosphere rim colour (hex) and strength (0: none). */
  atmo: number;
  atmoStrength: number;
  /** Bump strength (body radii), specular glint, night ambient (0-0.02). */
  bump: number;
  glint: number;
  night: number;
  /** Procedural albedo until the map loads (hex). */
  fallback: number;
  /** The giant's ring shadow (own-map material only). */
  ringShadow?: boolean;
}

interface Orbit extends PlanetLook {
  radius: number;
  height: number;
  size: number;
  phase: number;
  /** Own spin (rad/s; NaN: tidally locked, the same face to the center). */
  spin: number;
  /** Axial tilt (rad, about the orbit's radial axis). */
  tilt: number;
}

/** Orbiting bodies, cosmos indices 1-4 (instance order = index - 1). */
const ORBITS: readonly Orbit[] = [
  { radius: 8, height: 1.6, size: 0.9, phase: -1.75, spin: 0.05, tilt: 0.49, tile: TILE.neptune, atmo: 0x5a8cff, atmoStrength: 0.55, bump: 0, glint: 0, night: 0.012, fallback: 0x1f3f9a },
  { radius: 11, height: 3.2, size: 1.0, phase: 0.75, spin: -0.04, tilt: 1.71, tile: TILE.uranus, atmo: 0x9fe6f0, atmoStrength: 0.5, bump: 0, glint: 0, night: 0.012, fallback: 0x78b8c4 },
  { radius: 3.2, height: 0.5, size: 0.22, phase: -0.35, spin: Number.NaN, tilt: 0.1, tile: TILE.moon, atmo: 0, atmoStrength: 0, bump: 0.12, glint: 0, night: 0.015, fallback: 0x5e5a55 },
  { radius: 14, height: -1.2, size: 0.7, phase: 2.4, spin: 0.06, tilt: 0.44, tile: TILE.mars, atmo: 0xf0a078, atmoStrength: 0.35, bump: 0.05, glint: 0, night: 0.01, fallback: 0x8c4420 },
];

interface GiantMoon extends PlanetLook {
  /** Orbit radius in giant radii (just outside the ring's 2.27). */
  radius: number;
  size: number;
  phase: number;
  /** Inclination to the ring plane (rad). */
  incline: number;
}

const GIANT_MOONS: readonly GiantMoon[] = [
  { radius: 2.45, size: 0.3, phase: 0.6, incline: 0.09, tile: TILE.mercury, atmo: 0, atmoStrength: 0, bump: 0.12, glint: 0, night: 0.012, fallback: 0x6a645c },
  { radius: 2.85, size: 0.24, phase: 3.4, incline: -0.16, tile: TILE.ice, atmo: 0, atmoStrength: 0, bump: 0.06, glint: 0.5, night: 0.015, fallback: 0xa8b4c4 },
];

/** Giant moons' orbit rate constant in giant radii (the inner one about 4 min per orbit). */
const GIANT_MOON_K = (2 * Math.PI) / 240 * 2.45 ** 1.5;

const GIANT_LOOK: PlanetLook = {
  tile: 0,
  atmo: 0xe8d2a0,
  atmoStrength: 0.45,
  bump: 0,
  glint: 0,
  night: 0.012,
  fallback: 0xa48a5e,
  ringShadow: true,
};

/** Pulse slots: the giant and orbiting bodies 1-3 (echoPlanet in sky-story.ts). */
export const COSMOS_PLANET_COUNT = 4;
const SMALL_COUNT = ORBITS.length + GIANT_MOONS.length;

/** Size swell per unit pulse (0 with reduced motion). */
export const PULSE_SCALE = { value: 0.15 };

const scratch = {
  m: new Matrix4(),
  q: new Quaternion(),
  q2: new Quaternion(),
  p: new Vector3(),
  s: new Vector3(),
  a: new Vector3(),
  e: new Euler(),
  c: new Color(),
};

/**
 * Writes the realistic planet material's per-instance attributes (aTile,
 * aAtmo, aSurface, aFallback, aPulse) for `looks` onto `geometry`; returns
 * the aPulse attribute.
 */
export function planetAttributes(geometry: BufferGeometry, looks: readonly PlanetLook[]): InstancedBufferAttribute {
  const n = looks.length;
  const tile = new Float32Array(n * 4);
  const atmo = new Float32Array(n * 4);
  const surface = new Float32Array(n * 4);
  const fallback = new Float32Array(n * 3);
  const c = scratch.c;
  for (let i = 0; i < n; i++) {
    const look = looks[i];
    const col = look.tile % 2;
    const row = Math.floor(look.tile / 2);
    tile.set([col * 0.5, 1 - (row + 1) * 0.25, 0.5, 0.25], i * 4);
    c.setHex(look.atmo);
    atmo.set([c.r, c.g, c.b, look.atmoStrength], i * 4);
    surface.set([look.bump, look.glint, look.night, look.ringShadow ? 1 : 0], i * 4);
    c.setHex(look.fallback);
    fallback.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute('aTile', new InstancedBufferAttribute(tile, 4));
  geometry.setAttribute('aAtmo', new InstancedBufferAttribute(atmo, 4));
  geometry.setAttribute('aSurface', new InstancedBufferAttribute(surface, 4));
  geometry.setAttribute('aFallback', new InstancedBufferAttribute(fallback, 3));
  const pulse = new InstancedBufferAttribute(new Float32Array(n), 1).setUsage(DynamicDrawUsage);
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

export function createCosmosPlanets(): CosmosPlanets {
  const root = new Group();
  root.name = 'CosmosPlanets';
  const giantCenter = new Vector3(GIANT_POSITION[0], GIANT_POSITION[1], GIANT_POSITION[2]);
  const giantTilt = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), GIANT_AXIS);

  // 0. The giant and its ring.
  const giantGeometry = new SphereGeometry(1, 96, 64);
  const giantPulse = planetAttributes(giantGeometry, [GIANT_LOOK]);
  const giant = new InstancedMesh(
    giantGeometry,
    createCosmosPlanetMaterial({ ownMap: 'saturn', pulseScale: PULSE_SCALE, ring: [RING_INNER, RING_OUTER] }),
    1,
  );
  giant.name = 'GiantPlanet';
  const ring = new Mesh(new RingGeometry(RING_INNER, RING_OUTER, 192, 1).rotateX(-Math.PI / 2), createCosmosRingMaterial(RING_INNER, RING_OUTER));
  ring.name = 'GiantRing';
  ring.position.copy(giantCenter);
  ring.quaternion.copy(giantTilt);
  ring.scale.setScalar(GIANT_RADIUS);
  ring.renderOrder = -7;

  // 1-4 and the giant's moons: one instanced draw.
  const smallGeometry = new SphereGeometry(1, 48, 32);
  const smallPulse = planetAttributes(smallGeometry, [...ORBITS, ...GIANT_MOONS]);
  const small = new InstancedMesh(smallGeometry, createCosmosPlanetMaterial({ pulseScale: PULSE_SCALE }), SMALL_COUNT);
  small.name = 'CosmosSmallPlanets';
  small.instanceMatrix.setUsage(DynamicDrawUsage);

  for (const mesh of [giant, small]) {
    mesh.frustumCulled = false;
    mesh.raycast = noRaycast;
    mesh.renderOrder = -7.5;
    root.add(mesh);
  }
  ring.raycast = noRaycast;
  ring.frustumCulled = false;
  root.add(ring);

  // Each giant moon's orbit plane: the ring plane turned by its inclination.
  const moonPlanes = GIANT_MOONS.map((moon) => new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), moon.incline).premultiply(giantTilt));
  const up = new Vector3(0, 1, 0);

  const pulses = new Float32Array(COSMOS_PLANET_COUNT);
  let lastMotion = Number.NaN;

  const writeGiant = (t: number) => {
    const { m, q, s } = scratch;
    q.setFromAxisAngle(up, t * GIANT_SPIN).premultiply(giantTilt);
    m.compose(giantCenter, q, s.setScalar(GIANT_RADIUS));
    giant.setMatrixAt(0, m);
    giant.instanceMatrix.needsUpdate = true;
  };
  const writeSmall = (t: number) => {
    const { m, q, q2, p, s, a, e } = scratch;
    for (let i = 0; i < ORBITS.length; i++) {
      const o = ORBITS[i];
      const angle = o.phase + t * (KEPLER_K / o.radius ** 1.5);
      p.set(Math.sin(angle) * o.radius, o.height, -Math.cos(angle) * o.radius);
      // Spin about the tilted axis; a locked body keeps one face to the center.
      const locked = Number.isNaN(o.spin);
      q.setFromAxisAngle(up, locked ? 0 : t * o.spin);
      q2.setFromEuler(e.set(0, locked ? -angle : 0, o.tilt));
      q.premultiply(q2);
      m.compose(p, q, s.setScalar(o.size));
      small.setMatrixAt(i, m);
    }
    for (let j = 0; j < GIANT_MOONS.length; j++) {
      const moon = GIANT_MOONS[j];
      const angle = moon.phase + t * (GIANT_MOON_K / moon.radius ** 1.5);
      a.set(Math.cos(angle), 0, Math.sin(angle)).applyQuaternion(moonPlanes[j]);
      p.copy(a).multiplyScalar(moon.radius * GIANT_RADIUS).add(giantCenter);
      q.setFromAxisAngle(up, -angle).premultiply(moonPlanes[j]);
      m.compose(p, q, s.setScalar(moon.size));
      small.setMatrixAt(ORBITS.length + j, m);
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
