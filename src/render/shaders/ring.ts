import { Color, DoubleSide, ShaderMaterial } from '@iwsdk/core';
import {
  GRADE_GLSL,
  linkOcclusion,
  NOISE_GLSL,
  OCCLUSION_FRAGMENT,
  OCCLUSION_FRAGMENT_PARS,
  OCCLUSION_VERTEX,
  OCCLUSION_VERTEX_PARS,
  MOTION_TIME,
  SUN_DIR_W,
  withOcclusion,
} from './common.js';

/*
 * Flat body rings drawn on a RingGeometry lying in local XZ. The pattern
 * tells body kinds apart without colour: 0 = fine dusty bands lit by the
 * sun, brighter where the sun grazes them and seen against it (planet),
 * 1 = faint specks along the centre line (moon), 2 = faint pressure waves
 * drifting outward (the white star), 3 = a soft glowing band (Your Table
 * wells). Thin features fade instead of getting thinner than a pixel.
 */

export const RING_PATTERN = { solid: 0, dotted: 1, dashedOutward: 2, glow: 3 } as const;
export type RingPattern = (typeof RING_PATTERN)[keyof typeof RING_PATTERN];

/** GLSL vertex: ring-local XZ, the world position and the ring's world normal. */
const vertexShader = /* glsl */ `${OCCLUSION_VERTEX_PARS}
varying vec2 vLocal;
varying vec3 vWorldPos;
varying vec3 vNormalW;
void main() {
  vLocal = position.xz;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0));
  gl_Position = projectionMatrix * viewMatrix * world;
  ${OCCLUSION_VERTEX}
}
`;

const fragmentShader = /* glsl */ `${OCCLUSION_FRAGMENT_PARS}
uniform vec3 uColor;
uniform float uOpacity;
uniform float uInner;
uniform float uOuter;
uniform float uPattern;
uniform float uTime;
uniform vec3 uSunDir;
varying vec2 vLocal;
varying vec3 vWorldPos;
varying vec3 vNormalW;
${NOISE_GLSL}
${GRADE_GLSL}
const float TAU = 6.28318530718;
void main() {
  ${OCCLUSION_FRAGMENT}
  float r = length(vLocal);
  float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
  float a = atan(vLocal.y, vLocal.x) / TAU + 0.5;
  float fw = fwidth(t);
  // Fine detail fades out once it gets close to a pixel.
  float fine = 1.0 - smoothstep(0.01, 0.04, fw);
  vec3 color = uColor;
  float alpha;
  if (uPattern < 0.5) {
    // Dusty bands: many fine ringlets, a dark gap, soft edges; lit by the sun.
    float ringlets = mix(0.7, 0.45 + 0.75 * po_noise1(t * 46.0 + 3.0), fine);
    float gap = 1.0 - 0.8 * (1.0 - smoothstep(0.0, 0.035 + fw, abs(t - 0.62)));
    alpha = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.82, 1.0, t)) * ringlets * gap * 0.75;
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vWorldPos);
    float lit = 0.25 + 0.75 * abs(dot(N, uSunDir));
    float forward = pow(max(dot(-V, uSunDir), 0.0), 4.0) * 0.8;
    vec3 dust = mix(vec3(0.78, 0.72, 0.64), uColor, 0.35);
    color = dust * (lit * 1.25 + forward) + vec3(0.08, 0.1, 0.14);
  } else if (uPattern < 1.5) {
    // Faint specks on the centre line.
    vec2 cell = vec2(fract(a * 14.0) - 0.5, (t - 0.5) * 0.9);
    alpha = (1.0 - smoothstep(0.16, 0.26, length(cell))) * 0.55;
  } else if (uPattern < 2.5) {
    // Faint pressure waves drifting outward.
    float wave = fract(t * 3.0 - uTime * 0.4);
    float line = 1.0 - smoothstep(0.0, 0.16 + fw * 3.0, abs(wave - 0.5));
    alpha = line * (0.65 + 0.35 * step(0.35, fract(a * 16.0))) * (1.0 - t * 0.75) * 0.5;
  } else {
    // A soft glowing band, brightest in the middle.
    alpha = exp(-pow((t - 0.5) / 0.28, 2.0));
  }
  gl_FragColor = vec4(po_grade(color), alpha * uOpacity);
  #include <colorspace_fragment>
}
`;

const ringTemplate = new ShaderMaterial({
  name: 'BodyRing',
  uniforms: withOcclusion({
    uColor: { value: new Color(0xffffff) },
    uOpacity: { value: 0.8 },
    uInner: { value: 1.4 },
    uOuter: { value: 1.9 },
    uPattern: { value: 0 },
    uTime: MOTION_TIME,
    uSunDir: SUN_DIR_W,
  }),
  vertexShader,
  fragmentShader,
  transparent: true,
  depthWrite: false,
  side: DoubleSide,
  toneMapped: false,
});

/** One material per ring style; call once per module, never per body. */
export function createRingMaterial(
  color: number,
  pattern: RingPattern,
  inner: number,
  outer: number,
  opacity = 0.8,
): ShaderMaterial {
  const material = linkOcclusion(ringTemplate.clone());
  material.uniforms.uTime = MOTION_TIME;
  material.uniforms.uSunDir = SUN_DIR_W;
  (material.uniforms.uColor.value as Color).setHex(color);
  material.uniforms.uPattern.value = pattern;
  material.uniforms.uInner.value = inner;
  material.uniforms.uOuter.value = outer;
  material.uniforms.uOpacity.value = opacity;
  return material;
}
