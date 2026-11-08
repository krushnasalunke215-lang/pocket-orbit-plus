import {
  AdditiveBlending,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Shape,
  ShapeGeometry,
} from '@iwsdk/core';
import { HALOS } from './halo-sprites.js';
import { PALETTE, ROLE_COLORS } from './palette.js';
import { noRaycast, occludeBuiltin, setSharedTime } from './shaders/common.js';
import type { TargetVisual } from './visual-types.js';

// Target: a thin yellow ring at the capture radius and a five-point star
// glyph that turns about board +Y and pulses, with a halo slot for glow.
// Solved brightens the star and swells the halo. Unit size; the caller
// scales the root by the target radius.
function starShape(points: number, outer: number, inner: number): Shape {
  const shape = new Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2;
    if (i === 0) shape.moveTo(Math.sin(a) * r, Math.cos(a) * r);
    else shape.lineTo(Math.sin(a) * r, Math.cos(a) * r);
  }
  shape.closePath();
  return shape;
}

const ringGeometry = new RingGeometry(0.92, 1, 64).rotateX(-Math.PI / 2);
const starGeometry = new ShapeGeometry(starShape(5, 0.62, 0.25)).rotateX(-Math.PI / 2);
const ringMaterial = occludeBuiltin(new MeshBasicMaterial({
  color: ROLE_COLORS.target,
  transparent: true,
  opacity: 0.75,
  depthWrite: false,
  toneMapped: false,
}));
const starMaterial = occludeBuiltin(new MeshBasicMaterial({
  color: ROLE_COLORS.target,
  transparent: true,
  blending: AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
}));

const HALO_IDLE = 2.4;
const HALO_SOLVED = 4.2;

export function createTargetVisual(): TargetVisual {
  const root = new Group();
  root.name = 'Target';
  const ring = new Mesh(ringGeometry, ringMaterial);
  ring.raycast = noRaycast;
  const star = new Mesh(starGeometry, starMaterial);
  star.position.y = 0.02;
  star.renderOrder = 2;
  star.raycast = noRaycast;
  root.add(ring, star);
  const halo = HALOS.allocate(ROLE_COLORS.target, 0.35);
  let solved = false;
  return {
    root,
    setSolved(next) {
      if (next === solved) return;
      solved = next;
      starMaterial.color.setHex(solved ? PALETTE.white : ROLE_COLORS.target);
      HALOS.setAlpha(halo, solved ? 0.6 : 0.35);
    },
    update(t) {
      setSharedTime(t);
      star.rotation.y = t * (solved ? 2.4 : 0.6);
      const pulse = 1 + (solved ? 0.12 : 0.06) * Math.sin(t * (solved ? 6 : 2.5));
      star.scale.setScalar(pulse);
      const p = root.position;
      HALOS.setPosition(halo, p.x, p.y + 0.01, p.z);
      HALOS.setSize(halo, root.scale.x * (solved ? HALO_SOLVED : HALO_IDLE) * pulse);
    },
  };
}
