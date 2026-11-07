import { Color, ShaderMaterial } from '@iwsdk/core';
import { NOISE_GLSL, SHARED_TIME } from './common.js';

/*
 * Body surface: unlit fresnel-rim shading with procedural latitude bands.
 * One program for every body; each body gets a clone of `planetMaterial`
 * only for its own uniforms (colors and seed). uTime stays the shared clock.
 */

/** GLSL vertex: world normal and position for the fresnel term, object position for the bands. */
const vertexShader = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vWorldPos;
varying vec3 vLocal;
void main() {
  vLocal = position;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/**
 * GLSL fragment: latitude bands from warped value noise (slowly drifting),
 * a soft fake key light from above, and a fresnel rim pow(1 - N.V, 3).
 */
const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uBandColor;
uniform vec3 uRimColor;
uniform float uSeed;
uniform float uTime;
uniform float uBandScale;
uniform float uRimPower;
uniform float uRimStrength;
varying vec3 vNormalW;
varying vec3 vWorldPos;
varying vec3 vLocal;
${NOISE_GLSL}
void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorldPos);

  // Latitude bands, warped by 3D noise so they wobble like gas giants.
  float warp = po_noise3(vLocal * 2.3 + vec3(uSeed, uTime * 0.05, -uSeed));
  float lat = vLocal.y * uBandScale + warp * 1.6 + uSeed * 7.0;
  float bands = po_noise1(lat) * 0.7 + po_noise1(lat * 2.7 + 3.1) * 0.3;
  vec3 surface = mix(uColor * 0.55, uBandColor, smoothstep(0.25, 0.85, bands));

  // Fake key light from above-front so the sphere reads as round.
  float key = 0.55 + 0.45 * max(dot(N, normalize(vec3(0.35, 0.85, 0.4))), 0.0);
  vec3 color = surface * key;

  // Fresnel rim light (a high power makes it thin: the black hole's event horizon).
  float rim = pow(1.0 - max(dot(N, V), 0.0), uRimPower);
  color += uRimColor * rim * uRimStrength;

  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;

/** Template material; clone it per body and set the colors and seed. */
export const planetMaterial = new ShaderMaterial({
  name: 'BodySurface',
  uniforms: {
    uColor: { value: new Color(0xffffff) },
    uBandColor: { value: new Color(0xffffff) },
    uRimColor: { value: new Color(0xffffff) },
    uSeed: { value: 0 },
    uTime: SHARED_TIME,
    uBandScale: { value: 6 },
    uRimPower: { value: 3 },
    uRimStrength: { value: 1.3 },
  },
  vertexShader,
  fragmentShader,
  toneMapped: false,
});

export interface SurfaceColors {
  color: number;
  band: number;
  rim: number;
  seed: number;
  bandScale?: number;
  /** Fresnel exponent (default 3); higher is a thinner rim. */
  rimPower?: number;
  /** Rim brightness (default 1.3). */
  rimStrength?: number;
}

/** Per-body clone sharing the program and the clock. */
export function createSurfaceMaterial(colors: SurfaceColors): ShaderMaterial {
  const material = planetMaterial.clone();
  material.uniforms.uTime = SHARED_TIME;
  (material.uniforms.uColor.value as Color).setHex(colors.color);
  (material.uniforms.uBandColor.value as Color).setHex(colors.band);
  (material.uniforms.uRimColor.value as Color).setHex(colors.rim);
  material.uniforms.uSeed.value = colors.seed;
  material.uniforms.uBandScale.value = colors.bandScale ?? 6;
  material.uniforms.uRimPower.value = colors.rimPower ?? 3;
  material.uniforms.uRimStrength.value = colors.rimStrength ?? 1.3;
  return material;
}
