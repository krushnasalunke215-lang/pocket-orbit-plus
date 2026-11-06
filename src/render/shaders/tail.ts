import { AdditiveBlending, Color, ShaderMaterial } from '@iwsdk/core';
import { PALETTE } from '../palette.js';
import { SHARED_TIME } from './common.js';

/*
 * Comet tail particles (Points). Each particle stores where it was emitted
 * (position), when (aBirth, seconds on the shared clock) and a drift
 * velocity (aVel, board units/s). The shader ages it: it drifts, shrinks,
 * cools from white to orange and fades out after uLife seconds.
 */

/** GLSL vertex: age-based drift and perspective point size in board units. */
const vertexShader = /* glsl */ `
attribute float aBirth;
attribute vec3 aVel;
uniform float uTime;
uniform float uLife;
uniform float uSize;
uniform float uPixelScale;
varying float vLife;
void main() {
  float age = uTime - aBirth;
  float life = clamp(age / uLife, 0.0, 1.0);
  vLife = life;
  vec4 mv = modelViewMatrix * vec4(position + aVel * age, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = uSize * length(modelViewMatrix[0].xyz) * (1.0 - 0.75 * life);
  bool alive = age >= 0.0 && life < 1.0;
  gl_PointSize = alive ? size * projectionMatrix[1][1] * uPixelScale / max(-mv.z, 1e-3) : 0.0;
}
`;

/** GLSL fragment: round soft sprite cooling from white to orange as it ages. */
const fragmentShader = /* glsl */ `
uniform vec3 uHot;
uniform vec3 uColor;
varying float vLife;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d >= 1.0) discard;
  float alpha = pow(1.0 - d, 2.0) * (1.0 - vLife) * 0.9;
  vec3 color = mix(uHot, uColor, smoothstep(0.0, 0.35, vLife));
  gl_FragColor = vec4(color, alpha);
  #include <colorspace_fragment>
}
`;

/** Shared tail material (one per module). uPixelScale is set before each render. */
export const tailMaterial = new ShaderMaterial({
  name: 'CometTail',
  uniforms: {
    uTime: SHARED_TIME,
    uLife: { value: 0.9 },
    uSize: { value: 0.075 },
    uPixelScale: { value: 400 },
    uHot: { value: new Color(PALETTE.white) },
    uColor: { value: new Color(PALETTE.orange) },
  },
  vertexShader,
  fragmentShader,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  toneMapped: false,
});
