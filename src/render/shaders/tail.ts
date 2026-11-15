import { AdditiveBlending, Color, DoubleSide, ShaderMaterial, Vector3 } from '@iwsdk/core';
import { SUN_DIRECTION } from '../../config.js';
import {
  ADDITIVE_ALPHA_FRAGMENT,
  GRADE_GLSL,
  OCCLUSION_FRAGMENT,
  OCCLUSION_FRAGMENT_PARS,
  OCCLUSION_VERTEX,
  OCCLUSION_VERTEX_PARS,
  SHARED_TIME,
  withOcclusion,
} from './common.js';

/*
 * The comet's two tails (board units, under the comet root).
 * Dust tail (Points): each particle stores where it was emitted (position),
 * when (aBirth, the shared clock) and a drift velocity (aVel: back along the
 * motion and away from the sun, plus spread), so the tail curves and fans
 * away from the sun. It ages from warm white through pale gold to dim dust
 * and fades out after uLife seconds.
 * Ion tail (one strip): straight from the head directly away from the sun
 * (-SUN_DIRECTION, board frame), pale blue, with fine striations streaming
 * outward on the shared clock; it widens a little and fades along its length.
 */

/** GLSL vertex: age-based drift and perspective point size in board units. */
const vertexShader = /* glsl */ `${OCCLUSION_VERTEX_PARS}
attribute float aBirth;
attribute vec3 aVel;
uniform float uTime;
uniform float uLife;
uniform float uSize;
uniform float uPixelScale;
varying float vLife;
varying float vFade;
void main() {
  float age = uTime - aBirth;
  float life = clamp(age / uLife, 0.0, 1.0);
  vLife = life;
  vec4 mv = modelViewMatrix * vec4(position + aVel * age, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = uSize * length(modelViewMatrix[0].xyz) * (0.45 + 0.9 * life);
  bool alive = age >= 0.0 && life < 1.0;
  float px = alive ? size * projectionMatrix[1][1] * uPixelScale / max(-mv.z, 1e-3) : 0.0;
  // Never under 1.5 px: smaller particles fade instead (no sparkle).
  vFade = clamp(px / 1.5, 0.0, 1.0);
  gl_PointSize = alive ? max(px, 1.5) : 0.0;
  ${OCCLUSION_VERTEX}
}
`;

/** GLSL fragment: a soft round sprite, warm white to pale gold to dust as it ages. */
const fragmentShader = /* glsl */ `${OCCLUSION_FRAGMENT_PARS}
uniform vec3 uHot;
uniform vec3 uGold;
uniform vec3 uDust;
uniform float uOpacity;
varying float vLife;
varying float vFade;
${GRADE_GLSL}
void main() {
  ${OCCLUSION_FRAGMENT}
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d >= 1.0) discard;
  float alpha = exp(-d * d * 3.5) * pow(1.0 - vLife, 1.6) * 0.55 * uOpacity * vFade;
  vec3 color = mix(uHot, uGold, smoothstep(0.0, 0.25, vLife));
  color = mix(color, uDust, smoothstep(0.25, 0.9, vLife));
  gl_FragColor = vec4(po_grade(color), alpha);
  #include <colorspace_fragment>
}
`;

/** Shared dust-tail material (one per module). uPixelScale is set before each render. */
export const tailMaterial = new ShaderMaterial({
  name: 'CometTail',
  uniforms: withOcclusion({
    uTime: SHARED_TIME,
    uLife: { value: 1.3 },
    uSize: { value: 0.05 },
    uPixelScale: { value: 400 },
    uOpacity: { value: 1 },
    uHot: { value: new Color(1.0, 0.95, 0.86) },
    uGold: { value: new Color(0.95, 0.78, 0.48) },
    uDust: { value: new Color(0.5, 0.36, 0.22) },
  }),
  vertexShader,
  fragmentShader,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  toneMapped: false,
});

/** Board-frame direction away from the sun (the ion tail and the dust drift). */
export const ANTI_SUN = new Vector3(-SUN_DIRECTION[0], -SUN_DIRECTION[1], -SUN_DIRECTION[2]).normalize();

/**
 * GLSL vertex: the strip geometry is x across (-0.5..0.5), y along (0..1);
 * the strip runs from uHead along uAxis for uLength and turns about that
 * axis to face the camera.
 */
const ionVertex = /* glsl */ `${OCCLUSION_VERTEX_PARS}
uniform vec3 uHead;
uniform vec3 uAxis;
uniform float uLength;
uniform float uWidth;
varying vec2 vStrip;
void main() {
  vec3 s = (modelViewMatrix * vec4(uHead, 1.0)).xyz;
  vec3 e = (modelViewMatrix * vec4(uHead + uAxis * uLength, 1.0)).xyz;
  vec3 dir = normalize(e - s + vec3(1e-6));
  vec3 p = mix(s, e, position.y);
  vec3 side = cross(dir, normalize(-p));
  float len = length(side);
  side = len > 1e-5 ? side / len : vec3(1.0, 0.0, 0.0);
  float w = uWidth * length(modelViewMatrix[0].xyz) * (0.35 + 0.65 * position.y);
  p += side * position.x * w;
  vStrip = vec2(position.x * 2.0, position.y);
  gl_Position = projectionMatrix * vec4(p, 1.0);
  ${OCCLUSION_VERTEX}
}
`;

const ionFragment = /* glsl */ `${OCCLUSION_FRAGMENT_PARS}
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
varying vec2 vStrip;
${GRADE_GLSL}
void main() {
  ${OCCLUSION_FRAGMENT}
  float across = abs(vStrip.x);
  float along = vStrip.y;
  float core = exp(-across * across * 7.0);
  // Striations: fine filaments across the strip, streaming outward.
  float fil = 0.7 + 0.3 * sin(vStrip.x * 23.0 + sin(along * 9.0 - uTime * 2.2) * 1.5);
  float knots = 0.8 + 0.2 * sin(along * 31.0 - uTime * 6.0);
  float fade = smoothstep(0.0, 0.06, along) * pow(1.0 - along, 1.4);
  float intensity = core * fil * knots * fade * uOpacity;
  gl_FragColor = vec4(po_grade(uColor * intensity), 1.0);
  #include <colorspace_fragment>
  ${ADDITIVE_ALPHA_FRAGMENT}
}
`;

/** The straight blue ion tail (one per page; additive). CometVisual writes uHead and uOpacity. */
export const ionTailMaterial = new ShaderMaterial({
  name: 'CometIonTail',
  uniforms: withOcclusion({
    uHead: { value: new Vector3() },
    uAxis: { value: ANTI_SUN.clone() },
    uLength: { value: 0.35 },
    uWidth: { value: 0.035 },
    uColor: { value: new Color(0.35, 0.62, 1.0) },
    uOpacity: { value: 1 },
    uTime: SHARED_TIME,
  }),
  vertexShader: ionVertex,
  fragmentShader: ionFragment,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  side: DoubleSide,
  toneMapped: false,
});
