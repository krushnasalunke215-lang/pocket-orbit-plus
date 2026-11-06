import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SphereGeometry,
  type Material,
} from '@iwsdk/core';
import { KIND_DEFAULTS, type BodyKind } from '../sim/bodies.js';
import type { BodyDef } from '../sim/level.js';
import { HALOS, PULL_RINGS } from './halo-sprites.js';
import { PALETTE, ROLE_COLORS } from './palette.js';
import { ACCRETION_INNER, ACCRETION_OUTER, accretionMaterial } from './shaders/accretion.js';
import { noRaycast, setSharedTime } from './shaders/common.js';
import { createSurfaceMaterial, type SurfaceColors } from './shaders/planet.js';
import { createRingMaterial, RING_PATTERN } from './shaders/ring.js';
import type { BodyVisual, InteractionState } from './visual-types.js';

/*
 * Level bodies. Kinds differ by shape and ring pattern as well as color:
 *   planet     banded sphere + solid tilted ring
 *   moon       faceted icosahedron + dotted ring
 *   black hole black core + thick swirling accretion ring
 *   repulsor   spiky stellated octahedron + dashed rings drifting outward
 * Each body also owns one halo slot (fake bloom) and one pull-ring slot
 * (its influence radius on the board). Geometry and ring materials are
 * shared module resources; only the surface material is cloned per body.
 */

const sphere = new SphereGeometry(1, 24, 16);
/** Non-indexed, so computeVertexNormals gives one flat normal per facet. */
const facets = new IcosahedronGeometry(1, 1);
facets.computeVertexNormals();
const spikes = createStellatedOctahedron(0.55, 1.15);
const planetRing = new RingGeometry(1.45, 2.05, 64, 1).rotateX(-Math.PI / 2);
const moonRing = new RingGeometry(1.7, 2.3, 64, 1).rotateX(-Math.PI / 2);
const accretionRing = new RingGeometry(ACCRETION_INNER, ACCRETION_OUTER, 64, 2).rotateX(-Math.PI / 2);
const repulsorRing = new RingGeometry(1.3, 3.0, 64, 3).rotateX(-Math.PI / 2);
const colliderGeometry = new SphereGeometry(1, 16, 12);

/** Ring materials: one per style, created once. */
const ringMaterials = {
  movablePlanet: createRingMaterial(ROLE_COLORS.movablePlanet, RING_PATTERN.solid, 1.45, 2.05, 0.7),
  fixedPlanet: createRingMaterial(ROLE_COLORS.fixedPlanet, RING_PATTERN.solid, 1.45, 2.05, 0.7),
  moon: createRingMaterial(ROLE_COLORS.moon, RING_PATTERN.dotted, 1.7, 2.3, 1),
  repulsor: createRingMaterial(ROLE_COLORS.repulsorRing, RING_PATTERN.dashedOutward, 1.3, 3.0, 0.9),
};

/**
 * Invisible grab target. `visible: false` on the material hides it while
 * the mesh itself stays visible, because pointer hit tests skip objects
 * whose Object3D.visible is false. DoubleSide lets a ray starting inside
 * the sphere (a near pinch) still hit it.
 */
const colliderMaterial = new MeshBasicMaterial({ visible: false, side: DoubleSide });

const STATE_SCALE: Record<InteractionState, number> = { idle: 1, hover: 1.12, held: 1.2 };
const STATE_HALO: Record<InteractionState, number> = { idle: 1, hover: 1.6, held: 2 };
const STATE_PULL: Record<InteractionState, number> = { idle: 1, hover: 1.8, held: 2.4 };

interface KindStyle {
  geometry: BufferGeometry;
  surface: SurfaceColors;
  ring: { geometry: BufferGeometry; material: Material; tilt: number } | null;
  halo: { color: number; size: number; alpha: number };
  pull: { color: number; alpha: number; pattern: number };
  spin: number;
}

/** Small stable hash of the body id, so band patterns differ per body but never per run. */
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
        geometry: sphere,
        surface: { color, band: movable ? 0xb9e3fa : 0x7fdcc0, rim: color, seed },
        ring: {
          geometry: planetRing,
          material: movable ? ringMaterials.movablePlanet : ringMaterials.fixedPlanet,
          tilt: 0.38,
        },
        halo: { color, size: 2.6, alpha: 0.32 },
        pull: { color, alpha: 0.35, pattern: 0 },
        spin: 0.25,
      };
    }
    case 'moon':
      return {
        geometry: facets,
        surface: { color: ROLE_COLORS.moon, band: 0xf0c4dc, rim: 0xf6dceb, seed, bandScale: 3 },
        ring: { geometry: moonRing, material: ringMaterials.moon, tilt: 0 },
        halo: { color: ROLE_COLORS.moon, size: 2.4, alpha: 0.3 },
        pull: { color: ROLE_COLORS.moon, alpha: 0.3, pattern: 1 },
        spin: 0.6,
      };
    case 'black-hole':
      return {
        geometry: sphere,
        surface: { color: PALETTE.black, band: PALETTE.black, rim: ROLE_COLORS.blackHoleRing, seed },
        ring: { geometry: accretionRing, material: accretionMaterial, tilt: 0.22 },
        halo: { color: ROLE_COLORS.blackHoleRing, size: 3.4, alpha: 0.28 },
        pull: { color: ROLE_COLORS.blackHoleRing, alpha: 0.4, pattern: 0 },
        spin: 0,
      };
    case 'repulsor':
      return {
        geometry: spikes,
        surface: { color: ROLE_COLORS.repulsor, band: 0xdfefff, rim: ROLE_COLORS.repulsorRing, seed, bandScale: 2 },
        ring: { geometry: repulsorRing, material: ringMaterials.repulsor, tilt: 0 },
        halo: { color: ROLE_COLORS.repulsor, size: 2.8, alpha: 0.3 },
        pull: { color: ROLE_COLORS.repulsorRing, alpha: 0.35, pattern: 2 },
        spin: 0.8,
      };
  }
}

/** Visual for one level body, in board units, centered on the body. */
export function createBodyVisual(def: BodyDef): BodyVisual {
  const radius = def.radius ?? KIND_DEFAULTS[def.kind].radius;
  const influence = KIND_DEFAULTS[def.kind].influenceRadius;
  const style = styleFor(def.kind, Boolean(def.movable), seedOf(def.id));
  const root = new Group();
  root.name = `Body ${def.id}`;

  const surfaceMaterial = createSurfaceMaterial(style.surface);
  const mesh = new Mesh(style.geometry, surfaceMaterial);
  mesh.scale.setScalar(radius);
  root.add(mesh);

  if (style.ring) {
    const ring = new Mesh(style.ring.geometry, style.ring.material);
    ring.scale.setScalar(radius);
    ring.rotation.set(style.ring.tilt, 0, style.ring.tilt * 0.5);
    ring.renderOrder = 1;
    ring.raycast = noRaycast;
    root.add(ring);
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
  let state: InteractionState = 'idle';
  let disposed = false;

  return {
    root,
    collider,
    setState(next) {
      if (next === state) return;
      state = next;
      mesh.scale.setScalar(radius * STATE_SCALE[next]);
      HALOS.setAlpha(halo, Math.min(1, style.halo.alpha * STATE_HALO[next]));
      PULL_RINGS.setAlpha(pull, Math.min(1, style.pull.alpha * STATE_PULL[next]));
    },
    update(t) {
      if (disposed) return;
      setSharedTime(t);
      mesh.rotation.y = t * style.spin;
      const p = root.position;
      HALOS.setPosition(halo, p.x, p.y, p.z);
      HALOS.setSize(halo, radius * style.halo.size * STATE_SCALE[state]);
      PULL_RINGS.setPosition(pull, p.x, 0, p.z);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      HALOS.release(halo);
      PULL_RINGS.release(pull);
      surfaceMaterial.dispose();
    },
  };
}

/**
 * Stellated octahedron: each of the 8 octahedron faces (base vertices at
 * `base`) gets a spike apex along its normal at `tip`. Non-indexed with
 * flat normals, 24 triangles.
 */
function createStellatedOctahedron(base: number, tip: number): BufferGeometry {
  const v = [
    [base, 0, 0],
    [-base, 0, 0],
    [0, base, 0],
    [0, -base, 0],
    [0, 0, base],
    [0, 0, -base],
  ];
  // Counter-clockwise from outside.
  const faces = [
    [0, 2, 4],
    [4, 2, 1],
    [1, 2, 5],
    [5, 2, 0],
    [4, 3, 0],
    [1, 3, 4],
    [5, 3, 1],
    [0, 3, 5],
  ];
  const positions: number[] = [];
  for (const [a, b, c] of faces) {
    const n = [v[a][0] + v[b][0] + v[c][0], v[a][1] + v[b][1] + v[c][1], v[a][2] + v[b][2] + v[c][2]];
    const len = Math.hypot(n[0], n[1], n[2]);
    const apex = [(n[0] / len) * tip, (n[1] / len) * tip, (n[2] / len) * tip];
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      positions.push(...v[p], ...v[q], ...apex);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  return geometry;
}
