import { AdditiveBlending, Color, DoubleSide, ShaderMaterial } from '@iwsdk/core';
import { PALETTE } from '../palette.js';
import { NOISE_GLSL, SHARED_TIME } from './common.js';

/*
 * Black-hole accretion disc (reads as danger): a thick flat ring of noise
 * streaks swirling around the core, cut by three logarithmic spiral arms
 * that drift inward over time, so gas visibly falls in. Hot (yellow) at the
 * inner edge, vermillion at the outer edge, brightest just outside the
 * event horizon. Additive, so it reads as glowing gas.
 */

export const ACCRETION_INNER = 1.15;
export const ACCRETION_OUTER = 2.6;

/** GLSL vertex: ring-local XZ for polar coordinates. */
const vertexShader = /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * GLSL fragment: polar noise streaks rotating faster near the core
 * (differential rotation), modulated by spiral arms whose phase
 * 3a + 1.6 ln r + 0.5 t is constant along each arm, so as time grows an arm
 * moves to smaller r (inward). Inner-to-outer color and brightness falloff.
 */
const fragmentShader = /* glsl */ `
uniform vec3 uHot;
uniform vec3 uCool;
uniform float uInner;
uniform float uOuter;
uniform float uTime;
varying vec2 vLocal;
${NOISE_GLSL}
const float TAU = 6.28318530718;
void main() {
  float r = length(vLocal);
  float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
  float a = atan(vLocal.y, vLocal.x) / TAU;
  float spin = uTime * (0.9 - 0.6 * t);
  float streaks = po_noise3(vec3((a + spin) * 18.0, t * 5.0, 1.7));
  streaks = 0.45 + 0.55 * streaks;
  float arm = fract(a * 3.0 + 1.6 * log(max(r, 1e-3)) + uTime * 0.5);
  float arms = smoothstep(0.0, 0.18, arm) * (1.0 - smoothstep(0.35, 0.75, arm));
  float edge = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.6, 1.0, t));
  float intensity = edge * streaks * (0.35 + 0.85 * arms) * (1.15 - 0.85 * t);
  vec3 color = mix(uHot, uCool, smoothstep(0.0, 0.6, t));
  gl_FragColor = vec4(color * intensity, intensity);
  #include <colorspace_fragment>
}
`;

/** Shared by every black hole (created once per module). */
export const accretionMaterial = new ShaderMaterial({
  name: 'Accretion',
  uniforms: {
    uHot: { value: new Color(PALETTE.yellow) },
    uCool: { value: new Color(PALETTE.vermillion) },
    uInner: { value: ACCRETION_INNER },
    uOuter: { value: ACCRETION_OUTER },
    uTime: SHARED_TIME,
  },
  vertexShader,
  fragmentShader,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  side: DoubleSide,
  toneMapped: false,
});
