import { Group, Mesh, MeshBasicMaterial, RingGeometry, Shape, ShapeGeometry } from '@iwsdk/core';
import { PALETTE, ROLE_COLORS } from './palette.js';
import type { TargetVisual } from './visual-types.js';

// Placeholder look (FEAT-004 adds the glow): a flat yellow ring at the
// capture radius with a slowly turning five-point star inside. Unit size;
// the caller scales the root by the target radius.
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

const ringGeometry = new RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2);
const starGeometry = new ShapeGeometry(starShape(5, 0.55, 0.22)).rotateX(-Math.PI / 2);
const ringMaterial = new MeshBasicMaterial({ color: ROLE_COLORS.target, toneMapped: false });
const starMaterial = new MeshBasicMaterial({ color: ROLE_COLORS.target, toneMapped: false });

export function createTargetVisual(): TargetVisual {
  const root = new Group();
  root.name = 'Target';
  const star = new Mesh(starGeometry, starMaterial);
  star.position.y = 0.01;
  root.add(new Mesh(ringGeometry, ringMaterial), star);
  let solved = false;
  return {
    root,
    setSolved(next) {
      if (next === solved) return;
      solved = next;
      starMaterial.color.setHex(solved ? PALETTE.white : ROLE_COLORS.target);
    },
    update(t) {
      star.rotation.y = t * (solved ? 2.4 : 0.6);
    },
  };
}
