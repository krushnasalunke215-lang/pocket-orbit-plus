import { AdditiveBlending, Color, NormalBlending, ShaderMaterial } from '@iwsdk/core';
import {
  ADDITIVE_ALPHA_FRAGMENT,
  GRADE_GLSL,
  linkOcclusion,
  MOTION_TIME,
  OCCLUSION_FRAGMENT,
  OCCLUSION_FRAGMENT_PARS,
  OCCLUSION_VERTEX,
  OCCLUSION_VERTEX_PARS,
  withOcclusion,
} from './common.js';

/*
 * Star billboards on the board (a PlaneGeometry(2, 2) child centred on the
 * body; the quad faces the camera and is uSize of the parent's scale wide,
 * so a sphere in front hides its middle). Variants (uVariant):
 *   0 corona: the white star's soft glow and 8 slow streamer rays,
 *     breathing with uPulse;
 *   1 target: a bright core, 4 long thin diffraction spikes and a soft glow
 *     (uSolved: whiter and larger);
 *   2 outline: a thin white circle (the target's high-contrast outline,
 *     normal blending).
 * Thin features never get thinner than about a pixel (fwidth), they fade
 * instead, so nothing shimmers. One program; clone per object.
 */

export const STAR_VARIANT = { corona: 0, target: 1, outline: 2 } as const;

/** GLSL vertex: the quad in view space around the object's origin, uSize parent radii per unit. */
const billboardVertex = /* glsl */ `${OCCLUSION_VERTEX_PARS}
uniform float uSize;
varying vec2 vUv;
void main() {
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float scale = length(modelViewMatrix[0].xyz);
  mv.xy += position.xy * uSize * scale;
  vUv = position.xy * uSize;
  gl_Position = projectionMatrix * mv;
  ${OCCLUSION_VERTEX}
}
`;

const starFragment = /* glsl */ `${OCCLUSION_FRAGMENT_PARS}
uniform float uVariant;
uniform float uSize;
uniform vec3 uColor;
uniform float uPulse;
uniform float uSolved;
uniform float uOpacity;
uniform float uTime;
varying vec2 vUv;
${GRADE_GLSL}
const float TAU = 6.28318530718;
/** A line along one axis, at least about a pixel wide; energy kept as it widens. */
float po_spike(float across, float along, float width, float len) {
  float w = max(width, fwidth(across) * 0.9);
  float core = exp(-pow(across / w, 2.0)) * (width / w);
  return core * pow(max(0.0, 1.0 - abs(along) / len), 2.2);
}
void main() {
  ${OCCLUSION_FRAGMENT}
  float d = length(vUv);
  if (d >= uSize) discard;
  float edge = 1.0 - smoothstep(uSize * 0.7, uSize, d);
  vec3 color;
  float alpha = 1.0;
  if (uVariant < 0.5) {
    // Corona: glow falling off from the limb (radius 1) and 8 streamers that turn slowly.
    float a = atan(vUv.y, vUv.x);
    float out1 = max(d - 0.92, 0.0);
    float glow = exp(-out1 * 2.2) * 0.7 + exp(-out1 * 8.0) * 0.8;
    float rays = pow(0.5 + 0.5 * cos(8.0 * a + uTime * 0.05 + 0.6 * sin(a * 3.0 + uTime * 0.11)), 5.0);
    rays *= exp(-out1 * 1.0) * smoothstep(0.9, 1.25, d);
    float breathe = 0.85 + 0.3 * uPulse;
    color = uColor * (glow + rays * 0.7) * breathe * edge;
  } else if (uVariant < 1.5) {
    // Target: core, glow, 4 diffraction spikes (along the view's x and y).
    float s = 1.0 + 0.5 * uSolved;
    float core = exp(-d * d * 60.0 / (s * s)) * 2.2;
    float glow = exp(-d * 3.4 / s) * 0.45;
    float spikes = po_spike(vUv.y, vUv.x, 0.014 * s, uSize * 0.95) + po_spike(vUv.x, vUv.y, 0.014 * s, uSize * 0.95);
    vec3 tint = mix(uColor, vec3(0.92, 0.96, 1.0), uSolved);
    color = tint * (core + glow + spikes * 1.1) * (0.9 + 0.2 * uPulse) * edge;
  } else {
    // Outline: a thin white circle at 0.8 of the quad.
    float w = max(0.025, fwidth(d) * 1.2);
    float ring = 1.0 - smoothstep(w * 0.5, w, abs(d - uSize * 0.8));
    gl_FragColor = vec4(vec3(1.0), ring * uOpacity);
    #include <colorspace_fragment>
    return;
  }
  gl_FragColor = vec4(po_grade(color) * uOpacity, alpha);
  #include <colorspace_fragment>
  ${ADDITIVE_ALPHA_FRAGMENT}
}
`;

const starTemplate = new ShaderMaterial({
  name: 'StarBillboard',
  uniforms: withOcclusion({
    uVariant: { value: 0 },
    uSize: { value: 3 },
    uColor: { value: new Color(0xffffff) },
    uPulse: { value: 0 },
    uSolved: { value: 0 },
    uOpacity: { value: 1 },
    uTime: MOTION_TIME,
  }),
  vertexShader: billboardVertex,
  fragmentShader: starFragment,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  toneMapped: false,
});

/** A billboard material of `variant`, uSize parent radii wide (half width), sharing the program and the clock. */
export function createStarMaterial(variant: number, size: number, color: number): ShaderMaterial {
  const material = linkOcclusion(starTemplate.clone());
  material.uniforms.uTime = MOTION_TIME;
  material.uniforms.uVariant.value = variant;
  material.uniforms.uSize.value = size;
  (material.uniforms.uColor.value as Color).setHex(color);
  if (variant === STAR_VARIANT.outline) material.blending = NormalBlending;
  return material;
}

/** GLSL vertex: the capture ring lies flat in XZ (unit radius). */
const ringVertex = /* glsl */ `${OCCLUSION_VERTEX_PARS}
varying vec2 vLocal;
void main() {
  vLocal = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  ${OCCLUSION_VERTEX}
}
`;

/** GLSL fragment: a thin soft line at r 0.97 (at least about a pixel) and a faint glow inward. */
const ringFragment = /* glsl */ `${OCCLUSION_FRAGMENT_PARS}
uniform vec3 uColor;
uniform float uOpacity;
uniform float uWidth;
varying vec2 vLocal;
${GRADE_GLSL}
void main() {
  ${OCCLUSION_FRAGMENT}
  float r = length(vLocal);
  if (r > 1.0) discard;
  float w = max(uWidth, fwidth(r) * 1.1);
  float line = exp(-pow((r - 0.97) / w, 2.0)) * (uWidth / w);
  float inner = pow(clamp(r / 0.97, 0.0, 1.0), 6.0) * 0.18 * step(r, 0.97);
  vec3 color = po_grade(uColor) * (line + inner) * uOpacity;
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
  ${ADDITIVE_ALPHA_FRAGMENT}
}
`;

/** The target's capture ring on the plane (one per page; additive). */
export const captureRingMaterial = new ShaderMaterial({
  name: 'TargetRing',
  uniforms: withOcclusion({
    uColor: { value: new Color(1.0, 0.78, 0.42) },
    uOpacity: { value: 0.8 },
    uWidth: { value: 0.012 },
  }),
  vertexShader: ringVertex,
  fragmentShader: ringFragment,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  toneMapped: false,
});
