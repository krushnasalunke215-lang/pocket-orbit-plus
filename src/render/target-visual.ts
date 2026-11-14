import {
  Color,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Shape,
  ShapeGeometry,
  type ShaderMaterial,
} from '@iwsdk/core';
import { HALOS } from './halo-sprites.js';
import { PALETTE, ROLE_COLORS } from './palette.js';
import { noRaycast, occludeBuiltin, setMotionTime } from './shaders/common.js';
import { inkDark } from './shaders/ink.js';
import { createSurfaceMaterial } from './shaders/planet.js';
import type { TargetVisual } from './visual-types.js';

// Target: a thin yellow ring at the capture radius on the board plane and a
// chunky five-point star (extruded, toon-shaded, ink-outlined) that turns
// about board +Y and pulses, with a halo slot for glow. Solved turns the
// star white and swells the halo. Unit size; the caller scales the root by
// the target radius.
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

const RING_OPACITY = 0.75;
/** Star thickness (unit target radius). */
const STAR_DEPTH = 0.14;
const STAR = starShape(5, 0.62, 0.27);
const ringGeometry = new RingGeometry(0.92, 1, 64).rotateX(-Math.PI / 2);
// Extruded along +Z, then laid flat: the star spans y in [-depth/2, depth/2] about its center.
const starGeometry = new ExtrudeGeometry(STAR, {
  depth: STAR_DEPTH,
  bevelEnabled: true,
  bevelThickness: 0.035,
  bevelSize: 0.035,
  bevelSegments: 1,
  curveSegments: 1,
})
  .translate(0, 0, -STAR_DEPTH / 2)
  .rotateX(-Math.PI / 2);
const outlineGeometry = new ShapeGeometry(STAR).rotateX(-Math.PI / 2);
const ringMaterial = occludeBuiltin(new MeshBasicMaterial({
  color: ROLE_COLORS.target,
  transparent: true,
  opacity: RING_OPACITY,
  depthWrite: false,
  toneMapped: false,
}));
const starMaterial: ShaderMaterial = createSurfaceMaterial({
  color: ROLE_COLORS.target,
  band: ROLE_COLORS.target,
  rim: 0xfff6c0,
  seed: 0.21,
  bandScale: 0,
  rimStrength: 0.6,
  dotRows: 5,
});

/** High contrast: a white star outline drawn just under the glyph. */
const outlineMaterial = occludeBuiltin(new MeshBasicMaterial({
  color: PALETTE.white,
  transparent: true,
  depthWrite: false,
  toneMapped: false,
}));

const HALO_IDLE = 2.4;
const HALO_SOLVED = 4.2;
const OUTLINE_SCALE = 1.3;
/** Height of the star's center above the target point (unit target radius). */
const STAR_HEIGHT = 0.02 + STAR_DEPTH / 2 + 0.035;

const scratch = new Color();

export function createTargetVisual(): TargetVisual {
  const root = new Group();
  root.name = 'Target';
  const ring = new Mesh(ringGeometry, ringMaterial);
  ring.raycast = noRaycast;
  const star = new Mesh(starGeometry, starMaterial);
  star.name = 'TargetStar';
  star.position.y = STAR_HEIGHT;
  star.renderOrder = 2;
  star.raycast = noRaycast;
  const hull = new Mesh(starGeometry, inkDark);
  hull.name = 'InkHull';
  hull.raycast = noRaycast;
  star.add(hull);
  // A child, so it turns and pulses with the glyph; hidden unless high contrast.
  const outline = new Mesh(outlineGeometry, outlineMaterial);
  outline.name = 'TargetOutline';
  outline.scale.setScalar(OUTLINE_SCALE);
  outline.position.y = -STAR_DEPTH / 2 - 0.045;
  outline.renderOrder = 1;
  outline.raycast = noRaycast;
  outline.visible = false;
  star.add(outline);
  root.add(ring, star);
  const halo = HALOS.allocate(ROLE_COLORS.target, 0.35);
  let solved = false;
  const setStarColor = (hex: number) => {
    scratch.setHex(hex);
    (starMaterial.uniforms.uColor.value as Color).copy(scratch);
    (starMaterial.uniforms.uBandColor.value as Color).copy(scratch);
  };
  return {
    root,
    setSolved(next) {
      if (next === solved) return;
      solved = next;
      setStarColor(solved ? PALETTE.white : ROLE_COLORS.target);
      HALOS.setAlpha(halo, solved ? 0.6 : 0.35);
    },
    setHighContrast(on) {
      outline.visible = on;
      ringMaterial.opacity = on ? 1 : RING_OPACITY;
    },
    update(t) {
      setMotionTime(t);
      star.rotation.y = t * (solved ? 2.4 : 0.6);
      const pulse = 1 + (solved ? 0.12 : 0.06) * Math.sin(t * (solved ? 6 : 2.5));
      star.scale.setScalar(pulse);
      const p = root.position;
      HALOS.setPosition(halo, p.x, p.y + star.position.y * root.scale.y, p.z);
      HALOS.setSize(halo, root.scale.x * (solved ? HALO_SOLVED : HALO_IDLE) * pulse);
    },
  };
}
