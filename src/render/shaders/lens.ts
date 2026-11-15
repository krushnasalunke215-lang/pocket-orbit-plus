import { AdditiveBlending, ShaderMaterial } from '@iwsdk/core';
import {
  ADDITIVE_ALPHA_FRAGMENT,
  GRADE_GLSL,
  linkOcclusion,
  MOTION_TIME,
  NOISE_GLSL,
  OCCLUSION_FRAGMENT,
  OCCLUSION_FRAGMENT_PARS,
  OCCLUSION_VERTEX,
  OCCLUSION_VERTEX_PARS,
  withOcclusion,
} from './common.js';

/*
 * The black hole's gravitational lens, a camera-facing billboard child of
 * the body (units: hole radii; the black sphere in front hides its middle):
 * a thin photon ring at about 1.08 radii (never under a pixel: fwidth), the
 * lensed image of the disk's far side as a bright arc over the shadow and a
 * fainter one under it, both Doppler-beamed like the disk (the side whose
 * gas comes toward the viewer is brighter), and uFlash, the capture flash.
 * Additive; cloned per body for uFlash.
 */

export const LENS_SIZE = 3;

const vertexShader = /* glsl */ `${OCCLUSION_VERTEX_PARS}
uniform float uSize;
varying vec2 vUv;
varying float vBeamSign;
void main() {
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float scale = length(modelViewMatrix[0].xyz);
  mv.xy += position.xy * uSize * scale;
  vUv = position.xy * uSize;
  // The disk gas moves along cross(r, up) (see accretion.ts); in view space a
  // point at screen offset x then moves toward the viewer by about axis.y * x.
  vec3 axis = normalize(mat3(modelViewMatrix) * vec3(0.0, 1.0, 0.0));
  vBeamSign = axis.y >= 0.0 ? 1.0 : -1.0;
  gl_Position = projectionMatrix * mv;
  ${OCCLUSION_VERTEX}
}
`;

const fragmentShader = /* glsl */ `${OCCLUSION_FRAGMENT_PARS}
uniform float uSize;
uniform float uFlash;
uniform float uTime;
varying vec2 vUv;
varying float vBeamSign;
${NOISE_GLSL}
${GRADE_GLSL}
void main() {
  ${OCCLUSION_FRAGMENT}
  float d = length(vUv);
  if (d >= uSize) discard;
  vec2 n = vUv / max(d, 1e-4);
  float beam = 1.0 + 0.65 * vBeamSign * n.x;
  // Photon ring: thin and hot, at least about a pixel wide.
  float w = max(0.022, fwidth(d) * 0.9);
  float photon = exp(-pow((d - 1.08) / w, 2.0)) * (0.022 / w) * 1.7;
  // Lensed far side: an arc over the shadow, a fainter one under it.
  float up = smoothstep(-0.15, 0.85, n.y);
  float down = smoothstep(-0.15, 0.85, -n.y);
  float streak = 0.75 + 0.25 * po_noise3(vec3(n * 3.0, d * 9.0 - uTime * 0.4));
  float arcTop = exp(-pow((d - 1.28) / 0.13, 2.0)) * up * 0.85;
  float arcLow = exp(-pow((d - 1.17) / 0.06, 2.0)) * down * 0.35;
  vec3 hot = vec3(1.0, 0.8, 0.55);
  vec3 color = hot * (photon * (0.8 + 0.4 * beam) + (arcTop + arcLow) * streak * beam);
  // Capture flash: the ring and a warm bloom swell for a moment.
  float bloom = exp(-max(d - 1.0, 0.0) * 2.2) * step(1.0, d);
  color += vec3(1.0, 0.72, 0.42) * uFlash * (bloom * 1.4 + photon * 1.5);
  color *= 1.0 - smoothstep(uSize * 0.75, uSize, d);
  gl_FragColor = vec4(po_grade(color), 1.0);
  #include <colorspace_fragment>
  ${ADDITIVE_ALPHA_FRAGMENT}
}
`;

const lensTemplate = new ShaderMaterial({
  name: 'BlackHoleLens',
  uniforms: withOcclusion({
    uSize: { value: LENS_SIZE },
    uFlash: { value: 0 },
    uTime: MOTION_TIME,
  }),
  vertexShader,
  fragmentShader,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  toneMapped: false,
});

/** A lens material per black hole (its own uFlash), sharing the program and the clock. */
export function createLensMaterial(): ShaderMaterial {
  const material = linkOcclusion(lensTemplate.clone());
  material.uniforms.uTime = MOTION_TIME;
  return material;
}
