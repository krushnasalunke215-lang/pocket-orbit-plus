import { AdditiveBlending, BackSide, Color, DoubleSide, ShaderMaterial, type Vector3 } from '@iwsdk/core';
import { GRADE_GLSL, INK_COLOR, MOTION_TIME, NOISE_GLSL, SHARED_TIME, SUN_DIR_W, TOON_GLSL } from './common.js';
import { COSMOS_MASK_GLSL, withCosmos } from './sky.js';

/*
 * Cosmos materials (world meters, all transparent so the AR fade and the
 * island mask apply). Few programs: one surface and one ink hull for every
 * planet, moon and rock (all InstancedMesh, so the giant planet is an
 * instanced mesh of one; lit by the shared SUN_DIR_W), plus the ring, the
 * star points, the star glints, the sun, the constellation and the
 * shooting stars.
 */

/** Per-instance: aColor (base), aBand (band color), aPulse (0..1, L4 echo). */
const surfaceVertex = /* glsl */ `
attribute vec3 aColor;
attribute vec3 aBand;
attribute float aPulse;
uniform float uPulseScale;
varying vec3 vNormalW;
varying vec3 vWorldPos;
varying vec3 vLocal;
varying vec3 vColor;
varying vec3 vBand;
varying float vPulse;
void main() {
  vLocal = position;
  mat4 m = modelMatrix * instanceMatrix;
  vec4 world = m * vec4(position * (1.0 + uPulseScale * aPulse), 1.0);
  vWorldPos = world.xyz;
  vNormalW = normalize(mat3(m) * normal);
  vColor = aColor;
  vBand = aBand;
  vPulse = aPulse;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/**
 * Toon bands, halftone dots in the shadow, gas-giant bands (uBands > 0),
 * a dark ink rim at grazing angles and a bright pulse rim.
 */
const surfaceFragment = /* glsl */ `
uniform vec3 uLight;
uniform vec3 uInk;
uniform float uBands;
uniform float uDotRows;
uniform float uTime;
varying vec3 vNormalW;
varying vec3 vWorldPos;
varying vec3 vLocal;
varying vec3 vColor;
varying vec3 vBand;
varying float vPulse;
${COSMOS_MASK_GLSL}
${NOISE_GLSL}
${TOON_GLSL}
void main() {
  float alpha = po_cosmosAlpha(vWorldPos);
  if (alpha <= 0.002) discard;
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 dir = normalize(vLocal);
  float bands = uBands > 0.0 ? step(0.5, po_noise1(dir.y * uBands + po_noise1(dir.x * 3.0 + uTime * 0.02) * 1.2)) : 0.0;
  vec3 surface = mix(vColor, vBand, bands);
  float ndl = dot(N, uLight);
  vec3 color = surface * po_toon(ndl);
  color *= 1.0 - 0.5 * po_dots(dir, uDotRows, po_shade(ndl));
  float ndv = max(dot(N, V), 0.0);
  color += vec3(1.0, 0.95, 0.8) * vPulse * pow(1.0 - ndv, 2.0) * 1.6;
  color = mix(color, uInk, 1.0 - smoothstep(0.12, 0.2, ndv));
  gl_FragColor = vec4(color, alpha);
  #include <colorspace_fragment>
}
`;

export interface CosmosSurfaceOptions {
  /** Gas-giant band frequency (0: none). */
  bands: number;
  /** Halftone rows pole to pole. */
  dotRows: number;
  /** Size swell per unit pulse (0 under reduced motion; CosmosVisual writes it). */
  pulseScale: { value: number };
}

export function createCosmosSurfaceMaterial(options: CosmosSurfaceOptions): ShaderMaterial {
  return new ShaderMaterial({
    name: 'CosmosSurface',
    uniforms: withCosmos({
      uLight: SUN_DIR_W,
      uInk: { value: new Color(INK_COLOR) },
      uBands: { value: options.bands },
      uDotRows: { value: options.dotRows },
      uTime: MOTION_TIME,
      uPulseScale: options.pulseScale,
    }),
    vertexShader: surfaceVertex,
    fragmentShader: surfaceFragment,
    transparent: true,
    toneMapped: false,
  });
}

const inkVertex = /* glsl */ `
attribute float aPulse;
uniform float uInkWidth;
uniform float uPulseScale;
varying vec3 vWorldPos;
void main() {
  vec4 world = modelMatrix * instanceMatrix * vec4(position * (1.0 + uInkWidth) * (1.0 + uPulseScale * aPulse), 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const inkFragment = /* glsl */ `
uniform vec3 uInk;
varying vec3 vWorldPos;
${COSMOS_MASK_GLSL}
void main() {
  float alpha = po_cosmosAlpha(vWorldPos);
  if (alpha <= 0.002) discard;
  gl_FragColor = vec4(uInk, alpha);
  #include <colorspace_fragment>
}
`;

/** Inverted-hull ink outline for an instanced cosmos mesh (shares its instance matrices). */
export function createCosmosInkMaterial(width: number, pulseScale: { value: number }): ShaderMaterial {
  return new ShaderMaterial({
    name: 'CosmosInk',
    uniforms: withCosmos({
      uInk: { value: new Color(INK_COLOR) },
      uInkWidth: { value: width },
      uPulseScale: pulseScale,
    }),
    vertexShader: inkVertex,
    fragmentShader: inkFragment,
    side: BackSide,
    transparent: true,
    toneMapped: false,
  });
}

const ringVertex = /* glsl */ `
varying vec2 vLocal;
varying vec3 vWorldPos;
void main() {
  vLocal = position.xz;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/** Printed ring: cream and orange bands split by ink stripes, inked edges. */
const ringFragment = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uInk;
uniform float uInner;
uniform float uOuter;
varying vec2 vLocal;
varying vec3 vWorldPos;
${COSMOS_MASK_GLSL}
void main() {
  float r = length(vLocal);
  float t = (r - uInner) / (uOuter - uInner);
  if (t < 0.0 || t > 1.0) discard;
  float alpha = po_cosmosAlpha(vWorldPos);
  if (alpha <= 0.002) discard;
  float w = fwidth(t) * 1.5;
  vec3 color = mix(uColorA, uColorB, step(0.5, fract(t * 2.5)));
  float stripes = 1.0 - smoothstep(0.03, 0.03 + w, abs(fract(t * 2.5 + 0.5) - 0.5));
  float edge = 1.0 - smoothstep(0.045, 0.045 + w, min(t, 1.0 - t));
  color = mix(color, uInk, max(stripes, edge));
  float gap = 1.0 - 0.7 * (1.0 - smoothstep(0.0, w * 2.0, abs(t - 0.62) - 0.04));
  gl_FragColor = vec4(color, alpha * 0.95 * gap);
  #include <colorspace_fragment>
}
`;

export function createCosmosRingMaterial(colorA: number, colorB: number, inner: number, outer: number): ShaderMaterial {
  return new ShaderMaterial({
    name: 'CosmosRing',
    uniforms: withCosmos({
      uColorA: { value: new Color(colorA) },
      uColorB: { value: new Color(colorB) },
      uInk: { value: new Color(INK_COLOR) },
      uInner: { value: inner },
      uOuter: { value: outer },
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
  gl_FragColor = vec4(po_grade(vColor * falloff), vAlpha);
  #include <colorspace_fragment>
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
  gl_FragColor = vec4(po_grade(color), vAlpha);
  #include <colorspace_fragment>
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
  gl_FragColor = vec4(po_grade(color), vAlpha);
  #include <colorspace_fragment>
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
  gl_FragColor = vec4(po_grade(color), vAlpha);
  #include <colorspace_fragment>
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
  gl_FragColor = vec4(po_grade(color), vAlpha);
  #include <colorspace_fragment>
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
  gl_FragColor = vec4(color, vAlpha * core * vAlong);
  #include <colorspace_fragment>
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
