import { Color, ShaderMaterial } from '@iwsdk/core';
import { ROLE_COLORS } from '../palette.js';
import {
  HIGH_CONTRAST,
  INK_COLOR,
  OCCLUSION_FRAGMENT,
  OCCLUSION_FRAGMENT_PARS,
  OCCLUSION_VERTEX,
  OCCLUSION_VERTEX_PARS,
  withOcclusion,
} from './common.js';

/*
 * The comic board: a dark translucent glass disc in the board's XZ plane
 * (radius 1) with a faint Ben-Day dot screen, the three guide rings drawn
 * as printed dashed lines, and a thick comic rim: an inked inner edge, a
 * bold blue band, then a solid ink band out to about r = 1.035 with a
 * sharp outer edge. A small fresnel lift at grazing view angles. The glass
 * stays translucent (uOpacity) so the real table shows through.
 */

/** GLSL vertex: passes the disc-local XZ, the world position and the world up axis. */
const vertexShader = /* glsl */ `${OCCLUSION_VERTEX_PARS}
varying vec2 vLocal;
varying vec3 vWorldPos;
varying vec3 vUp;
void main() {
  vLocal = position.xz;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldPos = world.xyz;
  vUp = normalize((modelMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
  ${OCCLUSION_VERTEX}
}
`;

/** GLSL fragment: glass + dot screen + dashed guide rings + inked comic rim + fresnel lift. */
const fragmentShader = /* glsl */ `${OCCLUSION_FRAGMENT_PARS}
uniform vec3 uBase;
uniform vec3 uRim;
uniform vec3 uInk;
uniform float uOpacity;
uniform float uContrast;
varying vec2 vLocal;
varying vec3 vWorldPos;
varying vec3 vUp;
const float TAU = 6.28318530718;

/** 1 inside [a, b] with antialiased edges (aa: about one pixel in r). */
float band(float r, float a, float b, float aa) {
  return smoothstep(a - aa, a + aa, r) * (1.0 - smoothstep(b - aa, b + aa, r));
}

void main() {
  ${OCCLUSION_FRAGMENT}
  float r = length(vLocal);
  float aa = max(fwidth(r), 1e-4);
  // Rim layout (board units): glass to GLASS, a thin ink line, the blue band, the outer ink band.
  float widen = 0.012 * uContrast;
  float glassEnd = 0.952 - widen;
  float rimEnd = 0.998;
  float outerEnd = 1.036;
  if (r > outerEnd + aa) discard;

  float glass = 1.0 - smoothstep(glassEnd - aa, glassEnd + aa, r);
  vec3 color = uBase * (1.3 - 0.5 * r);
  float alpha = uOpacity * glass;

  // Ben-Day dot screen: a faint printed dot grid in the glass.
  vec2 cell = fract(vLocal * 26.0) - 0.5;
  float screenDot = 1.0 - smoothstep(0.17, 0.23, length(cell));
  color += uRim * screenDot * 0.14 * glass;
  alpha += screenDot * 0.05 * glass;

  // Guide rings as printed dashed lines.
  float a = atan(vLocal.y, vLocal.x) / TAU + 0.5;
  float ringW = 0.0045;
  float guides = band(r, 0.3 - ringW, 0.3 + ringW, aa) * step(0.45, fract(a * 24.0))
               + band(r, 0.6 - ringW, 0.6 + ringW, aa) * step(0.45, fract(a * 44.0))
               + band(r, 0.9 - ringW, 0.9 + ringW, aa) * step(0.45, fract(a * 64.0));
  color = mix(color, uRim * 1.25, guides * 0.85 * glass);
  alpha = mix(alpha, 0.75, guides * glass);

  // The comic rim: ink line, bold blue band (lighter toward its inner edge), ink band.
  vec3 rimColor = mix(uRim, vec3(1.0), 0.45 * uContrast);
  float innerInk = band(r, glassEnd - 0.004, glassEnd + 0.006, aa);
  float blue = band(r, glassEnd + 0.006, rimEnd, aa);
  float outerInk = band(r, rimEnd, outerEnd, aa);
  float shine = 1.0 - smoothstep(glassEnd + 0.006, rimEnd, r);
  color = mix(color, rimColor * (1.25 + 0.55 * shine + 0.6 * uContrast), blue);
  color = mix(color, uInk, max(innerInk, outerInk));
  alpha = max(alpha, max(blue, max(innerInk, outerInk)) * 0.97);

  // Fresnel lift: the glass brightens a little at grazing angles.
  vec3 V = normalize(cameraPosition - vWorldPos);
  float fresnel = pow(1.0 - abs(dot(normalize(vUp), V)), 2.0);
  color += uRim * fresnel * 0.18 * glass;
  alpha += fresnel * 0.12 * glass;

  gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

/** The one board material (created once per module). */
export const boardMaterial = new ShaderMaterial({
  name: 'BoardGlass',
  uniforms: withOcclusion({
    uBase: { value: new Color(ROLE_COLORS.board) },
    uRim: { value: new Color(ROLE_COLORS.boardRim) },
    uInk: { value: new Color(INK_COLOR) },
    uOpacity: { value: 0.55 },
    uContrast: HIGH_CONTRAST,
  }),
  vertexShader,
  fragmentShader,
  transparent: true,
  depthWrite: false,
  toneMapped: false,
});
