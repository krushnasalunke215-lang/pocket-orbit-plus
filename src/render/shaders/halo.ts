import { AdditiveBlending, ShaderMaterial } from '@iwsdk/core';
import {
  OCCLUSION_FRAGMENT,
  OCCLUSION_FRAGMENT_PARS,
  OCCLUSION_VERTEX,
  OCCLUSION_VERTEX_PARS,
  withOcclusion,
} from './common.js';

/*
 * Fake bloom: instanced camera-facing quads with a radial falloff, drawn
 * additively. Per instance: aOffset (center, board units), aSize (radius,
 * board units), aColor (linear RGB) and aAlpha. A zero size hides a slot.
 */

/** GLSL vertex: billboards each instance in view space, sized in board units. */
const vertexShader = /* glsl */ `${OCCLUSION_VERTEX_PARS}
attribute vec3 aOffset;
attribute float aSize;
attribute vec3 aColor;
attribute float aAlpha;
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(aOffset, 1.0);
  mv.xy += position.xy * aSize * length(modelViewMatrix[0].xyz);
  vUv = position.xy;
  vColor = aColor;
  vAlpha = aAlpha;
  gl_Position = aSize > 0.0 ? projectionMatrix * mv : vec4(0.0, 0.0, 2.0, 1.0);
  ${OCCLUSION_VERTEX}
}
`;

/** GLSL fragment: soft radial glow with a slightly brighter core. */
const fragmentShader = /* glsl */ `${OCCLUSION_FRAGMENT_PARS}
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
void main() {
  ${OCCLUSION_FRAGMENT}
  float d = length(vUv);
  if (d >= 1.0) discard;
  float glow = pow(1.0 - d, 2.4) + 0.35 * pow(1.0 - d, 8.0);
  float alpha = glow * vAlpha;
  gl_FragColor = vec4(vColor, alpha);
  #include <colorspace_fragment>
}
`;

/** Shared halo material (one per module). */
export const haloMaterial = new ShaderMaterial({
  name: 'Halo',
  uniforms: withOcclusion({}),
  vertexShader,
  fragmentShader,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  toneMapped: false,
});
