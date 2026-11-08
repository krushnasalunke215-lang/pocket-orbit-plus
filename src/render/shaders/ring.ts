import { Color, DoubleSide, ShaderMaterial } from '@iwsdk/core';
import {
  linkOcclusion,
  OCCLUSION_FRAGMENT,
  OCCLUSION_FRAGMENT_PARS,
  OCCLUSION_VERTEX,
  OCCLUSION_VERTEX_PARS,
  SHARED_TIME,
  withOcclusion,
} from './common.js';

/*
 * Flat body rings drawn on a RingGeometry lying in local XZ. The pattern
 * tells body kinds apart without color: 0 = solid band (planet),
 * 1 = dotted (moon), 2 = dashed rings drifting outward (repulsor).
 */

export const RING_PATTERN = { solid: 0, dotted: 1, dashedOutward: 2 } as const;
export type RingPattern = (typeof RING_PATTERN)[keyof typeof RING_PATTERN];

/** GLSL vertex: passes the ring-local XZ so the fragment can compute radius and angle. */
const vertexShader = /* glsl */ `${OCCLUSION_VERTEX_PARS}
varying vec2 vLocal;
void main() {
  vLocal = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  ${OCCLUSION_VERTEX}
}
`;

/**
 * GLSL fragment: radial position t in [0, 1] across the band, angular
 * dashes/dots by pattern, soft band edges.
 */
const fragmentShader = /* glsl */ `${OCCLUSION_FRAGMENT_PARS}
uniform vec3 uColor;
uniform float uOpacity;
uniform float uInner;
uniform float uOuter;
uniform float uPattern;
uniform float uTime;
varying vec2 vLocal;
const float TAU = 6.28318530718;
void main() {
  ${OCCLUSION_FRAGMENT}
  float r = length(vLocal);
  float t = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
  float a = atan(vLocal.y, vLocal.x) / TAU + 0.5;
  float alpha;
  if (uPattern < 0.5) {
    // Solid band with a darker gap, like a planetary ring system.
    alpha = smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.85, 1.0, t));
    alpha *= 0.55 + 0.45 * step(0.42, abs(t - 0.5) * 2.0 + 0.3);
  } else if (uPattern < 1.5) {
    // Round dots on the ring's center line.
    vec2 cell = vec2(fract(a * 14.0) - 0.5, (t - 0.5) * 0.9);
    alpha = 1.0 - smoothstep(0.22, 0.32, length(cell));
  } else {
    // Concentric dashed rings that drift outward (push-away read).
    float wave = fract(t * 3.0 - uTime * 0.5);
    float line = 1.0 - smoothstep(0.0, 0.18, abs(wave - 0.5));
    float dash = step(0.4, fract(a * 16.0));
    alpha = line * dash * (1.0 - t * 0.6);
  }
  gl_FragColor = vec4(uColor, alpha * uOpacity);
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
    uTime: SHARED_TIME,
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
  material.uniforms.uTime = SHARED_TIME;
  (material.uniforms.uColor.value as Color).setHex(color);
  material.uniforms.uPattern.value = pattern;
  material.uniforms.uInner.value = inner;
  material.uniforms.uOuter.value = outer;
  material.uniforms.uOpacity.value = opacity;
  return material;
}
