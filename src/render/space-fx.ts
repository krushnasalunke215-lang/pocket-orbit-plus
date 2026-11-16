import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  PlaneGeometry,
  ShaderMaterial,
} from '@iwsdk/core';
import {
  ADDITIVE_ALPHA_FRAGMENT,
  GRADE_GLSL,
  markRange,
  noRaycast,
  OCCLUSION_FRAGMENT,
  OCCLUSION_FRAGMENT_PARS,
  OCCLUSION_VERTEX,
  OCCLUSION_VERTEX_PARS,
  withOcclusion,
} from './shaders/common.js';

/*
 * Light effects on the board: one InstancedMesh of SLOTS camera-facing,
 * additive billboards under the board root (board units, one draw call).
 * Three patterns:
 *   0 flash: a hot core with a soft glow that fades out (FLASH_LIFE);
 *   1 shock shell: a thin expanding shell, limb-brightened, with a warm inner
 *     and a cool outer edge (a faint chromatic fringe), over SHELL_LIFE;
 *   2 rays: thin radial light rays that grow and fade (RAYS_LIFE).
 * burst() plays all three at one point (the supernova at a solve). With
 * reduced motion nothing expands: a short fade of the flash only. Every
 * effect stays within MAX_SIZE of its point and below MAX_TOP above the
 * board plane (the Meta VR Glasses fit).
 */

export type SpaceFxEvent = 'flyby' | 'push' | 'capture' | 'solve';

export const SPACE_FX_PATTERN = { flash: 0, shell: 1, rays: 2 } as const;

const SLOTS = 8;
const FLASH_LIFE = 0.35;
const SHELL_LIFE = 1.2;
const RAYS_LIFE = 0.9;
/** Reduced motion: the flash only, at its full size, fading over this. */
const STILL_LIFE = 0.3;
/** Largest effect radius (board units) and the highest point above the board plane. */
export const MAX_SIZE = 0.45;
export const MAX_TOP = 0.5;

const LIFE = [FLASH_LIFE, SHELL_LIFE, RAYS_LIFE];
/** An event counts as active (debug) this long after it happened (about a ripple's life). */
const ACTIVE_FOR = 1.2;

const vertexShader = /* glsl */ `${OCCLUSION_VERTEX_PARS}
attribute vec3 aOffset;
attribute float aSize;
attribute vec3 aColor;
attribute vec2 aState;
varying vec2 vUv;
varying vec3 vColor;
varying vec2 vState;
void main() {
  vec4 mv = modelViewMatrix * vec4(aOffset, 1.0);
  mv.xy += position.xy * aSize * length(modelViewMatrix[0].xyz);
  vUv = position.xy;
  vColor = aColor;
  vState = aState;
  gl_Position = aSize > 0.0 ? projectionMatrix * mv : vec4(0.0, 0.0, 2.0, 1.0);
  ${OCCLUSION_VERTEX}
}
`;

/** vState: x pattern, y progress 0..1 (its alpha envelope is computed here). */
const fragmentShader = /* glsl */ `${OCCLUSION_FRAGMENT_PARS}
varying vec2 vUv;
varying vec3 vColor;
varying vec2 vState;
${GRADE_GLSL}
void main() {
  ${OCCLUSION_FRAGMENT}
  float d = length(vUv);
  if (d >= 1.0) discard;
  float p = clamp(vState.y, 0.0, 1.0);
  float ease = 1.0 - (1.0 - p) * (1.0 - p) * (1.0 - p);
  vec3 c;
  if (vState.x < 0.5) {
    // Flash: a hot core and a wide soft glow, fading fast.
    float glow = exp(-d * d * 14.0) * 1.6 + exp(-d * d * 3.5) * 0.45 - 0.014;
    c = vColor * max(glow, 0.0) * (1.0 - p) * (1.0 - p);
  } else if (vState.x < 1.5) {
    // Shock shell: radius grows to 0.92, thinning light; limb-bright edge, faint fill inside.
    float R = 0.12 + 0.8 * ease;
    float w = 0.035 + 0.05 * p;
    float x = (d - R) / w;
    float ring = exp(-x * x);
    float inner = exp(-pow((d - R + 1.1 * w) / (0.7 * w), 2.0));
    float outer = exp(-pow((d - R - 1.1 * w) / (0.7 * w), 2.0));
    float fill = d < R ? 0.12 * (d / R) * (d / R) : 0.0;
    c = vColor * (ring + fill) + vec3(1.0, 0.42, 0.16) * inner * 0.45 + vec3(0.3, 0.55, 1.0) * outer * 0.55;
    c *= (1.0 - p) * (1.0 - smoothstep(0.9, 1.0, d));
  } else {
    // Rays: six long and ten short thin spikes that grow outward and fade.
    float ang = atan(vUv.y, vUv.x);
    float spikes = pow(abs(cos(ang * 3.0)), 90.0) + 0.55 * pow(abs(cos(ang * 5.0 + 0.6)), 140.0);
    float len = 0.25 + 0.75 * ease;
    float radial = exp(-d / (0.3 * len)) * (1.0 - smoothstep(0.7 * len, len, d));
    c = vColor * (spikes * radial * 1.4 + exp(-d * d * 30.0) * 0.6) * (1.0 - p);
  }
  gl_FragColor = vec4(po_grade(c), 1.0);
  #include <colorspace_fragment>
  ${ADDITIVE_ALPHA_FRAGMENT}
}
`;

export interface SpaceFx {
  readonly mesh: InstancedMesh;
  /** A flash glow of `size` board units at board point (x, y, z). */
  flash(x: number, y: number, z: number, size: number, colorHex: number): void;
  /** The supernova-like burst at board point (x, y, z): flash, shock shell and rays. */
  burst(x: number, y: number, z: number, colorHex: number): void;
  /** Records a feedback event for the debug snapshot. */
  note(event: SpaceFxEvent): void;
  update(dt: number, reducedMotion: boolean): void;
  /** Events of the last ACTIVE_FOR seconds (debug). */
  active(): SpaceFxEvent[];
  /** The last 16 events, oldest first (debug). */
  recent(): SpaceFxEvent[];
}

const scratchColor = new Color();

export function createSpaceFx(): SpaceFx {
  const geometry = new PlaneGeometry(2, 2);
  const make = (n: number) => new InstancedBufferAttribute(new Float32Array(SLOTS * n), n).setUsage(DynamicDrawUsage);
  const offset = make(3);
  const size = make(1);
  const color = make(3);
  const state = make(2);
  geometry.setAttribute('aOffset', offset);
  geometry.setAttribute('aSize', size);
  geometry.setAttribute('aColor', color);
  geometry.setAttribute('aState', state);
  const material = new ShaderMaterial({
    name: 'SpaceFx',
    uniforms: withOcclusion({}),
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });
  const mesh = new InstancedMesh(geometry, material, SLOTS);
  mesh.name = 'SpaceFx';
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.raycast = noRaycast;
  mesh.visible = false;

  const pattern = new Int8Array(SLOTS).fill(-1);
  const ages = new Float32Array(SLOTS);
  const lives = new Float32Array(SLOTS);
  const sizes = new Float32Array(SLOTS);
  const history: SpaceFxEvent[] = [];
  /** Seconds since each event last happened. */
  const since: Record<SpaceFxEvent, number> = { flyby: Infinity, push: Infinity, capture: Infinity, solve: Infinity };
  let reduced = false;
  let next = 0;

  const writeState = (slot: number, s: number, progress: number) => {
    (size.array as Float32Array)[slot] = s;
    const a = state.array as Float32Array;
    a[slot * 2] = Math.max(0, pattern[slot]);
    a[slot * 2 + 1] = progress;
    markRange(size, slot, 1);
    markRange(state, slot, 1);
  };

  const spawn = (kind: number, x: number, y: number, z: number, radius: number, colorHex: number) => {
    if (reduced && kind !== SPACE_FX_PATTERN.flash) return;
    const slot = next;
    next = (next + 1) % SLOTS;
    // Inside MAX_SIZE of the point and under MAX_TOP above the plane.
    const r = Math.max(0.02, Math.min(radius, MAX_SIZE, MAX_TOP - y));
    pattern[slot] = kind;
    ages[slot] = 0;
    lives[slot] = reduced ? STILL_LIFE : LIFE[kind];
    sizes[slot] = r;
    const o = offset.array as Float32Array;
    o[slot * 3] = x;
    o[slot * 3 + 1] = y;
    o[slot * 3 + 2] = z;
    scratchColor.setHex(colorHex);
    const c = color.array as Float32Array;
    c[slot * 3] = scratchColor.r;
    c[slot * 3 + 1] = scratchColor.g;
    c[slot * 3 + 2] = scratchColor.b;
    markRange(offset, slot, 1);
    markRange(color, slot, 1);
    writeState(slot, r, 0);
    mesh.visible = true;
  };

  return {
    mesh,
    flash(x, y, z, radius, colorHex) {
      spawn(SPACE_FX_PATTERN.flash, x, y, z, radius, colorHex);
    },
    burst(x, y, z, colorHex) {
      spawn(SPACE_FX_PATTERN.flash, x, y, z, 0.22, 0xfff4e0);
      spawn(SPACE_FX_PATTERN.shell, x, y, z, MAX_SIZE, colorHex);
      spawn(SPACE_FX_PATTERN.rays, x, y, z, MAX_SIZE, 0xfff0d8);
    },
    note(event) {
      since[event] = 0;
      history.push(event);
      if (history.length > 16) history.shift();
    },
    update(dt, reducedMotion) {
      reduced = reducedMotion;
      since.flyby += dt;
      since.push += dt;
      since.capture += dt;
      since.solve += dt;
      let any = false;
      for (let i = 0; i < SLOTS; i++) {
        if (pattern[i] < 0) continue;
        const age = (ages[i] += dt);
        if (age >= lives[i]) {
          writeState(i, 0, 1);
          pattern[i] = -1;
          continue;
        }
        any = true;
        const progress = age / lives[i];
        // Reduced motion: the flash keeps its size and progress drives only its fade.
        writeState(i, sizes[i], progress);
      }
      mesh.visible = any;
    },
    active() {
      const out: SpaceFxEvent[] = [];
      for (const key in since) if (since[key as SpaceFxEvent] < ACTIVE_FOR) out.push(key as SpaceFxEvent);
      return out;
    },
    recent() {
      return [...history];
    },
  };
}
