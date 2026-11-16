import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial, Vector4 } from '@iwsdk/core';
import { ADDITIVE_ALPHA_FRAGMENT, MOTION_TIME, noRaycast } from '../shaders/common.js';
import { COSMOS_MASK_GLSL, withCosmos } from '../shaders/sky.js';
import { mulberry32 } from './random.js';

/*
 * Near dust motes: the strongest cheap stereo cue in a headset. One Points
 * draw of `count` motes in a 3 m box that the vertex shader wraps around
 * each eye (cameraPosition + mod(p - cameraPosition + 1.5, 3) - 1.5), so the
 * player always sits inside the cloud; a mote shows only 0.3-1.5 m from the
 * eye (it fades in and out at both ends, so a wrap never pops). Each is
 * about 1.5 mm across in world size (perspective point size; under a pixel
 * the alpha falls instead), faint warm grey, drifting slowly on the motion
 * clock (still under reduced motion), masked like every cosmos layer.
 */

const BOX = 3;
const MOTE_SIZE = 0.0015;

const vertexShader = /* glsl */ `
attribute vec3 aDrift;
attribute float aGlow;
uniform float uTime;
uniform float uPixelsPerUnit;
varying float vAlpha;
${COSMOS_MASK_GLSL}
void main() {
  vec3 p = (modelMatrix * vec4(position + aDrift * uTime, 1.0)).xyz;
  p = cameraPosition + mod(p - cameraPosition + ${(BOX / 2).toFixed(1)}, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)};
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float dist = length(p - cameraPosition);
  float near = smoothstep(0.3, 0.45, dist) * (1.0 - smoothstep(1.1, 1.5, dist));
  float pixels = ${MOTE_SIZE.toFixed(4)} * uPixelsPerUnit * projectionMatrix[1][1] / max(-mv.z, 0.05);
  gl_PointSize = max(pixels, 1.0);
  vAlpha = near * min(pixels, 1.0) * aGlow * po_cosmosAlpha(p);
  gl_Position = vAlpha > 0.002 && mv.z < 0.0 ? projectionMatrix * mv : vec4(0.0, 0.0, 2.0, 1.0);
}
`;

const fragmentShader = /* glsl */ `
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d2 = dot(c, c) * 4.0;
  if (d2 > 1.0) discard;
  vec3 color = vec3(0.62, 0.57, 0.5) * 0.32 * vAlpha * (1.0 - d2 * 0.6);
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
  ${ADDITIVE_ALPHA_FRAGMENT}
}
`;

export function createDust(count: number): Points {
  const random = mulberry32(0xd057);
  const positions = new Float32Array(count * 3);
  const drift = new Float32Array(count * 3);
  const glow = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions.set([(random() - 0.5) * BOX, (random() - 0.5) * BOX, (random() - 0.5) * BOX], i * 3);
    // 0.4-1.6 cm/s in a random direction.
    const z = random() * 2 - 1;
    const a = random() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    const speed = 0.004 + 0.012 * random();
    drift.set([Math.cos(a) * s * speed, z * speed, Math.sin(a) * s * speed], i * 3);
    glow[i] = 0.5 + 0.5 * random();
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aDrift', new BufferAttribute(drift, 3));
  geometry.setAttribute('aGlow', new BufferAttribute(glow, 1));
  const pixelsPerUnit = { value: 900 };
  const material = new ShaderMaterial({
    name: 'CosmosDust',
    uniforms: withCosmos({ uTime: MOTION_TIME, uPixelsPerUnit: pixelsPerUnit }),
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false,
  });
  const dust = new Points(geometry, material);
  dust.name = 'CosmosDust';
  dust.renderOrder = -5.9;
  dust.frustumCulled = false;
  dust.raycast = noRaycast;
  // Half the current viewport height in pixels (per eye in XR): turns the
  // projection's [1][1] into pixels per unit of view-space height.
  const viewport = new Vector4();
  dust.onBeforeRender = (renderer) => {
    renderer.getCurrentViewport(viewport);
    pixelsPerUnit.value = viewport.w * 0.5;
  };
  return dust;
}
