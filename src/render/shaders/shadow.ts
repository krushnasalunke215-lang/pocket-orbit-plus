import { AdditiveBlending, Color, ShaderMaterial } from '@iwsdk/core';
import {
  INK_COLOR,
  OCCLUSION_FRAGMENT,
  OCCLUSION_FRAGMENT_PARS,
  OCCLUSION_VERTEX,
  OCCLUSION_VERTEX_PARS,
  withOcclusion,
} from './common.js';

/*
 * Depth cues for the floating play layer (instanced SpritePool materials,
 * board units): a soft ink contact shadow on the glass under each object,
 * and a thin glowing post from the glass up to it. Per instance: aOffset,
 * aSize, aColor, aAlpha, aPattern (the post's height). Size 0 hides a slot.
 */

/** GLSL vertex: a flat disc in the board plane (the geometry lies in XZ). */
const shadowVertex = /* glsl */ `${OCCLUSION_VERTEX_PARS}
attribute vec3 aOffset;
attribute float aSize;
attribute float aAlpha;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vec3 p = aOffset + position * aSize;
  vUv = position.xz;
  vAlpha = aAlpha;
  gl_Position = aSize > 0.0 ? projectionMatrix * modelViewMatrix * vec4(p, 1.0) : vec4(0.0, 0.0, 2.0, 1.0);
  ${OCCLUSION_VERTEX}
}
`;

const shadowFragment = /* glsl */ `${OCCLUSION_FRAGMENT_PARS}
uniform vec3 uInk;
varying vec2 vUv;
varying float vAlpha;
void main() {
  ${OCCLUSION_FRAGMENT}
  float d = length(vUv);
  if (d >= 1.0) discard;
  float a = (1.0 - smoothstep(0.45, 1.0, d)) * vAlpha;
  gl_FragColor = vec4(uInk, a);
  #include <colorspace_fragment>
}
`;

export const shadowMaterial = new ShaderMaterial({
  name: 'ContactShadow',
  uniforms: withOcclusion({ uInk: { value: new Color(INK_COLOR) } }),
  vertexShader: shadowVertex,
  fragmentShader: shadowFragment,
  transparent: true,
  depthWrite: false,
  toneMapped: false,
});

/**
 * GLSL vertex: a vertical strip from (x, 0, z) to (x, aPattern, z), turned
 * about the board's up axis toward the camera; aSize is its half width.
 */
const postVertex = /* glsl */ `${OCCLUSION_VERTEX_PARS}
attribute vec3 aOffset;
attribute float aSize;
attribute vec3 aColor;
attribute float aAlpha;
attribute float aPattern;
varying float vSide;
varying float vAlong;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec3 bottom = (modelViewMatrix * vec4(aOffset.x, 0.0, aOffset.z, 1.0)).xyz;
  vec3 top = (modelViewMatrix * vec4(aOffset.x, aPattern, aOffset.z, 1.0)).xyz;
  vec3 axis = top - bottom;
  float t = position.y * 0.5 + 0.5;
  vec3 p = mix(bottom, top, t);
  vec3 side = cross(normalize(axis + vec3(1e-6)), normalize(-p));
  float len = length(side);
  side = len > 1e-6 ? side / len : vec3(1.0, 0.0, 0.0);
  p += side * position.x * aSize * length(modelViewMatrix[0].xyz);
  vSide = position.x;
  vAlong = t;
  vColor = aColor;
  vAlpha = aAlpha;
  gl_Position = aSize > 0.0 && aPattern > 0.0 ? projectionMatrix * vec4(p, 1.0) : vec4(0.0, 0.0, 2.0, 1.0);
  ${OCCLUSION_VERTEX}
}
`;

const postFragment = /* glsl */ `${OCCLUSION_FRAGMENT_PARS}
varying float vSide;
varying float vAlong;
varying vec3 vColor;
varying float vAlpha;
void main() {
  ${OCCLUSION_FRAGMENT}
  float core = 1.0 - abs(vSide);
  float a = core * core * vAlpha * (0.35 + 0.65 * (1.0 - vAlong));
  gl_FragColor = vec4(mix(vColor, vec3(1.0), 0.35 * core), a);
  #include <colorspace_fragment>
}
`;

export const postMaterial = new ShaderMaterial({
  name: 'LightPost',
  uniforms: withOcclusion({}),
  vertexShader: postVertex,
  fragmentShader: postFragment,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  toneMapped: false,
});
