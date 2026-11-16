import { AdditiveBlending, DoubleSide, ShaderMaterial, type IUniform, type Vector3 } from '@iwsdk/core';
import { ADDITIVE_ALPHA_FRAGMENT, GRADE_GLSL, MOTION_TIME, NOISE_GLSL, SHARED_TIME, SPACE_MAPS, SPACE_READY, SUN_DIR_W } from './common.js';
import { COSMOS_MASK_GLSL, withCosmos } from './sky.js';

/*
 * Cosmos materials (world meters, all transparent so the AR fade and the
 * island mask apply). Few programs: one realistic planet program for every
 * small planet, moon and rock (InstancedMesh; atlas tiles) plus its
 * own-map variant for the giant (an instanced mesh of one), lit by the
 * shared SUN_DIR_W; then the ring, the star points, the star glints, the
 * sun, the constellation and the shooting stars.
 */

/** Sun light on the cosmos bodies (linear, before the shared grade). */
const SUN_GAIN = 2.1;

/**
 * GLSL (after NOISE_GLSL): the ring's density (alpha) and colour by radius.
 * t = 0..1 from the inner to the outer edge; the fallback follows Saturn's
 * rings in radii 1.24-2.27: a faint C ring, the dense B ring, the Cassini
 * division, the A ring with the Encke gap. po_ringDensity(r, ...) takes r in
 * body radii and a fixed mip level (for lookups in divergent branches).
 */
const RING_DENSITY_GLSL = /* glsl */ `
vec3 po_ringFallbackColor(float t) {
  float b = po_noise1(t * 40.0);
  return mix(vec3(0.42, 0.36, 0.28), vec3(0.74, 0.66, 0.54), b) * mix(0.65, 1.0, smoothstep(0.2, 0.4, t));
}
float po_ringFallbackDensity(float t) {
  float c = 0.22 * smoothstep(0.0, 0.04, t);
  float bRing = 0.92 * smoothstep(0.27, 0.3, t) * (1.0 - smoothstep(0.68, 0.7, t));
  float aRing = 0.7 * smoothstep(0.75, 0.77, t) * (1.0 - smoothstep(0.97, 1.0, t)) * (1.0 - 0.8 * (1.0 - smoothstep(0.0, 0.008, abs(t - 0.93))));
  float d = t < 0.29 ? c : max(bRing, aRing);
  return d * (0.82 + 0.18 * po_noise1(t * 90.0));
}
float po_ringDensity(float r, float inner, float outer, sampler2D ring, float ready, float lod) {
  float t = (r - inner) / (outer - inner);
  if (t < 0.0 || t > 1.0) return 0.0;
  return mix(po_ringFallbackDensity(t), textureLod(ring, vec2(t, 0.5), lod).a, ready);
}
`;

/**
 * Per instance:
 *   aTile    atlas uv rect (u0, v0, du, dv) the geometry uv maps into (own map: unused);
 *   aAtmo    atmosphere rim colour (rgb) and strength (a, 0: none);
 *   aSurface bump strength (x, in body radii), specular glint (y), night
 *            ambient (z, 0-0.02), ring-shadow flag (w, giant only);
 *   aFallback procedural albedo until the map has loaded (linear rgb);
 *   aPulse   the L4 echo (0..1).
 */
const planetVertex = /* glsl */ `
attribute vec4 aTile;
attribute vec4 aAtmo;
attribute vec4 aSurface;
attribute vec3 aFallback;
attribute float aPulse;
uniform float uPulseScale;
uniform vec3 uSunDir;
varying vec3 vNormalW;
varying vec3 vWorldPos;
varying vec3 vLocal;
varying vec3 vLightL;
varying vec2 vUv;
varying vec4 vTile;
varying vec4 vAtmo;
varying vec4 vSurface;
varying vec3 vFallback;
varying float vPulse;
varying float vRadius;
void main() {
  mat4 m = modelMatrix * instanceMatrix;
  mat3 m3 = mat3(m);
  vec4 world = m * vec4(position * (1.0 + uPulseScale * aPulse), 1.0);
  vWorldPos = world.xyz;
  vNormalW = normalize(transpose(inverse(m3)) * normal);
  vLightL = normalize(transpose(m3) * uSunDir);
  vRadius = pow(abs(determinant(m3)), 1.0 / 3.0);
  vLocal = position;
  vUv = uv;
  vTile = aTile;
  vAtmo = aAtmo;
  vSurface = aSurface;
  vFallback = aFallback;
  vPulse = aPulse;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/**
 * Albedo = mix(procedural fallback, the map, ready). A hard terminator with
 * a near-black night side, bump from the albedo luminance (screen
 * derivatives: craters and ridges catch the light at the terminator), a
 * Blinn-Phong glint (strongest where the albedo is ocean or ice blue), the
 * atmosphere rim brighter on the day-side limb, the echo pulse rim, and on
 * the giant the ring's shadow (a ray from the surface toward the sun
 * through the ring plane). The shared grade; alpha po_cosmosAlpha.
 */
const planetFragment = /* glsl */ `
uniform sampler2D uMap;
uniform float uMapReady;
uniform float uAlbedo;
uniform sampler2D uRing;
uniform float uRingReady;
uniform float uRingInner;
uniform float uRingOuter;
uniform vec3 uSunDir;
varying vec3 vNormalW;
varying vec3 vWorldPos;
varying vec3 vLocal;
varying vec3 vLightL;
varying vec2 vUv;
varying vec4 vTile;
varying vec4 vAtmo;
varying vec4 vSurface;
varying vec3 vFallback;
varying float vPulse;
varying float vRadius;
${COSMOS_MASK_GLSL}
${NOISE_GLSL}
${GRADE_GLSL}
${RING_DENSITY_GLSL}
vec3 po_fallbackAlbedo(vec3 dir) {
#ifdef OWN_MAP
  float b = po_noise1(dir.y * 11.0 + po_noise1(dir.x * 2.0 + dir.z * 2.0) * 0.7);
  return vFallback * (0.78 + 0.34 * b);
#else
  float n = po_noise3(dir * 4.0) * 0.6 + po_noise3(dir * 11.0) * 0.4;
  return vFallback * (0.6 + 0.7 * n);
#endif
}
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
  float alpha = po_cosmosAlpha(vWorldPos);
  if (alpha <= 0.002) discard;
  vec3 Ng = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = uSunDir;
  vec3 dir = normalize(vLocal);
#ifdef OWN_MAP
  vec2 uv = vUv;
#else
  // Inset half a coarse-mip texel so no neighbour tile bleeds in.
  vec2 uv = vTile.xy + clamp(vUv, vec2(0.004, 0.008), vec2(0.996, 0.992)) * vTile.zw;
#endif
  vec3 albedo = mix(po_fallbackAlbedo(dir), texture2D(uMap, uv).rgb * uAlbedo, uMapReady);
  vec3 N = Ng;
  if (vSurface.x > 0.0) {
    float h = dot(albedo, vec3(0.299, 0.587, 0.114));
    N = po_bump(vWorldPos, Ng, h, vSurface.x * vRadius);
  }
  float ndlGeo = dot(Ng, L);
  float ndl = dot(N, L);
  // Hard terminator; bumped peaks may catch light just past it, no further.
  float lit = clamp(ndl * 1.1 + 0.02, 0.0, 1.0) * smoothstep(-0.12, 0.02, ndlGeo);
#ifdef OWN_MAP
  if (vSurface.w > 0.5 && abs(vLightL.y) > 1e-4) {
    float t = -dir.y / vLightL.y;
    if (t > 0.0) {
      float r = length((dir + vLightL * t).xz);
      lit *= 1.0 - 0.88 * po_ringDensity(r, uRingInner, uRingOuter, uRing, uRingReady, 3.0);
    }
  }
#endif
  float ndv = max(dot(Ng, V), 0.0);
  vec3 sun = vec3(1.0, 0.95, 0.88) * ${SUN_GAIN.toFixed(3)};
  vec3 color = albedo * sun * lit;
  // Night side: a faint cool fill so the dark limb still reads as a sphere.
  color += vec3(0.6, 0.7, 1.0) * (albedo + 0.04) * vSurface.z * (0.4 + 0.6 * ndv) * 3.0;
  if (vSurface.y > 0.0) {
    vec3 H = normalize(L + V);
    float blue = smoothstep(0.01, 0.12, albedo.b - max(albedo.r, albedo.g) * 0.85);
    float spec = pow(max(dot(N, H), 0.0), 70.0) * vSurface.y * mix(0.35, 1.0, blue);
    color += sun * spec * step(0.0, ndlGeo);
  }
  float rim = pow(1.0 - ndv, 2.5) * smoothstep(-0.25, 0.35, ndlGeo) * vAtmo.a;
  color += vAtmo.rgb * rim * 1.6;
  // Backlit by the sun, the atmosphere's limb lights up (forward scattering).
  color += vAtmo.rgb * vAtmo.a * pow(1.0 - ndv, 5.0) * pow(max(dot(-V, L), 0.0), 3.0) * 2.5;
  color += vec3(1.0, 0.92, 0.75) * vPulse * pow(1.0 - ndv, 2.0) * 1.6;
  gl_FragColor = vec4(po_dither(po_grade(color)), alpha);
  #include <colorspace_fragment>
}
`;

export interface CosmosPlanetOptions {
  /** 'saturn': the giant's own equirect map with the ring shadow; else the planet atlas. */
  ownMap?: 'saturn';
  /** Size swell per unit pulse (0 under reduced motion; CosmosVisual writes it). */
  pulseScale: IUniform<number>;
  /** Ring radii in body radii (own map only, for the ring shadow). */
  ring?: readonly [number, number];
  /** Map albedo scale (default 1; the asteroids are darker than the moon map). */
  albedo?: number;
}

/**
 * The realistic cosmos planet material. The geometry needs per-instance
 * aTile (vec4), aAtmo (vec4), aSurface (vec4), aFallback (vec3) and aPulse.
 */
export function createCosmosPlanetMaterial(options: CosmosPlanetOptions): ShaderMaterial {
  const own = options.ownMap === 'saturn';
  return new ShaderMaterial({
    name: own ? 'CosmosGiant' : 'CosmosPlanet',
    defines: own ? { OWN_MAP: 1 } : {},
    uniforms: withCosmos({
      uMap: own ? SPACE_MAPS.uSaturn : SPACE_MAPS.uAtlas,
      uMapReady: own ? SPACE_READY.uSaturnReady : SPACE_READY.uAtlasReady,
      uAlbedo: { value: options.albedo ?? 1 },
      uRing: SPACE_MAPS.uRing,
      uRingReady: SPACE_READY.uRingReady,
      uRingInner: { value: options.ring?.[0] ?? 0 },
      uRingOuter: { value: options.ring?.[1] ?? 0 },
      uSunDir: SUN_DIR_W,
      uPulseScale: options.pulseScale,
    }),
    vertexShader: planetVertex,
    fragmentShader: planetFragment,
    transparent: true,
    toneMapped: false,
  });
}

const ringVertex = /* glsl */ `
uniform vec3 uSunDir;
varying vec3 vLocal;
varying vec3 vLightL;
varying vec3 vNormalW;
varying vec3 vWorldPos;
void main() {
  vLocal = position;
  mat3 m3 = mat3(modelMatrix);
  vLightL = normalize(transpose(m3) * uSunDir);
  vNormalW = normalize(m3 * vec3(0.0, 1.0, 0.0));
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/**
 * The ring: colour and density by radius from uRing (procedural bands until
 * it loads), lit by the sun on its sunward face; seen from the unlit face
 * only the light diffusing through the thinner parts shows, brighter when
 * the sun is behind it (forward scattering). The planet's shadow falls on
 * it (a ray toward the sun hits the giant sphere). Local units: giant radii.
 */
const ringFragment = /* glsl */ `
uniform sampler2D uRing;
uniform float uRingReady;
uniform float uInner;
uniform float uOuter;
uniform vec3 uSunDir;
varying vec3 vLocal;
varying vec3 vLightL;
varying vec3 vNormalW;
varying vec3 vWorldPos;
${COSMOS_MASK_GLSL}
${NOISE_GLSL}
${GRADE_GLSL}
${RING_DENSITY_GLSL}
void main() {
  float r = length(vLocal.xz);
  float t = (r - uInner) / (uOuter - uInner);
  if (t < 0.0 || t > 1.0) discard;
  float alpha = po_cosmosAlpha(vWorldPos);
  if (alpha <= 0.002) discard;
  vec4 tex = texture2D(uRing, vec2(t, 0.5));
  float a = mix(po_ringFallbackDensity(t), tex.a, uRingReady);
  // The map is near grey: a warm tan tint, a little under the planet's brightness.
  vec3 col = mix(po_ringFallbackColor(t), tex.rgb * vec3(0.86, 0.77, 0.64), uRingReady);
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float nl = dot(N, uSunDir);
  float nv = dot(N, V);
  float forward = pow(max(dot(-V, uSunDir), 0.0), 6.0);
  float front = 0.3 + 0.7 * sqrt(abs(nl));
  float back = a * (1.0 - a) * (0.9 + 2.5 * forward) + (1.0 - a) * forward * 0.4;
  float light = nl * nv >= 0.0 ? front : back / max(a, 0.05);
  // The planet's shadow: does the ray toward the sun hit the unit sphere?
  vec3 Ll = vLightL;
  float b = dot(vLocal, Ll);
  float disc = b * b - (dot(vLocal, vLocal) - 1.0);
  float shadow = b < 0.0 ? smoothstep(-0.02, 0.06, disc) : 0.0;
  light *= 1.0 - 0.94 * shadow;
  vec3 color = col * light * ${(SUN_GAIN * 0.9).toFixed(3)};
  gl_FragColor = vec4(po_grade(color), alpha * a);
  #include <colorspace_fragment>
}
`;

export function createCosmosRingMaterial(inner: number, outer: number): ShaderMaterial {
  return new ShaderMaterial({
    name: 'CosmosRing',
    uniforms: withCosmos({
      uRing: SPACE_MAPS.uRing,
      uRingReady: SPACE_READY.uRingReady,
      uInner: { value: inner },
      uOuter: { value: outer },
      uSunDir: SUN_DIR_W,
    }),
    vertexShader: ringVertex,
    fragmentShader: ringFragment,
    side: DoubleSide,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
}

/**
 * The star field: one Points draw of fine stars at infinity (the 55 m
 * shell). Per vertex aColor (linear blackbody colour times brightness),
 * aSize (pixels, 1.4-3.2: faintness goes into intensity, so nothing
 * shimmers below a pixel) and aPhase (a gentle +-4% twinkle on MOTION_TIME,
 * still under reduced motion). Gaussian falloff, additive.
 */
const starsVertex = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aPhase;
uniform float uTime;
varying vec3 vColor;
varying float vAlpha;
${COSMOS_MASK_GLSL}
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  float tw = 1.0 + 0.04 * sin(uTime * (0.7 + aPhase * 1.9) + aPhase * 40.0);
  vColor = aColor * tw;
  vAlpha = po_cosmosAlpha(world.xyz);
  gl_Position = vAlpha > 0.002 ? projectionMatrix * viewMatrix * world : vec4(0.0, 0.0, 2.0, 1.0);
  gl_PointSize = aSize;
}
`;

const starsFragment = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
${GRADE_GLSL}
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d2 = dot(c, c) * 4.0;
  if (d2 > 1.0) discard;
  float falloff = exp(-d2 * 3.2);
  gl_FragColor = vec4(po_grade(vColor * falloff), 1.0);
  #include <colorspace_fragment>
  gl_FragColor.rgb *= vAlpha;
  ${ADDITIVE_ALPHA_FRAGMENT}
}
`;

export function createStarPointsMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: 'CosmosStars',
    uniforms: withCosmos({ uTime: MOTION_TIME }),
    vertexShader: starsVertex,
    fragmentShader: starsFragment,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });
}

/**
 * Glints on the brightest stars: instanced camera-facing billboards
 * (aOffset meters, aColor linear, aSize half-size meters, aSpike 0..1 spike
 * strength). A soft core plus four thin diffraction spikes; a spike never
 * gets thinner than one pixel (it fades instead), so it cannot shimmer.
 */
const glintVertex = /* glsl */ `
attribute vec3 aOffset;
attribute vec3 aColor;
attribute float aSize;
attribute float aSpike;
varying vec2 vUv;
varying vec3 vColor;
varying float vSpike;
varying float vAlpha;
${COSMOS_MASK_GLSL}
void main() {
  vec4 world = modelMatrix * vec4(aOffset, 1.0);
  vec4 mv = viewMatrix * world;
  mv.xy += position.xy * aSize;
  vUv = position.xy;
  vColor = aColor;
  vSpike = aSpike;
  vAlpha = po_cosmosAlpha(world.xyz);
  gl_Position = vAlpha > 0.002 ? projectionMatrix * mv : vec4(0.0, 0.0, 2.0, 1.0);
}
`;

const glintFragment = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying float vSpike;
varying float vAlpha;
${GRADE_GLSL}
float po_spike(float across, float along, float width) {
  float fw = fwidth(across);
  float w = max(width, fw);
  float line = exp(-(across * across) / (w * w));
  return line * (width / w) * pow(max(0.0, 1.0 - along), 2.2);
}
void main() {
  vec2 a = abs(vUv);
  float r = length(vUv);
  if (r > 1.0 && min(a.x, a.y) > 0.06) discard;
  float core = exp(-r * r * 90.0) * 0.9 + exp(-r * 14.0) * 0.12;
  float spikes = po_spike(vUv.y, a.x, 0.012) + po_spike(vUv.x, a.y, 0.012);
  vec3 color = vColor * (core + spikes * 0.55 * vSpike);
  gl_FragColor = vec4(po_grade(color), 1.0);
  #include <colorspace_fragment>
  gl_FragColor.rgb *= vAlpha;
  ${ADDITIVE_ALPHA_FRAGMENT}
}
`;

export function createGlintMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: 'CosmosGlints',
    vertexShader: glintVertex,
    fragmentShader: glintFragment,
    uniforms: withCosmos({}),
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });
}

/**
 * The sun: one camera-facing quad at uSunPos (cosmos frame). A white-hot
 * core (the only pure white in the sky), a warm exponential glow, a faint
 * six-spike starburst, and a glare whose radius (x (1 + 2.5 s)) and
 * strength grow with s = smoothstep(cos 50 deg, 1, facing), where facing is
 * the cosine between the view axis and the sun direction (from viewMatrix
 * in the vertex shader). Additive; depth-tested so the planets hide it.
 */
const sunVertex = /* glsl */ `
uniform vec3 uSunPos;
uniform float uRadius;
varying vec2 vUv;
varying float vGlare;
varying float vGrow;
varying float vAlpha;
${COSMOS_MASK_GLSL}
void main() {
  vec4 world = modelMatrix * vec4(uSunPos, 1.0);
  vec3 toSun = normalize(world.xyz - cameraPosition);
  vec3 forward = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  float s = smoothstep(${Math.cos((50 * Math.PI) / 180).toFixed(6)}, 1.0, dot(toSun, forward));
  float grow = 1.0 + 2.5 * s;
  vec4 mv = viewMatrix * world;
  mv.xy += position.xy * uRadius * grow;
  vUv = position.xy * grow;
  vGlare = s;
  vGrow = grow;
  vAlpha = po_cosmosAlpha(world.xyz);
  gl_Position = vAlpha > 0.002 ? projectionMatrix * mv : vec4(0.0, 0.0, 2.0, 1.0);
}
`;

/** vUv is in units of the base glow radius (1 = uRadius). */
const sunFragment = /* glsl */ `
varying vec2 vUv;
varying float vGlare;
varying float vGrow;
varying float vAlpha;
${GRADE_GLSL}
void main() {
  float r = length(vUv);
  // A round window inside the quad, so no term ever reaches its square edge.
  float window = 1.0 - smoothstep(0.55 * vGrow, 0.98 * vGrow, r);
  if (window <= 0.0) discard;
  float core = 1.0 - smoothstep(0.035, 0.05, r);
  float glow = exp(-r / 0.06) * 1.6 + exp(-r / 0.2) * 0.35 + exp(-r / 0.55) * 0.06;
  float a = atan(vUv.y, vUv.x);
  float burst = pow(abs(cos(3.0 * a + 0.3)), 120.0) * exp(-r / 0.22) * 0.22;
  float glare = vGlare * (exp(-r / 0.9) * 0.08 + exp(-r / 0.25) * 0.25);
  vec3 warm = vec3(1.0, 0.78, 0.52);
  vec3 color = (vec3(1.0, 0.97, 0.92) * core * 9.0 + warm * (glow + burst + glare)) * window;
  // No dither on an additive sprite: noise would add up into a visible square.
  gl_FragColor = vec4(po_grade(color), 1.0);
  #include <colorspace_fragment>
  gl_FragColor.rgb *= vAlpha;
  ${ADDITIVE_ALPHA_FRAGMENT}
}
`;

export function createSunMaterial(position: Vector3, radius: number): ShaderMaterial {
  return new ShaderMaterial({
    name: 'CosmosSun',
    uniforms: withCosmos({ uSunPos: { value: position }, uRadius: { value: radius } }),
    vertexShader: sunVertex,
    fragmentShader: sunFragment,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });
}

/**
 * Constellation stars: instanced billboards (aOffset meters, aSize radius
 * meters, aLit 0..1, aFlash 0..1). Real stars: lit, a warm-white soft core
 * with a short four-point glint; unlit, a faint cool point. A flash swells
 * the glow, not the shape.
 */
const constellationStarVertex = /* glsl */ `
attribute vec3 aOffset;
attribute float aSize;
attribute float aLit;
attribute float aFlash;
varying vec2 vUv;
varying float vLit;
varying float vFlash;
varying float vAlpha;
${COSMOS_MASK_GLSL}
void main() {
  vec4 world = modelMatrix * vec4(aOffset, 1.0);
  vec4 mv = viewMatrix * world;
  mv.xy += position.xy * aSize;
  vUv = position.xy;
  vLit = aLit;
  vFlash = aFlash;
  vAlpha = po_cosmosAlpha(world.xyz);
  gl_Position = vAlpha > 0.002 && aSize > 0.0 ? projectionMatrix * mv : vec4(0.0, 0.0, 2.0, 1.0);
}
`;

const constellationStarFragment = /* glsl */ `
varying vec2 vUv;
varying float vLit;
varying float vFlash;
varying float vAlpha;
${GRADE_GLSL}
float po_ray(float across, float along) {
  float fw = fwidth(across);
  float w = max(0.02, fw);
  return exp(-(across * across) / (w * w)) * (0.02 / w) * pow(max(0.0, 1.0 - along), 3.0);
}
void main() {
  vec2 a = abs(vUv);
  float r = length(vUv);
  // Unlit: a faint cool point; lit: a bright core, a soft glow and a short glint.
  float point = exp(-r * r * 160.0);
  float glow = exp(-r * (9.0 - 5.0 * vFlash)) * (0.25 + 0.9 * vFlash);
  float glint = po_ray(vUv.y, a.x) + po_ray(vUv.x, a.y);
  vec3 cool = vec3(0.55, 0.62, 0.8) * point * 0.35;
  vec3 warm = vec3(1.0, 0.93, 0.8) * (point * 2.2 + glow + glint * 0.5);
  vec3 color = mix(cool, warm, vLit);
  gl_FragColor = vec4(po_grade(color), 1.0);
  #include <colorspace_fragment>
  gl_FragColor.rgb *= vAlpha;
  ${ADDITIVE_ALPHA_FRAGMENT}
}
`;

export function createConstellationStarMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: 'ConstellationStars',
    uniforms: withCosmos({}),
    vertexShader: constellationStarVertex,
    fragmentShader: constellationStarFragment,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });
}

/**
 * Constellation links: instanced camera-facing strips from aStart to aEnd
 * (meters), drawn to aProgress (0..1) of their length: a thin, faint
 * blue-white line, never under a pixel wide (it fades instead).
 */
const linkVertex = /* glsl */ `
attribute vec3 aStart;
attribute vec3 aEnd;
attribute float aProgress;
uniform float uWidth;
varying float vSide;
varying float vAlpha;
${COSMOS_MASK_GLSL}
void main() {
  vec4 sw = modelMatrix * vec4(aStart, 1.0);
  vec4 ew = modelMatrix * vec4(mix(aStart, aEnd, aProgress), 1.0);
  vec3 s = (viewMatrix * sw).xyz;
  vec3 e = (viewMatrix * ew).xyz;
  vec3 d = e - s;
  float len = length(d);
  vec3 dir = len > 1e-6 ? d / len : vec3(1.0, 0.0, 0.0);
  vec3 p = mix(s, e, position.x);
  vec3 side = normalize(cross(dir, normalize(-p)) + vec3(1e-6));
  p += side * position.y * uWidth * 0.5;
  vSide = position.y;
  vAlpha = po_cosmosAlpha(mix(sw.xyz, ew.xyz, position.x));
  gl_Position = aProgress > 0.001 && vAlpha > 0.002 ? projectionMatrix * vec4(p, 1.0) : vec4(0.0, 0.0, 2.0, 1.0);
}
`;

const linkFragment = /* glsl */ `
varying float vSide;
varying float vAlpha;
${GRADE_GLSL}
void main() {
  float s = abs(vSide);
  // The strip is 2 units across: 2 / fwidth pixels. Below 1.5 px it fades instead of breaking up.
  float pixels = 2.0 / max(fwidth(vSide), 1e-4);
  float line = (1.0 - smoothstep(0.3, 1.0, s)) * clamp(pixels / 1.5, 0.0, 1.0);
  vec3 color = vec3(0.62, 0.72, 0.95) * 0.45 * line;
  gl_FragColor = vec4(po_grade(color), 1.0);
  #include <colorspace_fragment>
  gl_FragColor.rgb *= vAlpha;
  ${ADDITIVE_ALPHA_FRAGMENT}
}
`;

export function createConstellationLinkMaterial(width: number): ShaderMaterial {
  return new ShaderMaterial({
    name: 'ConstellationLinks',
    uniforms: withCosmos({ uWidth: { value: width } }),
    vertexShader: linkVertex,
    fragmentShader: linkFragment,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    toneMapped: false,
  });
}

/** Shooting-star streaks: aStart, aVel (m/s), aBirth (real clock s); the quad spans tail to head. */
const streakVertex = /* glsl */ `
attribute vec3 aStart;
attribute vec3 aVel;
attribute float aBirth;
uniform float uTime;
uniform float uLife;
uniform float uWidth;
varying float vAlong;
varying float vSide;
varying float vAlpha;
${COSMOS_MASK_GLSL}
void main() {
  float age = uTime - aBirth;
  if (age < 0.0 || age > uLife) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); vAlpha = 0.0; return; }
  vec3 head = aStart + aVel * age;
  vec3 tail = head - aVel * min(age, 0.28);
  vec4 hw = modelMatrix * vec4(head, 1.0);
  vec4 tw = modelMatrix * vec4(tail, 1.0);
  vec3 h = (viewMatrix * hw).xyz;
  vec3 t = (viewMatrix * tw).xyz;
  vec3 dir = normalize(h - t + vec3(1e-6));
  vec3 side = normalize(cross(dir, normalize(-h)));
  vec3 p = mix(t, h, position.x) + side * position.y * uWidth * (0.3 + 0.7 * position.x);
  vAlong = position.x;
  vSide = position.y;
  float life = age / uLife;
  vAlpha = po_cosmosAlpha(hw.xyz) * smoothstep(0.0, 0.1, life) * (1.0 - smoothstep(0.7, 1.0, life));
  gl_Position = projectionMatrix * vec4(p, 1.0);
}
`;

const streakFragment = /* glsl */ `
varying float vAlong;
varying float vSide;
varying float vAlpha;
void main() {
  float core = 1.0 - abs(vSide);
  vec3 color = mix(vec3(1.0, 0.8, 0.35), vec3(1.0), pow(core, 3.0));
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
  gl_FragColor.rgb *= vAlpha * core * vAlong;
  ${ADDITIVE_ALPHA_FRAGMENT}
}
`;

export function createStreakMaterial(life: number, width: number): ShaderMaterial {
  return new ShaderMaterial({
    name: 'CosmosStreaks',
    uniforms: withCosmos({ uTime: SHARED_TIME, uLife: { value: life }, uWidth: { value: width } }),
    vertexShader: streakVertex,
    fragmentShader: streakFragment,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    toneMapped: false,
  });
}
