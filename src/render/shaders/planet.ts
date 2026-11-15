import { Color, ShaderMaterial, Vector4 } from '@iwsdk/core';
import {
  GRADE_GLSL,
  HIGH_CONTRAST,
  linkOcclusion,
  MOTION_TIME,
  NOISE_GLSL,
  OCCLUSION_FRAGMENT,
  OCCLUSION_FRAGMENT_PARS,
  OCCLUSION_VERTEX,
  OCCLUSION_VERTEX_PARS,
  SPACE_MAPS,
  SPACE_READY,
  SUN_DIR_W,
  withOcclusion,
} from './common.js';

/*
 * Board body surface, realistic: the albedo from a planet atlas tile (a
 * procedural fallback in the role colour until the atlas has loaded), lit
 * by the sun (SUN_DIR_W) with a firm terminator, plus a cool low-saturation
 * fill from the sun mirrored through the vertical (strength 0.16, ambient
 * 0.05; 0.3 with high contrast) so the night side never goes black. Bump
 * from the albedo and a crater noise (craters catch the light along the
 * terminator), a specular glint on ocean and ice, an atmosphere rim
 * brighter on the day-side limb, and an emissive mode (the white star:
 * granulation and limb darkening). The shared grade. One program for every
 * body; each body gets a clone of `planetMaterial` for its own uniforms.
 */

/** Fill light strength and ambient (linear, before the grade); high contrast raises the fill. */
const FILL = 0.16;
const FILL_CONTRAST = 0.3;
const AMBIENT = 0.05;
/** Sun light on the board bodies (linear, before the shared grade). */
const SUN_GAIN = 1.9;

/** GLSL vertex: world normal and position, object position (noise), the geometry uv (atlas). */
const vertexShader = /* glsl */ `${OCCLUSION_VERTEX_PARS}
varying vec3 vNormalW;
varying vec3 vWorldPos;
varying vec3 vLocal;
varying vec2 vUv;
varying float vRadius;
void main() {
  vLocal = position;
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  mat3 m3 = mat3(modelMatrix);
  vNormalW = normalize(m3 * normal);
  vRadius = length(m3[0]);
  gl_Position = projectionMatrix * viewMatrix * world;
  ${OCCLUSION_VERTEX}
}
`;

const fragmentShader = /* glsl */ `${OCCLUSION_FRAGMENT_PARS}
uniform sampler2D uAtlas;
uniform float uAtlasReady;
uniform vec4 uTile;
uniform vec3 uColor;
uniform vec3 uBandColor;
uniform vec3 uRimColor;
uniform vec3 uAtmo;
uniform float uAtmoStrength;
uniform float uBump;
uniform float uOcean;
uniform float uEmissive;
uniform float uSeed;
uniform float uTime;
uniform float uBandScale;
uniform float uRimPower;
uniform float uRimStrength;
uniform float uContrast;
uniform float uOpacity;
uniform vec3 uSunDir;
varying vec3 vNormalW;
varying vec3 vWorldPos;
varying vec3 vLocal;
varying vec2 vUv;
varying float vRadius;
${NOISE_GLSL}
${GRADE_GLSL}
vec3 po_bump(vec3 pos, vec3 n, float h, float scale) {
  vec3 dpx = dFdx(pos);
  vec3 dpy = dFdy(pos);
  float dhx = dFdx(h) * scale;
  float dhy = dFdy(h) * scale;
  vec3 r1 = cross(dpy, n);
  vec3 r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  return normalize(abs(det) * n - grad);
}
void main() {
  ${OCCLUSION_FRAGMENT}
  vec3 Ng = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float ndv = max(dot(Ng, V), 0.0);
  vec3 dir = normalize(vLocal);

  // Albedo: the atlas tile, or the procedural fallback (warped latitude bands of the role colours).
  float warp = po_noise3(dir * 2.3 + vec3(uSeed * 9.0, uTime * 0.03, -uSeed));
  float lat = dir.y * uBandScale + warp * 1.6 + uSeed * 7.0;
  float bands = po_noise1(lat) * 0.7 + po_noise1(lat * 2.7 + 3.1) * 0.3;
  vec3 albedo = mix(uColor, uBandColor, smoothstep(0.4, 0.7, bands)) * (0.82 + 0.3 * po_noise3(dir * 9.0 + uSeed));
  if (uTile.z > 0.0) {
    vec2 uv = uTile.xy + clamp(vUv, vec2(0.004, 0.008), vec2(0.996, 0.992)) * uTile.zw;
    albedo = mix(albedo, texture2D(uAtlas, uv).rgb, uAtlasReady);
  }

  vec3 color;
  if (uEmissive > 0.0) {
    // A star: churning granulation, limb darkening toward a warmer edge, self-lit.
    float gran = po_noise3(dir * 13.0 + vec3(0.0, uTime * 0.35, uSeed * 5.0)) * 0.6
               + po_noise3(dir * 31.0 - vec3(uTime * 0.5, 0.0, 0.0)) * 0.4;
    float limb = 0.22 + 0.78 * pow(ndv, 0.6);
    // The limb is cooler and deeper (a hot blue-white star), the centre near white.
    vec3 hot = mix(uColor * vec3(0.62, 0.74, 1.0), uColor, limb);
    color = hot * uEmissive * limb * (0.72 + 0.5 * gran);
    color += uRimColor * pow(1.0 - ndv, 2.0) * uRimStrength * (1.0 + 0.8 * uContrast);
  } else {
    vec3 N = Ng;
    if (uBump > 0.0) {
      float craters = po_noise3(dir * 7.0 + uSeed * 13.0) * 0.6 + po_noise3(dir * 19.0 - uSeed) * 0.4;
      float h = dot(albedo, vec3(0.299, 0.587, 0.114)) + craters * 0.35;
      N = po_bump(vWorldPos, Ng, h, uBump * vRadius);
    }
    vec3 L = uSunDir;
    // The fill: the sun mirrored through the vertical (the opposite side, the same height).
    vec3 F = normalize(vec3(-L.x, L.y, -L.z));
    float ndlGeo = dot(Ng, L);
    float ndl = dot(N, L);
    float lit = clamp(ndl * 1.05 + 0.03, 0.0, 1.0) * smoothstep(-0.1, 0.06, ndlGeo);
    float fill = mix(${FILL.toFixed(3)}, ${FILL_CONTRAST.toFixed(3)}, uContrast);
    vec3 sun = vec3(1.0, 0.95, 0.88) * ${SUN_GAIN.toFixed(3)};
    vec3 cool = vec3(0.62, 0.72, 0.95);
    color = albedo * (sun * lit + cool * (fill * (0.35 + 0.65 * max(dot(N, F), 0.0)) + ${AMBIENT.toFixed(3)}));
    if (uOcean > 0.0) {
      vec3 H = normalize(L + V);
      float blue = smoothstep(0.01, 0.1, albedo.b - max(albedo.r, albedo.g) * 0.85);
      float spec = pow(max(dot(N, H), 0.0), 80.0) * uOcean * mix(0.25, 1.0, blue);
      color += sun * spec * step(0.0, ndlGeo);
    }
    // Atmosphere: brighter on the day-side limb, a hint around the night limb.
    float rim = pow(1.0 - ndv, uRimPower) * (0.2 + 0.8 * smoothstep(-0.3, 0.4, ndlGeo));
    vec3 rimColor = mix(uAtmo, vec3(1.0), 0.55 * uContrast);
    color += rimColor * rim * (uAtmoStrength * 1.5 + 0.6 * uContrast);
    color += uRimColor * pow(1.0 - ndv, uRimPower) * uRimStrength;
  }
  gl_FragColor = vec4(po_dither(po_grade(color)), uOpacity);
  #include <colorspace_fragment>
}
`;

/** Template material; clone it per body (createSurfaceMaterial). */
export const planetMaterial = new ShaderMaterial({
  name: 'BodySurface',
  uniforms: withOcclusion({
    uAtlas: SPACE_MAPS.uAtlas,
    uAtlasReady: SPACE_READY.uAtlasReady,
    uTile: { value: new Vector4(0, 0, 0, 0) },
    uColor: { value: new Color(0xffffff) },
    uBandColor: { value: new Color(0xffffff) },
    uRimColor: { value: new Color(0xffffff) },
    uAtmo: { value: new Color(0xffffff) },
    uAtmoStrength: { value: 0 },
    uBump: { value: 0 },
    uOcean: { value: 0 },
    uEmissive: { value: 0 },
    uSeed: { value: 0 },
    uTime: MOTION_TIME,
    uBandScale: { value: 6 },
    uRimPower: { value: 3 },
    uRimStrength: { value: 0 },
    uContrast: HIGH_CONTRAST,
    uOpacity: { value: 1 },
    uSunDir: SUN_DIR_W,
  }),
  vertexShader,
  fragmentShader,
  toneMapped: false,
});

export interface SurfaceColors {
  /** Fallback albedo (until the atlas loads, or without a tile) and the band colour. */
  color: number;
  band: number;
  /** A thin extra fresnel rim colour (strength rimStrength, default 0). */
  rim: number;
  seed: number;
  bandScale?: number;
  /** Fresnel exponent of the rims (default 3); higher is thinner. */
  rimPower?: number;
  /** Extra rim brightness (default 0). */
  rimStrength?: number;
  /** Planet atlas tile (TILE in src/render/cosmos/planets.ts: 0 earth .. 7 ice); none: the fallback only. */
  tile?: number;
  /** Atmosphere rim colour and strength (day-side limb). */
  atmosphere?: { color: number; strength: number };
  /** Bump strength (body radii); craters and ridges at the terminator. */
  bump?: number;
  /** Specular glint on ocean and ice (0..1). */
  ocean?: number;
  /** Self-lit (the white star): emissive gain; no sun shading. */
  emissive?: number;
}

/** Atlas uv rect (u0, v0, du, dv) of tile `tile` (2 columns x 4 rows, row 0 at the top). */
function tileRect(tile: number, out: Vector4): Vector4 {
  const col = tile % 2;
  const row = Math.floor(tile / 2);
  return out.set(col * 0.5, 1 - (row + 1) * 0.25, 0.5, 0.25);
}

/** Per-body clone sharing the program, the clock, the atlas and the sun. */
export function createSurfaceMaterial(colors: SurfaceColors): ShaderMaterial {
  const material = linkOcclusion(planetMaterial.clone());
  const u = material.uniforms;
  u.uTime = MOTION_TIME;
  u.uContrast = HIGH_CONTRAST;
  u.uAtlas = SPACE_MAPS.uAtlas;
  u.uAtlasReady = SPACE_READY.uAtlasReady;
  u.uSunDir = SUN_DIR_W;
  (u.uColor.value as Color).setHex(colors.color);
  (u.uBandColor.value as Color).setHex(colors.band);
  (u.uRimColor.value as Color).setHex(colors.rim);
  u.uSeed.value = colors.seed;
  u.uBandScale.value = colors.bandScale ?? 6;
  u.uRimPower.value = colors.rimPower ?? 3;
  u.uRimStrength.value = colors.rimStrength ?? 0;
  if (colors.tile !== undefined) tileRect(colors.tile, u.uTile.value as Vector4);
  if (colors.atmosphere) {
    (u.uAtmo.value as Color).setHex(colors.atmosphere.color);
    u.uAtmoStrength.value = colors.atmosphere.strength;
  }
  u.uBump.value = colors.bump ?? 0;
  u.uOcean.value = colors.ocean ?? 0;
  u.uEmissive.value = colors.emissive ?? 0;
  return material;
}
