import { BackSide, ShaderMaterial, Vector3, type IUniform, type Texture } from '@iwsdk/core';
import {
  ISLAND_COS_CLEAR,
  ISLAND_COS_FULL,
  ISLAND_SIN_BELOW_CLEAR,
  ISLAND_SIN_BELOW_FULL,
} from '../../game/cosmos-rules.js';

/*
 * The cosmos' shared uniforms and mask, and the sky dome material.
 * Every cosmos layer multiplies its alpha by po_cosmosAlpha(worldPos): the
 * session opacity (the AR fade-in, Your Table's cap) times the island mask,
 * which in Mixed room view keeps the room visible around the board and
 * below eye level. The GLSL mirrors islandMask in src/game/cosmos-rules.ts.
 */

/** Shared by every cosmos material (the same objects, written once per frame by CosmosSystem). */
export const COSMOS_UNIFORMS = {
  uCosmosOpacity: { value: 1 } as IUniform<number>,
  /** 0: no mask; 1: the island mask. */
  uMaskMode: { value: 0 } as IUniform<number>,
  /** World position of the board center (the island's middle). */
  uBoardCenterW: { value: new Vector3() } as IUniform<Vector3>,
};

/** `uniforms` plus the shared cosmos uniforms. */
export function withCosmos<T extends Record<string, IUniform>>(uniforms: T): T & typeof COSMOS_UNIFORMS {
  return { ...uniforms, ...COSMOS_UNIFORMS };
}

const f = (x: number) => x.toFixed(6);

/** GLSL (vertex or fragment): po_islandMask(worldPos) and po_cosmosAlpha(worldPos). */
export const COSMOS_MASK_GLSL = /* glsl */ `
uniform float uCosmosOpacity;
uniform float uMaskMode;
uniform vec3 uBoardCenterW;
float po_islandMask(vec3 worldPos) {
  if (uMaskMode < 0.5) return 1.0;
  vec3 d = normalize(worldPos - cameraPosition);
  vec3 b = normalize(uBoardCenterW - cameraPosition);
  float away = 1.0 - smoothstep(${f(ISLAND_COS_FULL)}, ${f(ISLAND_COS_CLEAR)}, dot(d, b));
  float above = smoothstep(${f(ISLAND_SIN_BELOW_CLEAR)}, ${f(ISLAND_SIN_BELOW_FULL)}, d.y);
  return away * above;
}
float po_cosmosAlpha(vec3 worldPos) {
  return uCosmosOpacity * po_islandMask(worldPos);
}
`;

const vertexShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPos;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/** One texture fetch per pixel: the sky was baked at init (sky-pixels.ts). */
const fragmentShader = /* glsl */ `
uniform sampler2D uSky;
varying vec2 vUv;
varying vec3 vWorldPos;
${COSMOS_MASK_GLSL}
void main() {
  float alpha = po_cosmosAlpha(vWorldPos);
  if (alpha <= 0.002) discard;
  gl_FragColor = vec4(texture2D(uSky, vUv).rgb, alpha);
  #include <colorspace_fragment>
}
`;

/** The sky dome's material (the one large full-screen transparent layer). */
export function createSkyMaterial(sky: Texture): ShaderMaterial {
  return new ShaderMaterial({
    name: 'CosmosSky',
    uniforms: withCosmos({ uSky: { value: sky } }),
    vertexShader,
    fragmentShader,
    side: BackSide,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
}
