import { AdditiveBlending, ShaderMaterial } from '@iwsdk/core';
import {
  OCCLUSION_FRAGMENT,
  OCCLUSION_FRAGMENT_PARS,
  OCCLUSION_VERTEX,
  OCCLUSION_VERTEX_PARS,
  MOTION_TIME,
  withOcclusion,
} from './common.js';

/*
 * Pull rings: instanced flat quads lying on the board, each drawing a thin
 * ring at the body's influence radius with a faint fill toward the center.
 * Per instance: aOffset (center), aSize (ring radius), aColor, aAlpha and
 * aPattern, so ring patterns echo body kinds:
 *   0 solid line (planet)
 *   1 dotted line (moon)
 *   2 dashed line with ripples flowing outward (white star: push)
 *   3 solid line with ripples flowing inward, brightening toward the core
 *     (black hole: danger)
 */

/** Pull-ring pattern ids (aPattern). */
export const PULL_PATTERN = { solid: 0, dotted: 1, outward: 2, inward: 3 } as const;

/** GLSL vertex: scales the unit quad (XZ) by the ring radius and moves it to the body. */
const vertexShader = /* glsl */ `${OCCLUSION_VERTEX_PARS}
attribute vec3 aOffset;
attribute float aSize;
attribute vec3 aColor;
attribute float aAlpha;
attribute float aPattern;
varying vec2 vLocal;
varying vec3 vColor;
varying float vAlpha;
varying float vPattern;
varying float vRadius;
void main() {
  vLocal = position.xz;
  vColor = aColor;
  vAlpha = aAlpha;
  vPattern = aPattern;
  vRadius = aSize;
  vec3 p = aOffset + position * aSize;
  gl_Position = aSize > 0.0 ? projectionMatrix * modelViewMatrix * vec4(p, 1.0) : vec4(0.0, 0.0, 2.0, 1.0);
  ${OCCLUSION_VERTEX}
}
`;

/**
 * GLSL fragment: thin ring line (patterned by angle) plus a soft inner
 * well; patterns 2 and 3 add concentric ripples whose phase 4r -/+ 0.6t
 * moves them outward (2) or inward (3).
 */
const fragmentShader = /* glsl */ `${OCCLUSION_FRAGMENT_PARS}
uniform float uTime;
varying vec2 vLocal;
varying vec3 vColor;
varying float vAlpha;
varying float vPattern;
varying float vRadius;
const float TAU = 6.28318530718;
void main() {
  ${OCCLUSION_FRAGMENT}
  float r = length(vLocal);
  if (r > 1.0) discard;
  float width = 0.006 / max(vRadius, 1e-4);
  float line = 1.0 - smoothstep(0.0, width, abs(r - 1.0 + width));
  float a = atan(vLocal.y, vLocal.x) / TAU;
  float well = pow(1.0 - r, 3.0) * 0.18;
  float ripples = 0.0;
  if (vPattern > 2.5) {
    // Inward: crests at 4r + 0.6t = const move to smaller r; stronger near the core.
    float w = fract(r * 4.0 + uTime * 0.6);
    ripples = (1.0 - smoothstep(0.0, 0.12, abs(w - 0.5))) * (1.0 - r) * 0.55;
    well = pow(1.0 - r, 2.0) * 0.3;
  } else if (vPattern > 1.5) {
    // Outward: crests at 4r - 0.6t = const move to larger r, fading at the rim.
    float w = fract(r * 4.0 - uTime * 0.6);
    ripples = (1.0 - smoothstep(0.0, 0.12, abs(w - 0.5))) * (0.25 + 0.75 * r) * (1.0 - r) * 0.7;
    line *= step(0.4, fract(a * 18.0));
  } else if (vPattern > 0.5) {
    line *= step(0.6, fract(a * 40.0));
  }
  float alpha = (line + well + ripples) * vAlpha;
  gl_FragColor = vec4(vColor, alpha);
  #include <colorspace_fragment>
}
`;

/** Shared pull-ring material (one per module). */
export const pullRingMaterial = new ShaderMaterial({
  name: 'PullRing',
  uniforms: withOcclusion({ uTime: MOTION_TIME }),
  vertexShader,
  fragmentShader,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  toneMapped: false,
});
