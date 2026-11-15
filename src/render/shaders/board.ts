import { Color, ShaderMaterial, Vector3, Vector4 } from '@iwsdk/core';
import { SUN_DIRECTION } from '../../config.js';
import {
  GRID_FADE_START,
  GRID_DIP_SCALE,
  GRID_MAX_BODIES,
  GRID_MAX_BULGE,
  GRID_MIN_DIP,
  GRID_PIN_START,
  GRID_SOFTENING,
} from '../../game/spacetime.js';
import {
  GRADE_GLSL,
  HIGH_CONTRAST,
  OCCLUSION_FRAGMENT,
  OCCLUSION_FRAGMENT_PARS,
  OCCLUSION_VERTEX,
  OCCLUSION_VERTEX_PARS,
  SHARED_TIME,
  SUN_DIR_W,
  withOcclusion,
} from './common.js';

/*
 * The board: a dark glass plate (radius 1, board units, the board's XZ
 * plane) carrying the spacetime grid. The vertex shader bends the plate
 * under every body by its pull (the GLSL mirror of gridHeight in
 * src/game/spacetime.ts over uGrid / uGridCount: gridDip, pinned flat at
 * the rim), so a black hole sits over
 * a deep funnel, a planet over a softer dip and the white star over a low
 * bulge; ripples (uRipple, on the real clock) lift a travelling ring by at
 * most 0.01. The fragment shader draws anti-aliased grid lines every 0.1
 * (fwidth, faded before they get dense enough to shimmer), brighter in the
 * dips, a sun sheen on the bent surface, a thin light rim, a faint fresnel
 * edge, and the soft cast shadows of the floating bodies (uShadow).
 * Translucent (uOpacity) so the real table shows through in mixed reality.
 */

/** Ripple slots (x, z, start time on SHARED_TIME, strength; strength < 0 runs inward). */
export const RIPPLE_SLOTS = 4;
/** Ripple front speed (board units/s), lifetime (s) and the start radius of an inward ripple. */
const RIPPLE_SPEED = 0.55;
const RIPPLE_LIFE = 1.6;
const RIPPLE_REACH = 0.5;

/**
 * Board-frame direction of the light that casts the plate shadows: the sun's
 * azimuth, raised to about 62 degrees, so a body's shadow falls about one
 * body width from its foot (at the sun's own 27 degrees it would land 0.44
 * board units away and read as another object).
 */
const shadowDir = new Vector3(SUN_DIRECTION[0], SUN_DIRECTION[1] * 3.73, SUN_DIRECTION[2]).normalize();

const f = (v: number) => v.toFixed(5);

/** GLSL: gridDip (spacetime.ts) and the ripples, shared by the vertex stage. */
const GRID_GLSL = /* glsl */ `
#define PO_GRID_MAX ${GRID_MAX_BODIES}
uniform vec4 uGrid[PO_GRID_MAX];
uniform float uGridCount;
uniform vec4 uRipple[${RIPPLE_SLOTS}];
uniform float uTime;
float po_gridDip(vec2 p) {
  float y = 0.0;
  for (int i = 0; i < PO_GRID_MAX; i++) {
    if (float(i) >= uGridCount) break;
    vec4 g = uGrid[i];
    float d = length(p - g.xy);
    if (d >= g.w) continue;
    float taper = 1.0 - smoothstep(${f(GRID_FADE_START)} * g.w, g.w, d);
    y += -${f(GRID_DIP_SCALE)} * g.z * taper / sqrt(d * d + ${f(GRID_SOFTENING * GRID_SOFTENING)});
  }
  y = clamp(y, ${f(GRID_MIN_DIP)}, ${f(GRID_MAX_BULGE)});
  return y * (1.0 - smoothstep(${f(GRID_PIN_START)}, 1.0, length(p)));
}
/** Lift (at most 0.01) of the travelling ripple rings at p; light: how much they light the lines. */
float po_ripple(vec2 p, out float light) {
  float lift = 0.0;
  light = 0.0;
  for (int i = 0; i < ${RIPPLE_SLOTS}; i++) {
    vec4 r = uRipple[i];
    float age = uTime - r.z;
    if (r.w == 0.0 || age < 0.0 || age > ${f(RIPPLE_LIFE)}) continue;
    float d = length(p - r.xy);
    float front = r.w > 0.0 ? age * ${f(RIPPLE_SPEED)} : max(0.0, ${f(RIPPLE_REACH)} - age * ${f(RIPPLE_SPEED)});
    float x = (d - front) / 0.045;
    float fade = 1.0 - age / ${f(RIPPLE_LIFE)};
    float k = exp(-x * x) * fade * fade * min(abs(r.w), 1.5);
    lift += 0.01 * k;
    light += k;
  }
  return min(lift, 0.01);
}
`;

/** GLSL vertex: bends the plate, finite-difference normal, board and world positions. */
const vertexShader = /* glsl */ `${OCCLUSION_VERTEX_PARS}
${GRID_GLSL}
varying vec2 vLocal;
varying vec3 vBoard;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying float vDip;
varying float vRipple;
void main() {
  vec2 p = position.xz;
  vLocal = p;
  float dip = 0.0;
  vec3 n = vec3(0.0, 1.0, 0.0);
  float light = 0.0;
  float lift = 0.0;
  if (length(p) < 1.06) {
    dip = po_gridDip(p);
    const float e = 0.012;
    float hx = po_gridDip(p + vec2(e, 0.0));
    float hz = po_gridDip(p + vec2(0.0, e));
    n = normalize(vec3(dip - hx, e, dip - hz));
    lift = po_ripple(p, light);
  }
  vDip = dip;
  vRipple = light;
  vec3 board = vec3(p.x, dip + lift, p.y);
  vBoard = board;
  vec4 world = modelMatrix * vec4(board, 1.0);
  vWorldPos = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * n);
  gl_Position = projectionMatrix * viewMatrix * world;
  // Occlusion uses the flat plate's depth: the funnels dip below the table
  // top, and the real table must not hide them (a cup standing on the plate still does).
  vOcclusionViewDepth = (projectionMatrix * viewMatrix * modelMatrix * vec4(p.x, 0.0, p.y, 1.0)).w;
}
`;

/** GLSL fragment: glass, grid lines, sheen, rim, fresnel, cast shadows, the shared grade. */
const fragmentShader = /* glsl */ `${OCCLUSION_FRAGMENT_PARS}
#define PO_GRID_MAX ${GRID_MAX_BODIES}
uniform vec3 uGlass;
uniform vec3 uLine;
uniform vec3 uRimColor;
uniform float uOpacity;
uniform float uContrast;
uniform vec3 uSunDir;
uniform vec3 uShadowDir;
uniform vec4 uShadow[PO_GRID_MAX];
uniform float uShadowCount;
varying vec2 vLocal;
varying vec3 vBoard;
varying vec3 vWorldPos;
varying vec3 vNormalW;
varying float vDip;
varying float vRipple;
${GRADE_GLSL}

/** Soft shadow of the floating bodies: each a disc cast along uShadowDir, its penumbra growing with height. */
float po_shadow(vec3 p) {
  float shade = 0.0;
  for (int i = 0; i < PO_GRID_MAX; i++) {
    if (float(i) >= uShadowCount) break;
    vec4 s = uShadow[i];
    vec3 toC = vec3(s.x, s.y, s.z) - p;
    float t = dot(toC, uShadowDir);
    if (t <= 0.0 || s.w <= 0.0) continue;
    float d = length(toC - uShadowDir * t);
    float pen = s.w * 0.3 + t * 0.12;
    shade = max(shade, 1.0 - smoothstep(s.w - pen, s.w + pen, d));
  }
  return shade;
}

void main() {
  ${OCCLUSION_FRAGMENT}
  float r = length(vLocal);
  if (r > 1.04) discard;
  float aaR = max(fwidth(r), 1e-4);
  float glass = 1.0 - smoothstep(1.0 - aaR, 1.0 + aaR, r);

  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float ndv = abs(dot(N, V));

  // Grid lines every 0.1 board units on the undisplaced plane: about 1.5 px
  // wide (fwidth), faded out before the cells get small enough to shimmer.
  vec2 g = vLocal * 10.0;
  vec2 fw = max(fwidth(g), vec2(1e-5));
  vec2 px = abs(fract(g - 0.5) - 0.5) / fw;
  float halfWidth = 0.6 + 0.4 * uContrast;
  float line = 1.0 - smoothstep(halfWidth - 0.5, halfWidth + 0.7, min(px.x, px.y));
  line *= 1.0 - smoothstep(0.1, 0.32, max(fw.x, fw.y));
  line *= glass * (1.0 - 0.45 * smoothstep(0.8, 1.0, r));

  float depth = clamp(-vDip / 0.12, 0.0, 1.0);
  float bulge = clamp(vDip / 0.05, 0.0, 1.0);
  float shade = po_shadow(vBoard) * glass;

  vec3 color = uGlass;
  float alpha = uOpacity * glass;

  // The lines: dim on the flat plate, brighter down the funnels and on the bulges, lit by ripples.
  float lineGain = (0.4 + 1.9 * depth + 0.9 * bulge + 1.6 * vRipple) * (1.0 + 0.9 * uContrast) * (1.0 - 0.75 * shade);
  color += uLine * line * lineGain;
  alpha += line * (0.18 + 0.4 * depth + 0.25 * bulge + 0.3 * vRipple + 0.25 * uContrast) * (1.0 - 0.6 * shade);

  // Sun sheen on the bent glass (strongest on the funnel walls that face the sun's mirror angle).
  vec3 H = normalize(uSunDir + V);
  float nh = max(dot(N, H), 0.0);
  float sheen = (pow(nh, 90.0) * 0.55 + pow(nh, 14.0) * 0.035) * glass * (1.0 - shade);
  color += vec3(1.0, 0.94, 0.84) * sheen;
  alpha += sheen * 0.6;

  // Cast shadows: the glass darkens and grows more opaque, so they read over a light table too.
  color *= 1.0 - 0.8 * shade;
  alpha = mix(alpha, 0.78, 0.7 * shade);

  // A faint fresnel edge, then the thin light rim at r 0.99-1.0 with a soft glow just outside.
  float fresnel = pow(1.0 - ndv, 3.0) * glass;
  vec3 rimColor = mix(uRimColor, vec3(1.0), 0.5 * uContrast);
  color += rimColor * fresnel * 0.1;
  alpha += fresnel * 0.1;
  float rimWidth = 0.005 + 0.004 * uContrast;
  float rim = 1.0 - smoothstep(rimWidth - aaR, rimWidth + aaR, abs(r - 0.995));
  float outer = (1.0 - smoothstep(1.0, 1.04, r)) * step(1.0, r);
  color += rimColor * (rim * (1.1 + 1.2 * uContrast) + outer * 0.12);
  alpha = max(alpha, rim * (0.75 + 0.2 * uContrast));
  alpha += outer * 0.12;

  gl_FragColor = vec4(po_dither(po_grade(color)), clamp(alpha, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

function vec4s(n: number): Vector4[] {
  return Array.from({ length: n }, () => new Vector4());
}

/** The one board material (created once per module). BoardVisual writes uGrid, uShadow and uRipple. */
export const boardMaterial = new ShaderMaterial({
  name: 'BoardGlass',
  uniforms: withOcclusion({
    uGlass: { value: new Color(0x05080f) },
    uLine: { value: new Color(0x5f8fd8) },
    uRimColor: { value: new Color(0xa9c6f0) },
    uOpacity: { value: 0.38 },
    uContrast: HIGH_CONTRAST,
    uSunDir: SUN_DIR_W,
    uShadowDir: { value: shadowDir },
    uTime: SHARED_TIME,
    uGrid: { value: vec4s(GRID_MAX_BODIES) },
    uGridCount: { value: 0 },
    uShadow: { value: vec4s(GRID_MAX_BODIES) },
    uShadowCount: { value: 0 },
    uRipple: { value: vec4s(RIPPLE_SLOTS) },
  }),
  vertexShader,
  fragmentShader,
  transparent: true,
  depthWrite: false,
  toneMapped: false,
});
