import { AdditiveBlending, BackSide, Color, DoubleSide, ShaderMaterial, Vector3 } from '@iwsdk/core';
import { INK_COLOR, MOTION_TIME, NOISE_GLSL, SHARED_TIME, TOON_GLSL } from './common.js';
import { COSMOS_MASK_GLSL, withCosmos } from './sky.js';

/*
 * Cosmos materials (world meters, all transparent so the AR fade and the
 * island mask apply). Few programs: one toon surface and one ink hull for
 * every planet, moon and rock (all InstancedMesh, so the giant planet is an
 * instanced mesh of one), plus the ring, the star points, the sparkles and
 * the shooting stars.
 */

/** The cosmos key light (world, normalized): high and to the right. */
export const COSMOS_LIGHT = new Vector3(0.55, 0.62, 0.56).normalize();

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
      uLight: { value: COSMOS_LIGHT },
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

/** Star points: per-vertex aColor, aSize (pixels at 1000 px tall) and aPhase (twinkle). */
const starsVertex = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aPhase;
uniform float uPixelScale;
uniform float uTwinkle;
uniform float uTime;
varying vec3 vColor;
varying float vAlpha;
${COSMOS_MASK_GLSL}
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  float tw = 1.0 - uTwinkle * 0.5 * (1.0 + sin(uTime * (1.3 + aPhase * 2.1) + aPhase * 40.0));
  vColor = aColor * tw;
  vAlpha = po_cosmosAlpha(world.xyz);
  gl_Position = vAlpha > 0.002 ? projectionMatrix * viewMatrix * world : vec4(0.0, 0.0, 2.0, 1.0);
  gl_PointSize = max(1.0, aSize * uPixelScale * (0.8 + 0.2 * tw));
}
`;

const starsFragment = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  if (d > 1.0) discard;
  gl_FragColor = vec4(vColor, vAlpha * (1.0 - smoothstep(0.55, 1.0, d)));
  #include <colorspace_fragment>
}
`;

export function createStarPointsMaterial(twinkle: number, pixelScale: { value: number }): ShaderMaterial {
  return new ShaderMaterial({
    name: 'CosmosStars',
    uniforms: withCosmos({ uPixelScale: pixelScale, uTwinkle: { value: twinkle }, uTime: MOTION_TIME }),
    vertexShader: starsVertex,
    fragmentShader: starsFragment,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });
}

/** Four-point comic sparkles: instanced billboards (aOffset meters, aSize radius meters, aPhase). */
const sparkleVertex = /* glsl */ `
attribute vec3 aOffset;
attribute float aSize;
attribute float aPhase;
uniform float uTime;
varying vec2 vUv;
varying float vAlpha;
${COSMOS_MASK_GLSL}
void main() {
  vec4 world = modelMatrix * vec4(aOffset, 1.0);
  float tw = 0.75 + 0.25 * sin(uTime * (0.9 + aPhase) + aPhase * 30.0);
  vec4 mv = viewMatrix * world;
  mv.xy += position.xy * aSize * tw;
  vUv = position.xy;
  vAlpha = po_cosmosAlpha(world.xyz);
  gl_Position = vAlpha > 0.002 ? projectionMatrix * mv : vec4(0.0, 0.0, 2.0, 1.0);
}
`;

const sparkleFragment = /* glsl */ `
varying vec2 vUv;
varying float vAlpha;
void main() {
  vec2 a = abs(vUv);
  float star = sqrt(a.x) + sqrt(a.y);
  if (star > 1.0) discard;
  float core = 1.0 - smoothstep(0.0, 0.55, length(vUv));
  vec3 color = mix(vec3(1.0, 0.86, 0.35), vec3(1.0), core);
  gl_FragColor = vec4(color, vAlpha * (1.0 - smoothstep(0.85, 1.0, star)));
  #include <colorspace_fragment>
}
`;

export function createSparkleMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: 'CosmosSparkles',
    uniforms: withCosmos({ uTime: MOTION_TIME }),
    vertexShader: sparkleVertex,
    fragmentShader: sparkleFragment,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
}

/**
 * Constellation stars: instanced billboards (aOffset meters, aSize radius
 * meters, aLit 0..1, aFlash 0..1). A comic five-point-ish star: bold yellow
 * with an ink edge when lit, a dim blue-grey dot when not; a flash swells it
 * and burns it white.
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
  float size = aSize * (0.45 + 0.55 * aLit) * (1.0 + 0.8 * aFlash);
  mv.xy += position.xy * size;
  vUv = position.xy;
  vLit = aLit;
  vFlash = aFlash;
  vAlpha = po_cosmosAlpha(world.xyz);
  gl_Position = vAlpha > 0.002 && aSize > 0.0 ? projectionMatrix * mv : vec4(0.0, 0.0, 2.0, 1.0);
}
`;

const constellationStarFragment = /* glsl */ `
uniform vec3 uInk;
varying vec2 vUv;
varying float vLit;
varying float vFlash;
varying float vAlpha;
void main() {
  vec2 a = abs(vUv);
  float star = pow(a.x, 0.6) + pow(a.y, 0.6);
  float shape = mix(length(vUv) * 1.25, star, vLit);
  if (shape > 1.0) discard;
  vec3 fill = mix(vec3(0.42, 0.48, 0.62), vec3(1.0, 0.86, 0.24), vLit);
  fill = mix(fill, vec3(1.0, 0.98, 0.9), max(1.0 - smoothstep(0.0, 0.45, length(vUv)), vFlash) * vLit);
  float ink = smoothstep(0.74, 0.8, shape) * vLit;
  vec3 color = mix(fill, uInk, ink);
  gl_FragColor = vec4(color, vAlpha * mix(0.55, 1.0, vLit));
  #include <colorspace_fragment>
}
`;

export function createConstellationStarMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    name: 'ConstellationStars',
    uniforms: withCosmos({ uInk: { value: new Color(INK_COLOR) } }),
    vertexShader: constellationStarVertex,
    fragmentShader: constellationStarFragment,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
}

/**
 * Constellation links: instanced camera-facing strips from aStart to aEnd
 * (meters), drawn to aProgress (0..1) of their length: a bright core with
 * ink edges, like a printed line.
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
uniform vec3 uInk;
varying float vSide;
varying float vAlpha;
void main() {
  float s = abs(vSide);
  vec3 color = mix(vec3(1.0, 0.95, 0.7), uInk, smoothstep(0.42, 0.55, s));
  gl_FragColor = vec4(color, vAlpha * (1.0 - smoothstep(0.9, 1.0, s)));
  #include <colorspace_fragment>
}
`;

export function createConstellationLinkMaterial(width: number): ShaderMaterial {
  return new ShaderMaterial({
    name: 'ConstellationLinks',
    uniforms: withCosmos({ uInk: { value: new Color(INK_COLOR) }, uWidth: { value: width } }),
    vertexShader: linkVertex,
    fragmentShader: linkFragment,
    transparent: true,
    depthWrite: false,
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
