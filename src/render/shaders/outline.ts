import { ShaderMaterial } from '@iwsdk/core';
import {
  OCCLUSION_FRAGMENT,
  OCCLUSION_FRAGMENT_PARS,
  OCCLUSION_VERTEX,
  OCCLUSION_VERTEX_PARS,
  withOcclusion,
} from './common.js';

/*
 * High-contrast outlines: instanced camera-facing rings (one draw call for
 * every outline), drawn with normal blending so they read on a bright room
 * as well as on the dark board: a white band with a dark outer edge. Per
 * instance (the SpritePool attributes): aOffset (center, board units), aSize
 * (outer radius, board units), aColor, aAlpha, and aPattern, the inner
 * radius as a fraction of the outer one. A zero size hides a slot.
 */

/** GLSL vertex: billboards each instance in view space, sized in board units. */
const vertexShader = /* glsl */ `${OCCLUSION_VERTEX_PARS}
attribute vec3 aOffset;
attribute float aSize;
attribute vec3 aColor;
attribute float aAlpha;
attribute float aPattern;
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
varying float vInner;
void main() {
  vec4 mv = modelViewMatrix * vec4(aOffset, 1.0);
  mv.xy += position.xy * aSize * length(modelViewMatrix[0].xyz);
  vUv = position.xy;
  vColor = aColor;
  vAlpha = aAlpha;
  vInner = aPattern;
  gl_Position = aSize > 0.0 ? projectionMatrix * mv : vec4(0.0, 0.0, 2.0, 1.0);
  ${OCCLUSION_VERTEX}
}
`;

/** GLSL fragment: a ring from vInner to 1, its outer third dark, with soft edges. */
const fragmentShader = /* glsl */ `${OCCLUSION_FRAGMENT_PARS}
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
varying float vInner;
void main() {
  ${OCCLUSION_FRAGMENT}
  float d = length(vUv);
  if (d >= 1.0 || d <= vInner) discard;
  float w = fwidth(d);
  float band = smoothstep(vInner, vInner + w, d) * (1.0 - smoothstep(1.0 - w, 1.0, d));
  float edge = smoothstep(mix(vInner, 1.0, 0.62), mix(vInner, 1.0, 0.7), d);
  vec3 color = mix(vColor, vec3(0.02), edge);
  gl_FragColor = vec4(color, band * vAlpha);
  #include <colorspace_fragment>
}
`;

/** Shared outline material (one per module). */
export const outlineMaterial = new ShaderMaterial({
  name: 'Outline',
  uniforms: withOcclusion({}),
  vertexShader,
  fragmentShader,
  transparent: true,
  depthWrite: false,
  toneMapped: false,
});
