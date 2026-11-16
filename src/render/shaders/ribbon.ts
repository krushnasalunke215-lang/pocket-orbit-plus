import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  ShaderMaterial,
} from '@iwsdk/core';
import {
  ADDITIVE_ALPHA_FRAGMENT,
  linkOcclusion,
  noRaycast,
  OCCLUSION_FRAGMENT,
  OCCLUSION_FRAGMENT_PARS,
  OCCLUSION_VERTEX,
  OCCLUSION_VERTEX_PARS,
  SHARED_TIME,
  withOcclusion,
} from './common.js';

/*
 * Instanced ribbon segments: every instance is one straight segment from
 * aStart to aEnd (board units) that the vertex shader turns into a
 * camera-facing quad of width uWidth. Additive. Trails fade by age; the
 * preview variant is dashed (uDash = 1) and uses aAge as its arc fraction.
 */

/** GLSL vertex: expands a segment into a camera-facing strip; computes alpha from age, dash and aAlpha. */
const vertexShader = /* glsl */ `${OCCLUSION_VERTEX_PARS}
attribute vec3 aStart;
attribute vec3 aEnd;
attribute float aAge;
attribute float aAlpha;
uniform float uWidth;
uniform float uTime;
uniform float uFade;
uniform float uFloor;
uniform float uDash;
uniform float uDashCount;
varying float vSide;
varying float vAlpha;
void main() {
  vec3 s = (modelViewMatrix * vec4(aStart, 1.0)).xyz;
  vec3 e = (modelViewMatrix * vec4(aEnd, 1.0)).xyz;
  vec3 d = e - s;
  float len = length(d);
  vec3 dir = len > 1e-7 ? d / len : vec3(1.0, 0.0, 0.0);
  vec3 p = mix(s, e, position.x);
  vec3 side = cross(dir, normalize(-p));
  float sideLen = length(side);
  side = sideLen > 1e-7 ? side / sideLen : vec3(0.0, 1.0, 0.0);
  float halfWidth = 0.5 * uWidth * length(modelViewMatrix[0].xyz);
  // Widen across the view and overlap the joints a little along the segment.
  p += side * position.y * halfWidth + dir * (position.x * 2.0 - 1.0) * halfWidth * 0.5;

  float fade = max(uFloor, 1.0 - (uTime - aAge) / uFade);
  float on = uDash > 0.5 ? step(0.45, fract(aAge * uDashCount)) * (1.0 - 0.6 * aAge) : 1.0;
  vAlpha = aAlpha * fade * on;
  vSide = position.y;
  // Hidden segments collapse outside the clip volume.
  gl_Position = vAlpha > 0.001 ? projectionMatrix * vec4(p, 1.0) : vec4(0.0, 0.0, 2.0, 1.0);
  ${OCCLUSION_VERTEX}
}
`;

/** GLSL fragment: soft edges across the strip with a slightly brighter core. */
const fragmentShader = /* glsl */ `${OCCLUSION_FRAGMENT_PARS}
uniform vec3 uColor;
varying float vSide;
varying float vAlpha;
void main() {
  ${OCCLUSION_FRAGMENT}
  float core = 1.0 - abs(vSide);
  float alpha = pow(core, 1.6) * vAlpha;
  vec3 color = mix(uColor, vec3(1.0, 0.97, 0.9), pow(core, 6.0) * 0.35);
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
  gl_FragColor.rgb *= alpha;
  ${ADDITIVE_ALPHA_FRAGMENT}
}
`;

const ribbonTemplate = new ShaderMaterial({
  name: 'Ribbon',
  uniforms: withOcclusion({
    uColor: { value: new Color(0xffffff) },
    uWidth: { value: 0.02 },
    uTime: SHARED_TIME,
    uFade: { value: 6 },
    uFloor: { value: 0.3 },
    uDash: { value: 0 },
    uDashCount: { value: 14 },
  }),
  vertexShader,
  fragmentShader,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  // The strip's winding depends on the segment direction relative to the view.
  side: DoubleSide,
  toneMapped: false,
});

export interface RibbonStyle {
  color: number;
  width: number;
  /** Seconds until a segment reaches `floor`; a huge value disables fading. */
  fade: number;
  floor: number;
  dashed: boolean;
}

/** A ribbon material sharing the program and the clock; create once per module. */
export function createRibbonMaterial(style: RibbonStyle): ShaderMaterial {
  const material = linkOcclusion(ribbonTemplate.clone());
  material.uniforms.uTime = SHARED_TIME;
  (material.uniforms.uColor.value as Color).setHex(style.color);
  material.uniforms.uWidth.value = style.width;
  material.uniforms.uFade.value = style.fade;
  material.uniforms.uFloor.value = style.floor;
  material.uniforms.uDash.value = style.dashed ? 1 : 0;
  return material;
}

/** One unit quad: x along the segment (0..1), y across it (-1..1). */
const quadPosition = new BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0]), 3);
const quadIndex = new BufferAttribute(new Uint16Array([0, 1, 2, 2, 1, 3]), 1);

export interface Ribbon {
  readonly mesh: InstancedMesh;
  readonly start: InstancedBufferAttribute;
  readonly end: InstancedBufferAttribute;
  readonly age: InstancedBufferAttribute;
  readonly alpha: InstancedBufferAttribute;
  readonly capacity: number;
}

/** An instanced ribbon with preallocated per-instance buffers (one draw call). */
export function createRibbon(capacity: number, material: ShaderMaterial): Ribbon {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', quadPosition);
  geometry.setIndex(quadIndex);
  const make = (size: number) =>
    new InstancedBufferAttribute(new Float32Array(capacity * size), size).setUsage(DynamicDrawUsage);
  const start = make(3);
  const end = make(3);
  const age = make(1);
  const alpha = make(1);
  geometry.setAttribute('aStart', start);
  geometry.setAttribute('aEnd', end);
  geometry.setAttribute('aAge', age);
  geometry.setAttribute('aAlpha', alpha);
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.count = 0;
  // Segments move every frame; their bounds are never valid for culling.
  mesh.frustumCulled = false;
  mesh.raycast = noRaycast;
  return { mesh, start, end, age, alpha, capacity };
}
