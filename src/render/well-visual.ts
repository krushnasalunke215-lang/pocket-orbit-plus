import { CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, SphereGeometry } from '@iwsdk/core';
import { WELL_INFLUENCE_RADIUS } from '../sim/wells.js';
import { HALOS, PULL_RINGS } from './halo-sprites.js';
import { ROLE_COLORS } from './palette.js';
import { noRaycast, setSharedTime } from './shaders/common.js';
import { createSurfaceMaterial } from './shaders/planet.js';
import { PULL_PATTERN } from './shaders/pull-ring.js';
import { createRingMaterial, RING_PATTERN } from './shaders/ring.js';
import type { WellVisual } from './visual-types.js';

/*
 * Your Table wells, in board units under the board root. A real object
 * gets a pulsing glowing ring on the board plane around its base, its pull
 * ring (the well's flyby radius, solid like a planet's) and a halo at its
 * top, so the glow sits on the real cup. A puck (the fallback) adds a flat
 * disc and an invisible grab collider. Geometry and materials are shared
 * module resources; each well owns one halo and one pull-ring slot.
 */

/** Ring radii in board units (the ring geometry is unit; the mesh scales it). */
const RING_INNER = 0.05;
const RING_OUTER = 0.07;
const PUCK_RADIUS = 0.06;
const PUCK_THICKNESS = 0.025;
const PULSE_RATE = 2.2;
const HALO_SIZE = 0.16;
const HALO_ALPHA = 0.32;
const PULL_ALPHA = 0.3;

const ringGeometry = new RingGeometry(RING_INNER, RING_OUTER, 48, 1).rotateX(-Math.PI / 2);
const puckGeometry = new CylinderGeometry(PUCK_RADIUS, PUCK_RADIUS, PUCK_THICKNESS, 32, 1);
const colliderGeometry = new SphereGeometry(1, 16, 12);
const ringMaterial = createRingMaterial(ROLE_COLORS.well, RING_PATTERN.solid, RING_INNER, RING_OUTER, 0.9);
const puckMaterial = createSurfaceMaterial({ color: ROLE_COLORS.well, band: 0xc8f5e8, rim: 0xffffff, seed: 0.37, bandScale: 2 });
const colliderMaterial = new MeshBasicMaterial({ visible: false, side: DoubleSide });

export function createWellVisual(puck: boolean): WellVisual {
  const root = new Group();
  root.name = puck ? 'WellPuck' : 'WellMarker';
  const ring = new Mesh(ringGeometry, ringMaterial);
  ring.position.y = 0.004;
  ring.renderOrder = 1;
  ring.raycast = noRaycast;
  root.add(ring);

  let collider: Mesh | undefined;
  if (puck) {
    const disc = new Mesh(puckGeometry, puckMaterial);
    disc.position.y = PUCK_THICKNESS / 2;
    disc.raycast = noRaycast;
    root.add(disc);
    collider = new Mesh(colliderGeometry, colliderMaterial);
    collider.name = 'Collider puck';
    root.add(collider);
  }

  const halo = HALOS.allocate(ROLE_COLORS.well, HALO_ALPHA);
  const pull = PULL_RINGS.allocate(ROLE_COLORS.well, PULL_ALPHA, PULL_PATTERN.solid);
  PULL_RINGS.setSize(pull, WELL_INFLUENCE_RADIUS);
  let height = 0;
  let selected = false;
  let visible = true;
  let disposed = false;

  return {
    root,
    collider,
    setHeight(h) {
      height = Math.max(0, h);
    },
    setSelected(next) {
      selected = next;
    },
    setVisible(next) {
      visible = next;
      root.visible = next;
    },
    update(t) {
      if (disposed) return;
      setSharedTime(t);
      const pulse = 1 + 0.12 * Math.sin(t * PULSE_RATE);
      ring.scale.set(pulse, 1, pulse);
      const p = root.position;
      const boost = selected ? 1.6 : 1;
      HALOS.setPosition(halo, p.x, p.y + height, p.z);
      HALOS.setSize(halo, visible ? HALO_SIZE * pulse : 0);
      HALOS.setAlpha(halo, Math.min(1, HALO_ALPHA * boost));
      PULL_RINGS.setPosition(pull, p.x, 0, p.z);
      PULL_RINGS.setSize(pull, visible ? WELL_INFLUENCE_RADIUS : 0);
      PULL_RINGS.setAlpha(pull, Math.min(1, PULL_ALPHA * boost));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      HALOS.release(halo);
      PULL_RINGS.release(pull);
    },
  };
}
