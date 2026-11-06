import type { BufferAttribute, IUniform } from '@iwsdk/core';

/*
 * Shared shader pieces. Every animated material references SHARED_TIME, so
 * one write per frame (from the visuals' update(t)) drives all of them.
 */

/** Seconds; written by the visuals' update(t) calls each frame. */
export const SHARED_TIME: IUniform<number> = { value: 0 };

/** Sets the shared clock (called by every visual's update; idempotent). */
export function setSharedTime(t: number): void {
  SHARED_TIME.value = t;
}

/**
 * GLSL: cheap hash-based value noise in 1D and 3D (smoothstep interpolation
 * of random lattice values). Used for planet bands and the accretion swirl.
 */
export const NOISE_GLSL = /* glsl */ `
float po_hash1(float n) { return fract(sin(n) * 43758.5453123); }
float po_noise1(float x) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(po_hash1(i), po_hash1(i + 1.0), f);
}
float po_noise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n = i.x + i.y * 57.0 + i.z * 113.0;
  return mix(
    mix(mix(po_hash1(n), po_hash1(n + 1.0), f.x),
        mix(po_hash1(n + 57.0), po_hash1(n + 58.0), f.x), f.y),
    mix(mix(po_hash1(n + 113.0), po_hash1(n + 114.0), f.x),
        mix(po_hash1(n + 170.0), po_hash1(n + 171.0), f.x), f.y),
    f.z);
}
`;

/** Marks `count` items starting at item `first` of an attribute for upload. */
export function markRange(attribute: BufferAttribute, first: number, count: number): void {
  attribute.addUpdateRange(first * attribute.itemSize, count * attribute.itemSize);
  attribute.needsUpdate = true;
}

/** Assigned to Object3D.raycast on decorative meshes so they never take grab-ray hits. */
export function noRaycast(): void {}
