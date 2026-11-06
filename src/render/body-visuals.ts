import {
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  type BufferGeometry,
} from '@iwsdk/core';
import { KIND_DEFAULTS, type BodyKind } from '../sim/bodies.js';
import type { BodyDef } from '../sim/level.js';
import { ROLE_COLORS } from './palette.js';
import type { BodyVisual, InteractionState } from './visual-types.js';

// Placeholder look (FEAT-004 replaces the internals). Shapes already differ
// per kind: sphere planet, faceted moon, ringed black hole, spiky repulsor.
// Geometry and materials are shared by every body and never disposed.
const sphere = new SphereGeometry(1, 24, 16);
const facets = new IcosahedronGeometry(1, 1);
const spikes = new OctahedronGeometry(1);
const ring = new RingGeometry(1.4, 1.9, 48).rotateX(-Math.PI / 2);
const colliderGeometry = new SphereGeometry(1, 16, 12);

function basic(color: number): MeshBasicMaterial {
  return new MeshBasicMaterial({ color, toneMapped: false });
}

const materials = {
  movablePlanet: basic(ROLE_COLORS.movablePlanet),
  fixedPlanet: basic(ROLE_COLORS.fixedPlanet),
  moon: basic(ROLE_COLORS.moon),
  blackHoleCore: basic(ROLE_COLORS.blackHoleCore),
  blackHoleRing: new MeshBasicMaterial({
    color: ROLE_COLORS.blackHoleRing,
    side: DoubleSide,
    toneMapped: false,
  }),
  repulsor: basic(ROLE_COLORS.repulsor),
};

/**
 * Invisible grab target. `visible: false` on the material hides it while
 * the mesh itself stays visible, because pointer hit tests skip objects
 * whose Object3D.visible is false. DoubleSide lets a ray starting inside
 * the sphere (a near pinch) still hit it.
 */
const colliderMaterial = new MeshBasicMaterial({ visible: false, side: DoubleSide });

const STATE_SCALE: Record<InteractionState, number> = { idle: 1, hover: 1.12, held: 1.2 };

function shapeFor(kind: BodyKind, movable: boolean): { geometry: BufferGeometry; material: MeshBasicMaterial } {
  switch (kind) {
    case 'planet':
      return { geometry: sphere, material: movable ? materials.movablePlanet : materials.fixedPlanet };
    case 'moon':
      return { geometry: facets, material: materials.moon };
    case 'black-hole':
      return { geometry: sphere, material: materials.blackHoleCore };
    case 'repulsor':
      return { geometry: spikes, material: materials.repulsor };
  }
}

/** Visual for one level body, in board units, centered on the body. */
export function createBodyVisual(def: BodyDef): BodyVisual {
  const radius = def.radius ?? KIND_DEFAULTS[def.kind].radius;
  const root = new Group();
  root.name = `Body ${def.id}`;
  const { geometry, material } = shapeFor(def.kind, Boolean(def.movable));
  const mesh = new Mesh(geometry, material);
  mesh.scale.setScalar(radius);
  root.add(mesh);
  if (def.kind === 'black-hole') {
    const accretion = new Mesh(ring, materials.blackHoleRing);
    accretion.scale.setScalar(radius);
    root.add(accretion);
  }

  let collider: Mesh | undefined;
  if (def.movable) {
    collider = new Mesh(colliderGeometry, colliderMaterial);
    collider.name = `Collider ${def.id}`;
    root.add(collider);
  }

  let state: InteractionState = 'idle';
  return {
    root,
    collider,
    setState(next) {
      if (next === state) return;
      state = next;
      mesh.scale.setScalar(radius * STATE_SCALE[next]);
    },
    update() {},
    dispose() {},
  };
}
