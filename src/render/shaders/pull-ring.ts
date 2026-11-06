import { AdditiveBlending, ShaderMaterial } from '@iwsdk/core';

/*
 * Pull rings: instanced flat quads lying on the board, each drawing a thin
 * ring at the body's influence radius with a faint fill toward the center.
 * Per instance: aOffset (center), aSize (ring radius), aColor, aAlpha and
 * aPattern (0 solid, 1 dotted, 2 dashed), so ring patterns echo body kinds.
 */

/** GLSL vertex: scales the unit quad (XZ) by the ring radius and moves it to the body. */
const vertexShader = /* glsl */ `
attribute vec3 aOffset;
attribute float aSize;
attribute vec3 aColor;
attribute float aAlpha;
attribute float aPattern;
varying vec2 vLocal;
varying vec3 vColor;
varying float vAlpha;
varying float vPattern;
varying float vRadius;
void main() {
  vLocal = position.xz;
  vColor = aColor;
  vAlpha = aAlpha;
  vPattern = aPattern;
  vRadius = aSize;
  vec3 p = aOffset + position * aSize;
  gl_Position = aSize > 0.0 ? projectionMatrix * modelViewMatrix * vec4(p, 1.0) : vec4(0.0, 0.0, 2.0, 1.0);
}
`;

/** GLSL fragment: thin ring line (patterned by angle) plus a soft inner well. */
const fragmentShader = /* glsl */ `
varying vec2 vLocal;
varying vec3 vColor;
varying float vAlpha;
varying float vPattern;
varying float vRadius;
const float TAU = 6.28318530718;
void main() {
  float r = length(vLocal);
  if (r > 1.0) discard;
  float width = 0.006 / max(vRadius, 1e-4);
  float line = 1.0 - smoothstep(0.0, width, abs(r - 1.0 + width));
  float a = atan(vLocal.y, vLocal.x) / TAU;
  if (vPattern > 1.5) line *= step(0.4, fract(a * 18.0));
  else if (vPattern > 0.5) line *= step(0.6, fract(a * 40.0));
  float well = pow(1.0 - r, 3.0) * 0.18;
  float alpha = (line + well) * vAlpha;
  gl_FragColor = vec4(vColor, alpha);
  #include <colorspace_fragment>
}
`;

/** Shared pull-ring material (one per module). */
export const pullRingMaterial = new ShaderMaterial({
  name: 'PullRing',
  vertexShader,
  fragmentShader,
  transparent: true,
  depthWrite: false,
  blending: AdditiveBlending,
  toneMapped: false,
});
