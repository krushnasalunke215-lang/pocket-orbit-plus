import { AdditiveBlending, DoubleSide, ShaderMaterial } from '@iwsdk/core';
import {
  ADDITIVE_ALPHA_FRAGMENT,
  GRADE_GLSL,
  NOISE_GLSL,
  OCCLUSION_FRAGMENT,
  OCCLUSION_FRAGMENT_PARS,
  OCCLUSION_VERTEX,
  OCCLUSION_VERTEX_PARS,
  MOTION_TIME,
  withOcclusion,
} from './common.js';

/*
 * Black-hole accretion disk (reads as danger): a flat ring of hot gas,
 * white-hot at the inner edge, orange in the middle, deep red at the outer
 * edge. Turbulent streaks turn with Keplerian differential rotation (the
 * angular speed falls as r^-1.5, so the inner gas laps the outer), faint
 * spiral arms drift inward, and Doppler beaming brightens the side whose
 * gas moves toward the viewer: brightness x (1 + 0.65 * the velocity's
 * component toward the camera). Additive, double-sided, the shared grade.
 */

export const ACCRETION_INNER = 1.15;
export const ACCRETION_OUTER = 2.6;

/** GLSL vertex: ring-local XZ, the world position and the gas velocity direction (counter-clockwise about +Y). */
const vertexShader = /* glsl */ `${OCCLUSION_VERTEX_PARS}
varying vec2 vLocal;
varying vec3 vWorldPos;
varying vec3 vVelW;
void main() {
  vLocal = position.xz;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  vVelW = mat3(modelMatrix) * vec3(-position.z, 0.0, position.x);
  gl_Position = projectionMatrix * viewMatrix * world;
  ${OCCLUSION_VERTEX}
}
`;

const fragmentShader = /* glsl */ `${OCCLUSION_FRAGMENT_PARS}
uniform float uInner;
uniform float uOuter;
uniform float uTime;
varying vec2 vLocal;
varying vec3 vWorldPos;
varying vec3 vVelW;
${NOISE_GLSL}
${GRADE_GLSL}
void main() {
  ${OCCLUSION_FRAGMENT}
  float r = length(vLocal);
  float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
  float a = atan(vLocal.y, vLocal.x);
  // Keplerian: angle travelled = w0 * (r / inner)^-1.5 * t.
  float turn = a - uTime * 0.9 * pow(r / uInner, -1.5);
  vec2 c = vec2(cos(turn), sin(turn));
  float streaks = po_noise3(vec3(c * 2.5, r * 7.0)) * 0.6 + po_noise3(vec3(c * 6.0, r * 19.0 + 3.0)) * 0.4;
  streaks = 0.35 + 0.9 * streaks * streaks;
  float arm = fract(a / 6.2831853 * 2.0 + 1.3 * log(max(r, 1e-3)) + uTime * 0.12);
  float arms = 1.0 + 0.25 * (smoothstep(0.0, 0.2, arm) * (1.0 - smoothstep(0.3, 0.7, arm)));
  float edge = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.55, 1.0, t));
  vec3 whiteHot = vec3(1.0, 0.92, 0.8) * 2.6;
  vec3 orange = vec3(1.0, 0.48, 0.12) * 1.2;
  vec3 deepRed = vec3(0.5, 0.06, 0.02) * 0.7;
  vec3 color = mix(whiteHot, orange, smoothstep(0.0, 0.3, t));
  color = mix(color, deepRed, smoothstep(0.3, 1.0, t));
  vec3 toCam = normalize(cameraPosition - vWorldPos);
  float toward = dot(normalize(vVelW), toCam);
  float beam = max(0.15, 1.0 + 0.65 * toward);
  float intensity = edge * streaks * arms * beam * (1.25 - 0.9 * t);
  gl_FragColor = vec4(po_grade(color * intensity), 1.0);
  #include <colorspace_fragment>
  ${ADDITIVE_ALPHA_FRAGMENT}
}
`;

/** Shared by every black hole (created once per module). */
export const accretionMaterial = new ShaderMaterial({
  name: 'Accretion',
  uniforms: withOcclusion({
    uInner: { value: ACCRETION_INNER },
    uOuter: { value: ACCRETION_OUTER },
    uTime: MOTION_TIME,
  }),
  vertexShader,
  fragmentShader,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  side: DoubleSide,
  toneMapped: false,
});
