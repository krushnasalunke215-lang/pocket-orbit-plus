import { Group, Mesh, PlaneGeometry, RingGeometry, SphereGeometry } from '@iwsdk/core';
import { VISUAL_LIFT } from '../config.js';
import { HALOS } from './halo-sprites.js';
import { noRaycast, setMotionTime } from './shaders/common.js';
import { createSurfaceMaterial } from './shaders/planet.js';
import { captureRingMaterial, createStarMaterial, STAR_VARIANT } from './shaders/star.js';
import type { TargetVisual } from './visual-types.js';

// Target: a thin, softly pulsing capture ring on the board plane at the
// capture radius, and a star floating VISUAL_LIFT above it: a small
// emissive core and a billboard with a bright core, four long thin
// diffraction spikes and a soft glow, pulsing. TargetStar (a Group) turns
// about board +Y on the motion clock. Solved: whiter and larger. Unit size;
// the caller scales the root by the target radius.

const RING_OPACITY = 0.6;
/** The billboard's half width and the core sphere's radius (target radii). */
const STAR_SIZE = 1.5;
const CORE_RADIUS = 0.11;
const ringGeometry = new RingGeometry(0.85, 1, 96, 1).rotateX(-Math.PI / 2);
const coreGeometry = new SphereGeometry(1, 16, 12);
const billboard = new PlaneGeometry(2, 2);
const coreMaterial = createSurfaceMaterial({ color: 0xffd98a, band: 0xfff1c8, rim: 0xffffff, seed: 0.21, rimStrength: 0.3, emissive: 1.6 });
const glintMaterial = createStarMaterial(STAR_VARIANT.target, STAR_SIZE, 0xffc970);
/** High contrast: a thin white circle around the star (normal blending). */
const outlineMaterial = createStarMaterial(STAR_VARIANT.outline, 1, 0xffffff);

const HALO_IDLE = 1.6;
const HALO_SOLVED = 2.8;
/** Height of the star's center above the target point (unit target radius), before the lift. */
const STAR_HEIGHT = 0.12;

export function createTargetVisual(): TargetVisual {
  const root = new Group();
  root.name = 'Target';
  const ring = new Mesh(ringGeometry, captureRingMaterial);
  ring.position.y = 0.01;
  ring.renderOrder = 1;
  ring.raycast = noRaycast;
  const star = new Group();
  star.name = 'TargetStar';
  star.position.y = STAR_HEIGHT;
  const core = new Mesh(coreGeometry, coreMaterial);
  core.scale.setScalar(CORE_RADIUS);
  core.renderOrder = 2;
  core.raycast = noRaycast;
  const glint = new Mesh(billboard, glintMaterial);
  glint.name = 'TargetGlint';
  glint.renderOrder = 3;
  glint.frustumCulled = false;
  glint.raycast = noRaycast;
  // A child, so it pulses with the star; hidden unless high contrast.
  const outline = new Mesh(billboard, outlineMaterial);
  outline.name = 'TargetOutline';
  outline.renderOrder = 3;
  outline.frustumCulled = false;
  outline.raycast = noRaycast;
  outline.visible = false;
  star.add(core, glint, outline);
  root.add(ring, star);
  const halo = HALOS.allocate(0xffc970, 0.22);
  let solved = false;
  let contrast = false;
  return {
    root,
    setSolved(next) {
      if (next === solved) return;
      solved = next;
      glintMaterial.uniforms.uSolved.value = solved ? 1 : 0;
      HALOS.setColor(halo, solved ? 0xe8f0ff : 0xffc970);
      HALOS.setAlpha(halo, solved ? 0.4 : 0.22);
    },
    setHighContrast(on) {
      contrast = on;
      outline.visible = on;
    },
    update(t) {
      setMotionTime(t);
      // The star floats with the play layer; the capture ring stays on the glass.
      star.position.y = STAR_HEIGHT + VISUAL_LIFT / root.scale.x;
      star.rotation.y = t * (solved ? 2.4 : 0.6);
      const wave = Math.sin(t * (solved ? 6 : 2.5));
      const pulse = 1 + (solved ? 0.12 : 0.06) * wave;
      star.scale.setScalar(pulse * (solved ? 1.35 : 1));
      glintMaterial.uniforms.uPulse.value = wave;
      captureRingMaterial.uniforms.uOpacity.value = (contrast ? 1.2 : RING_OPACITY) * (0.85 + 0.15 * Math.sin(t * 1.7));
      const p = root.position;
      HALOS.setPosition(halo, p.x, p.y + star.position.y * root.scale.y, p.z);
      HALOS.setSize(halo, root.scale.x * (solved ? HALO_SOLVED : HALO_IDLE) * pulse);
    },
    starPose(out) {
      const p = root.position;
      out[0] = p.x;
      out[1] = p.y + star.position.y * root.scale.y;
      out[2] = p.z;
      return root.scale.x * CORE_RADIUS * 2.2;
    },
  };
}
