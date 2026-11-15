import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  type BufferGeometry,
  type Material,
  type ShaderMaterial,
} from '@iwsdk/core';
import { VISUAL_BODY_SCALE } from '../config.js';
import { gridPull } from '../game/spacetime.js';
import { KIND_DEFAULTS, type BodyKind } from '../sim/bodies.js';
import type { BodyDef } from '../sim/level.js';
import { TILE } from './cosmos/planets.js';
import { HALOS, OUTLINES, PULL_RINGS } from './halo-sprites.js';
import { bakeLumpyGeometry } from './lumpy-geometry.js';
import { PALETTE, ROLE_COLORS } from './palette.js';
import { ACCRETION_INNER, ACCRETION_OUTER, accretionMaterial } from './shaders/accretion.js';
import { noRaycast, setMotionTime, SHARED_TIME } from './shaders/common.js';
import { createLensMaterial, LENS_SIZE } from './shaders/lens.js';
import { createSurfaceMaterial, type SurfaceColors } from './shaders/planet.js';
import { PULL_PATTERN } from './shaders/pull-ring.js';
import { createRingMaterial, RING_PATTERN } from './shaders/ring.js';
import { createStarMaterial, STAR_VARIANT } from './shaders/star.js';
import type { BodyVisual, InteractionState } from './visual-types.js';

/*
 * Level bodies, realistic and told apart by silhouette as well as colour:
 *   movable planet  an Earth-like sphere with a blue atmosphere, an ocean
 *                   glint and a tilted dusty ring; solid pull ring
 *   fixed planet    an ice giant (Uranus map), cyan atmosphere, dusty ring
 *   moon            a lumpy cratered rock (displaced icosphere, within 1.08
 *                   radii) and a faint specked ring; dotted pull ring
 *   black hole      a pure black sphere, a white-hot to deep-red accretion
 *                   disk with Doppler beaming, and a lens billboard (photon
 *                   ring, the disk's far side lensed over the shadow); its
 *                   pull ring's ripples flow inward
 *   repulsor        (white star, push) a self-lit blue-white sphere with
 *                   granulation and limb darkening, a corona billboard with
 *                   8 slow streamers breathing with its pulse, and faint
 *                   outward pressure waves; its pull ring's ripples flow outward
 * Each body owns one halo slot (a subtle glow; flash() brightens it), one
 * pull-ring slot (its influence radius on the board) and one high-contrast
 * outline slot. It bends the spacetime grid (gridPull) and casts a soft
 * shadow on the plate (RenderSyncSystem writes both). Geometry and ring
 * materials are shared module resources; the surface (and lens) materials
 * are cloned per body.
 */

/** White-star pulse rate (rad/s). */
const PULSE_RATE = 2.6;
/** A flash decays as exp(-age / FLASH_DECAY) on the real clock (SHARED_TIME). */
const FLASH_DECAY = 0.22;

const planetSphere = new SphereGeometry(1, 48, 32);
const starSphere = new SphereGeometry(1, 32, 24);
/** The lumpy moon, baked once: 320 triangles, radius 0.9-1.08, a few craters. */
const moonRock = bakeLumpyGeometry(3, 0x5eed, 0.9, 1.08, 7);
const billboard = new PlaneGeometry(2, 2);
const planetRing = new RingGeometry(1.45, 2.05, 96, 1).rotateX(-Math.PI / 2);
const moonRing = new RingGeometry(1.7, 2.3, 64, 1).rotateX(-Math.PI / 2);
const accretionRing = new RingGeometry(ACCRETION_INNER, ACCRETION_OUTER, 96, 3).rotateX(-Math.PI / 2);
const repulsorRing = new RingGeometry(1.3, 3.0, 64, 3).rotateX(-Math.PI / 2);
const colliderGeometry = new SphereGeometry(1, 16, 12);

/** Ring materials: one per style, created once. */
const ringMaterials = {
  movablePlanet: createRingMaterial(ROLE_COLORS.movablePlanet, RING_PATTERN.solid, 1.45, 2.05, 0.75),
  fixedPlanet: createRingMaterial(ROLE_COLORS.fixedPlanet, RING_PATTERN.solid, 1.45, 2.05, 0.75),
  moon: createRingMaterial(0xd8d2cc, RING_PATTERN.dotted, 1.7, 2.3, 0.7),
  repulsor: createRingMaterial(0xbcd6ff, RING_PATTERN.dashedOutward, 1.3, 3.0, 0.8),
};

/**
 * Invisible grab target. `visible: false` on the material hides it while
 * the mesh itself stays visible, because pointer hit tests skip objects
 * whose Object3D.visible is false. DoubleSide lets a ray starting inside
 * the sphere (a near pinch) still hit it.
 */
const colliderMaterial = new MeshBasicMaterial({ visible: false, side: DoubleSide });

const STATE_SCALE: Record<InteractionState, number> = { idle: 1, hover: 1.12, held: 1.2 };
const STATE_HALO: Record<InteractionState, number> = { idle: 1, hover: 1.8, held: 2.3 };
const STATE_PULL: Record<InteractionState, number> = { idle: 1, hover: 1.8, held: 2.4 };

interface KindStyle {
  geometry: BufferGeometry;
  surface: SurfaceColors;
  ring: { geometry: BufferGeometry; material: Material; tilt: number } | null;
  halo: { color: number; size: number; alpha: number };
  pull: { color: number; alpha: number; pattern: number };
  spin: number;
  /** Relative size of the soft pulse (0 = none). */
  pulse: number;
  /** Farthest point of the shape in radii (the high-contrast outline circles it). */
  extent: number;
  /** Camera-facing child: the black hole's lens or the white star's corona. */
  billboard: 'lens' | 'corona' | null;
  /** Shadow radius on the plate, in body radii. */
  shadow: number;
}

/** High-contrast outline ring: outer radius over the shape's extent, and its inner radius fraction. */
const OUTLINE_OUTER = 1.24;
const OUTLINE_INNER = 1.03 / OUTLINE_OUTER;
const OUTLINE_ALPHA = 0.95;
/** The white star's corona, in star radii. */
const CORONA_SIZE = 3.2;

/** Small stable hash of the body id, so patterns differ per body but never per run. */
function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

function styleFor(kind: BodyKind, movable: boolean, seed: number): KindStyle {
  switch (kind) {
    case 'planet': {
      const color = movable ? ROLE_COLORS.movablePlanet : ROLE_COLORS.fixedPlanet;
      return {
        geometry: planetSphere,
        surface: movable
          ? { color: 0x1d4f8f, band: 0x6f9f5a, rim: color, seed, bandScale: 4, tile: TILE.earth, atmosphere: { color: 0x6fa8ff, strength: 0.75 }, bump: 0.02, ocean: 0.7 }
          : { color: 0x5fb8c2, band: 0x9fe6ea, rim: color, seed, bandScale: 7, tile: TILE.uranus, atmosphere: { color: 0x9ff0ea, strength: 0.6 } },
        ring: {
          geometry: planetRing,
          material: movable ? ringMaterials.movablePlanet : ringMaterials.fixedPlanet,
          tilt: 0.38,
        },
        halo: { color, size: 2.4, alpha: 0.12 },
        pull: { color, alpha: 0.22, pattern: PULL_PATTERN.solid },
        spin: 0.25,
        pulse: 0,
        extent: 1,
        billboard: null,
        shadow: 1.1,
      };
    }
    case 'moon':
      return {
        geometry: moonRock,
        surface: { color: 0x8a847c, band: 0x5e5952, rim: 0xffffff, seed, bandScale: 3, tile: TILE.moon, bump: 0.16 },
        ring: { geometry: moonRing, material: ringMaterials.moon, tilt: 0 },
        halo: { color: ROLE_COLORS.moon, size: 2.2, alpha: 0.1 },
        pull: { color: ROLE_COLORS.moon, alpha: 0.2, pattern: PULL_PATTERN.dotted },
        spin: 0.3,
        pulse: 0,
        extent: 1.08,
        billboard: null,
        shadow: 1.05,
      };
    case 'black-hole':
      return {
        geometry: planetSphere,
        surface: { color: PALETTE.black, band: PALETTE.black, rim: PALETTE.black, seed },
        ring: { geometry: accretionRing, material: accretionMaterial, tilt: 0.22 },
        halo: { color: ROLE_COLORS.blackHoleRing, size: 3.0, alpha: 0.1 },
        pull: { color: ROLE_COLORS.blackHoleRing, alpha: 0.3, pattern: PULL_PATTERN.inward },
        spin: 0,
        pulse: 0,
        extent: 1,
        billboard: 'lens',
        shadow: 1.3,
      };
    case 'repulsor':
      return {
        geometry: starSphere,
        surface: { color: 0xd2e2ff, band: 0xffffff, rim: 0x9cc4ff, seed, rimStrength: 0.25, emissive: 1.05 },
        ring: { geometry: repulsorRing, material: ringMaterials.repulsor, tilt: 0 },
        halo: { color: 0xcfe0ff, size: 3.0, alpha: 0.22 },
        pull: { color: ROLE_COLORS.repulsorRing, alpha: 0.26, pattern: PULL_PATTERN.outward },
        spin: 0.12,
        pulse: 0.04,
        extent: 1,
        billboard: 'corona',
        shadow: 0,
      };
  }
}

/** Visual for one level body, in board units, centered on the body. */
export function createBodyVisual(def: BodyDef): BodyVisual {
  // Drawn VISUAL_BODY_SCALE larger than simulated (the grab collider stays larger still).
  const radius = (def.radius ?? KIND_DEFAULTS[def.kind].radius) * VISUAL_BODY_SCALE;
  const influence = KIND_DEFAULTS[def.kind].influenceRadius;
  const style = styleFor(def.kind, Boolean(def.movable), seedOf(def.id));
  const root = new Group();
  root.name = `Body ${def.id}`;

  const surfaceMaterial = createSurfaceMaterial(style.surface);
  const mesh = new Mesh(style.geometry, surfaceMaterial);
  mesh.scale.setScalar(radius);
  // Fixed seeded tilt and phase, so planets do not all show the same face.
  mesh.rotation.set(0.25 * (seedOf(def.id + 'x') - 0.5), 0, 0.41 * (seedOf(def.id + 'z') - 0.5));
  root.add(mesh);

  if (style.ring) {
    const ring = new Mesh(style.ring.geometry, style.ring.material);
    ring.scale.setScalar(radius);
    ring.rotation.set(style.ring.tilt, 0, style.ring.tilt * 0.5);
    ring.renderOrder = 1;
    ring.raycast = noRaycast;
    root.add(ring);
  }

  let lensMaterial: ShaderMaterial | null = null;
  let coronaMaterial: ShaderMaterial | null = null;
  let glow: Mesh | null = null;
  if (style.billboard === 'lens') {
    lensMaterial = createLensMaterial();
    glow = new Mesh(billboard, lensMaterial);
    glow.name = 'BlackHoleLens';
  } else if (style.billboard === 'corona') {
    coronaMaterial = createStarMaterial(STAR_VARIANT.corona, CORONA_SIZE, 0xbcd4ff);
    glow = new Mesh(billboard, coronaMaterial);
    glow.name = 'StarCorona';
  }
  if (glow) {
    glow.scale.setScalar(radius);
    glow.renderOrder = 2;
    glow.frustumCulled = false;
    glow.raycast = noRaycast;
    root.add(glow);
  }

  let collider: Mesh | undefined;
  if (def.movable) {
    collider = new Mesh(colliderGeometry, colliderMaterial);
    collider.name = `Collider ${def.id}`;
    root.add(collider);
  }

  const halo = HALOS.allocate(style.halo.color, style.halo.alpha);
  const pull = PULL_RINGS.allocate(style.pull.color, style.pull.alpha, style.pull.pattern);
  PULL_RINGS.setSize(pull, influence);
  const outline = OUTLINES.allocate(PALETTE.white, OUTLINE_ALPHA, OUTLINE_INNER);
  let state: InteractionState = 'idle';
  let disposed = false;
  let flashStrength = 0;
  let flashStart = -1e9;

  return {
    root,
    collider,
    gridPull: gridPull(def.kind, def.mass ?? KIND_DEFAULTS[def.kind].mass),
    influence,
    shadowRadius: radius * style.shadow,
    setState(next) {
      if (next === state) return;
      state = next;
      mesh.scale.setScalar(radius * STATE_SCALE[next]);
      PULL_RINGS.setAlpha(pull, Math.min(1, style.pull.alpha * STATE_PULL[next]));
    },
    flash(strength) {
      flashStrength = Math.max(strength, flashStrength * Math.exp(-(SHARED_TIME.value - flashStart) / FLASH_DECAY));
      flashStart = SHARED_TIME.value;
    },
    update(t) {
      if (disposed) return;
      setMotionTime(t);
      mesh.rotation.y = t * style.spin;
      const p = root.position;
      const age = SHARED_TIME.value - flashStart;
      const flash = age >= 0 && age < 2 ? flashStrength * Math.exp(-age / FLASH_DECAY) : 0;
      HALOS.setPosition(halo, p.x, p.y, p.z);
      let pulse = 1;
      let wave = 0;
      if (style.pulse > 0) {
        // The white star breathes: core, corona and glow together.
        wave = Math.sin(t * PULSE_RATE);
        pulse = 1 + style.pulse * wave;
        mesh.scale.setScalar(radius * STATE_SCALE[state] * pulse);
      }
      HALOS.setSize(halo, radius * style.halo.size * STATE_SCALE[state] * pulse * (1 + 0.5 * flash));
      HALOS.setAlpha(halo, Math.min(1, style.halo.alpha * STATE_HALO[state] * (1 + 0.25 * wave) + 0.5 * flash));
      if (coronaMaterial && glow) {
        coronaMaterial.uniforms.uPulse.value = wave;
        coronaMaterial.uniforms.uOpacity.value = 1 + 0.6 * flash;
        glow.scale.setScalar(radius * STATE_SCALE[state] * pulse);
      }
      if (lensMaterial && glow) {
        lensMaterial.uniforms.uFlash.value = flash;
        glow.scale.setScalar(radius * STATE_SCALE[state]);
      }
      PULL_RINGS.setPosition(pull, p.x, 0, p.z);
      OUTLINES.setPosition(outline, p.x, p.y, p.z);
      OUTLINES.setSize(outline, radius * style.extent * STATE_SCALE[state] * pulse * OUTLINE_OUTER);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      HALOS.release(halo);
      PULL_RINGS.release(pull);
      OUTLINES.release(outline);
      surfaceMaterial.dispose();
      lensMaterial?.dispose();
      coronaMaterial?.dispose();
    },
  };
}
