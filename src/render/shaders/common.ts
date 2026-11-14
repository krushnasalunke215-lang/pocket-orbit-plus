import { Vector2, type BufferAttribute, type IUniform, type Material, type ShaderMaterial, type Texture } from '@iwsdk/core';

/*
 * Shared shader pieces. Every animated material references SHARED_TIME (the
 * comet tail and the trails) or MOTION_TIME (decorative animation), so one
 * write per frame drives all of them.
 */

/**
 * Depth-occlusion uniforms, shared by every custom material (the same
 * objects, like SHARED_TIME). IWSDK's DepthSensingSystem writes these names
 * each frame into the uniforms of DepthOccludable entities' materials; its
 * own shader patch replaces built-in three chunks that these ShaderMaterials
 * do not contain, so it skips materials that already declare
 * `occlusionEnabled` and only updates the values. Because the objects are
 * shared, one occludable entity (the board root) keeps all of them current.
 * Every name the system writes or clears must exist here.
 */
export const OCCLUSION_UNIFORMS = {
  occlusionEnabled: { value: false } as IUniform<boolean>,
  uXRDepthTextureArray: { value: null } as IUniform<Texture | null>,
  uRawValueToMeters: { value: 0.001 } as IUniform<number>,
  uIsGPUDepth: { value: false } as IUniform<boolean>,
  uDepthNear: { value: 0 } as IUniform<number>,
  uViewportSize: { value: new Vector2() } as IUniform<Vector2>,
  uOcclusionBlurRadius: { value: 20 } as IUniform<number>,
  uOcclusionHardMode: { value: false } as IUniform<boolean>,
  uOcclusionMinMaxMode: { value: false } as IUniform<boolean>,
  uMinMaxTexture0: { value: null } as IUniform<Texture | null>,
  uMinMaxTexture1: { value: null } as IUniform<Texture | null>,
};

/** `uniforms` plus the shared occlusion uniforms (for a ShaderMaterial's `uniforms`). */
export function withOcclusion<T extends Record<string, IUniform>>(uniforms: T): T & typeof OCCLUSION_UNIFORMS {
  return { ...uniforms, ...OCCLUSION_UNIFORMS };
}

/** Re-links the shared occlusion uniforms after material.clone() deep-copied them. */
export function linkOcclusion(material: ShaderMaterial): ShaderMaterial {
  Object.assign(material.uniforms, OCCLUSION_UNIFORMS);
  return material;
}

/** GLSL vertex declarations of the occlusion chunk. */
export const OCCLUSION_VERTEX_PARS = /* glsl */ `
varying float vOcclusionViewDepth;
`;

/**
 * GLSL vertex statement, after gl_Position is written: for a perspective
 * projection clip w is the view-space distance along -Z, which is what the
 * depth texture stores.
 */
export const OCCLUSION_VERTEX = /* glsl */ `
vOcclusionViewDepth = gl_Position.w;
`;

/**
 * GLSL fragment declarations: the uniform names DepthSensingSystem writes,
 * and po_occluded(), a hard single-sample test like IWSDK's
 * OcclusionGetSample, but with a distance-scaled margin (about 5.5 cm at
 * 1.15 m): IWSDK's test
 * (smoothstep over 5 cm, hidden below 1%) hid the whole board in IWER,
 * because the table it lies on is within a few millimeters of it, and a
 * fixed 2 cm margin still cut the board into bands there.
 * With occlusionEnabled false (no depth data, occlusion off, desktop) it
 * returns false before touching the texture.
 */
export const OCCLUSION_FRAGMENT_PARS = /* glsl */ `
uniform bool occlusionEnabled;
uniform float uRawValueToMeters;
uniform bool uIsGPUDepth;
uniform float uDepthNear;
uniform vec2 uViewportSize;
uniform sampler2DArray uXRDepthTextureArray;
varying float vOcclusionViewDepth;
#ifndef VIEW_ID
#define VIEW_ID 0
#endif
// The board lies on the table 4 mm up: a fragment is hidden only when the
// real surface is PO_OCCLUSION_BIAS + PO_OCCLUSION_BIAS_PER_M * distance
// (meters) in front of it, so the table under the board never hides it
// (depth error grows with distance; IWER's depth steps by several cm at
// table range) while a cup standing on it still does.
#define PO_OCCLUSION_BIAS 0.02
#define PO_OCCLUSION_BIAS_PER_M 0.03
float po_depthMeters(vec2 uv) {
  float raw = texture(uXRDepthTextureArray, vec3(uv.x, uv.y, float(VIEW_ID))).r;
  if (uIsGPUDepth) return uRawValueToMeters * uDepthNear / (1.0 - raw);
  return raw * uRawValueToMeters;
}
bool po_occluded() {
  if (!occlusionEnabled) return false;
  vec2 screenUV = gl_FragCoord.xy / uViewportSize;
  vec2 depthUV = uIsGPUDepth ? screenUV : vec2(screenUV.x, 1.0 - screenUV.y);
  float bias = PO_OCCLUSION_BIAS + PO_OCCLUSION_BIAS_PER_M * vOcclusionViewDepth;
  return po_depthMeters(depthUV) < vOcclusionViewDepth - bias;
}
`;

/**
 * Gives a built-in material (MeshBasicMaterial and the like) this module's
 * occlusion chunk and shared uniforms, so DepthSensingSystem's own patch
 * (which has no bias) skips it and it is occluded exactly like the custom
 * shaders. Call once per module material.
 */
export function occludeBuiltin<M extends Material>(material: M): M {
  material.onBeforeCompile = (shader: OcclusionShader) => {
    Object.assign(shader.uniforms, OCCLUSION_UNIFORMS);
    shader.vertexShader = OCCLUSION_VERTEX_PARS + shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\nvOcclusionViewDepth = -mvPosition.z;',
    );
    shader.fragmentShader = OCCLUSION_FRAGMENT_PARS + shader.fragmentShader.replace(
      'void main() {',
      `void main() {\n${OCCLUSION_FRAGMENT}`,
    );
  };
  return material;
}

/** The parts of three's onBeforeCompile shader object occludeBuiltin edits. */
export interface OcclusionShader {
  uniforms: { [name: string]: IUniform };
  vertexShader: string;
  fragmentShader: string;
}

/** GLSL fragment statement, first in main(): drops fragments behind real surfaces. */
export const OCCLUSION_FRAGMENT = /* glsl */ `
if (po_occluded()) discard;
`;

/**
 * Seconds of the real clock: the comet tail's particle ages and the trail
 * segments' ages. Written by the comet's update(dt, t) each frame.
 */
export const SHARED_TIME: IUniform<number> = { value: 0 };

/** Sets the shared clock (the comet's update; idempotent). */
export function setSharedTime(t: number): void {
  SHARED_TIME.value = t;
}

/**
 * Seconds of the decorative clock: planet bands, flowing rings and the
 * accretion swirl. The body, board, target and well visuals write it from
 * their update(t), which the systems feed motionTime() (src/xr/runtime.ts),
 * so it stands still while reduced motion is on.
 */
export const MOTION_TIME: IUniform<number> = { value: 0 };

/** Sets the decorative clock (called by the decorative visuals' update; idempotent). */
export function setMotionTime(t: number): void {
  MOTION_TIME.value = t;
}

/** High contrast, 0 or 1, shared by the board and body surface shaders (one write switches all). */
export const HIGH_CONTRAST: IUniform<number> = { value: 0 };

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

/** Comic ink: the outline and line color of the art direction. */
export const INK_COLOR = 0x101018;

/**
 * GLSL comic shading.
 *   po_toon(ndl): three crisp bands, 1.0 lit, 0.72 mid, 0.45 shadow.
 *   po_halftone(dir, rows): distance (cell units, 0 at a dot center) to the
 *     nearest dot of a lat/long dot grid with `rows` rows pole to pole and
 *     evenly spaced dots in each row. `dir` is an object-space direction,
 *     so both eyes see the same dots on the surface.
 *   po_dots(dir, rows, shade): dot coverage 0..1; the dots grow with `shade`.
 *   po_shade(ndl): how deep a point is in shadow (0 lit, 1 deep shadow).
 */
export const TOON_GLSL = /* glsl */ `
float po_toon(float ndl) {
  float lit = smoothstep(0.40, 0.44, ndl);
  float mid = smoothstep(-0.06, -0.02, ndl);
  return mix(0.45, mix(0.72, 1.0, lit), mid);
}
float po_halftone(vec3 dir, float rows) {
  vec3 d = normalize(dir);
  float lat = asin(clamp(d.y, -1.0, 1.0));
  float r = lat * rows / 3.14159265;
  float row = floor(r + 0.5);
  float latC = row * 3.14159265 / rows;
  float n = max(1.0, floor(cos(latC) * rows * 2.0 + 0.5));
  float lon = (atan(d.z, d.x) / 6.2831853 + 0.5) * n;
  float col = floor(lon + 0.5);
  float dx = (lon - col) * 2.0 * rows * cos(lat) / n;
  return length(vec2(dx, r - row));
}
float po_shade(float ndl) {
  return clamp((0.12 - ndl) / 0.7, 0.0, 1.0);
}
float po_dots(vec3 dir, float rows, float shade) {
  float radius = 0.6 * sqrt(shade);
  return (1.0 - smoothstep(radius - 0.07, radius + 0.07, po_halftone(dir, rows))) * step(0.001, shade);
}
`;

/** Marks `count` items starting at item `first` of an attribute for upload. */
export function markRange(attribute: BufferAttribute, first: number, count: number): void {
  attribute.addUpdateRange(first * attribute.itemSize, count * attribute.itemSize);
  attribute.needsUpdate = true;
}

/** Assigned to Object3D.raycast on decorative meshes so they never take grab-ray hits. */
export function noRaycast(): void {}
