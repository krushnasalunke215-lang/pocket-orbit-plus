import { BackSide, Color, ShaderMaterial, type IUniform } from '@iwsdk/core';
import { ROLE_COLORS } from '../palette.js';
import {
  INK_COLOR,
  linkOcclusion,
  OCCLUSION_FRAGMENT,
  OCCLUSION_FRAGMENT_PARS,
  OCCLUSION_VERTEX,
  OCCLUSION_VERTEX_PARS,
  withOcclusion,
} from './common.js';

/*
 * Comic ink outlines for the board objects: an inverted hull (back faces of
 * the same geometry, pushed out). The push is radial from the object's
 * origin (every board shape is star-shaped about its center, so faceted and
 * spiky shapes get a closed line too) and proportional to the view
 * distance, so the line keeps about the same width on screen near and far:
 * uInkWidth radians, scaled by INK_SCALE (high contrast widens it).
 */

/** Line width multiplier, shared by every ink material (1, or 1.5 with high contrast). */
export const INK_SCALE: IUniform<number> = { value: 1 };

/** Default line width in radians of view angle (about 0.25 degrees). */
export const INK_WIDTH = 0.0045;

const vertexShader = /* glsl */ `${OCCLUSION_VERTEX_PARS}
uniform float uInkWidth;
uniform float uInkScale;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec3 radial = mat3(modelMatrix) * position;
  float len = length(radial);
  vec3 dir = len > 1e-6 ? radial / len : vec3(0.0, 1.0, 0.0);
  float dist = length(cameraPosition - world.xyz);
  world.xyz += dir * uInkWidth * uInkScale * dist;
  gl_Position = projectionMatrix * viewMatrix * world;
  ${OCCLUSION_VERTEX}
}
`;

const fragmentShader = /* glsl */ `${OCCLUSION_FRAGMENT_PARS}
uniform vec3 uInk;
uniform float uOpacity;
void main() {
  ${OCCLUSION_FRAGMENT}
  gl_FragColor = vec4(uInk, uOpacity);
  #include <colorspace_fragment>
}
`;

const inkTemplate = new ShaderMaterial({
  name: 'Ink',
  uniforms: withOcclusion({
    uInk: { value: new Color(INK_COLOR) },
    uInkWidth: { value: INK_WIDTH },
    uInkScale: INK_SCALE,
    uOpacity: { value: 1 },
  }),
  vertexShader,
  fragmentShader,
  side: BackSide,
  toneMapped: false,
});

/** An ink material sharing the program and INK_SCALE; `transparent` for objects that fade (the comet). */
export function createInkMaterial(color: number = INK_COLOR, width = INK_WIDTH, transparent = false): ShaderMaterial {
  const material = linkOcclusion(inkTemplate.clone());
  material.uniforms.uInkScale = INK_SCALE;
  (material.uniforms.uInk.value as Color).setHex(color);
  material.uniforms.uInkWidth.value = width;
  material.transparent = transparent;
  return material;
}

/** Dark ink for the planets, moons, the white star, the target and the comet. */
export const inkDark = createInkMaterial();
/** Light ink (the event-horizon cream) for the black hole, so it reads on dark space and a dark table. */
export const inkLight = createInkMaterial(ROLE_COLORS.eventHorizon);
