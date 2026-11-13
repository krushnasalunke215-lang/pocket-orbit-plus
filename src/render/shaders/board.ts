import { Color, ShaderMaterial } from '@iwsdk/core';
import { ROLE_COLORS } from '../palette.js';
import {
  HIGH_CONTRAST,
  OCCLUSION_FRAGMENT,
  OCCLUSION_FRAGMENT_PARS,
  OCCLUSION_VERTEX,
  OCCLUSION_VERTEX_PARS,
  withOcclusion,
} from './common.js';

/*
 * Holographic board disc: a dark translucent glass disc in the board's XZ
 * plane (radius 1) with a radial gradient, faint concentric guide rings, a
 * bright blue rim band with a soft outer glow, and a small fresnel lift at
 * grazing view angles. The geometry extends a little past r = 1 for the glow.
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

/** GLSL fragment: gradient glass + guide rings + rim band/glow + fresnel lift. */
const fragmentShader = /* glsl */ `${OCCLUSION_FRAGMENT_PARS}
uniform vec3 uBase;
uniform vec3 uRim;
uniform float uOpacity;
uniform float uContrast;
varying vec2 vLocal;
varying vec3 vWorldPos;
varying vec3 vUp;

float ringLine(float r, float at, float width) {
  return 1.0 - smoothstep(0.0, width, abs(r - at));
}

void main() {
  ${OCCLUSION_FRAGMENT}
  float r = length(vLocal);
  float inside = 1.0 - smoothstep(0.985, 0.995, r);

  // Radial gradient: a little lighter toward the center.
  vec3 color = uBase * (1.35 - 0.55 * r);
  float alpha = uOpacity * inside;

  // Three faint guide rings.
  float guides = ringLine(r, 0.3, 0.004) + ringLine(r, 0.6, 0.004) + ringLine(r, 0.9, 0.004);
  color += uRim * guides * 0.45 * inside;
  alpha += guides * 0.10 * inside;

  // Rim band at r = 1, a soft inner rim light and an outer glow. High
  // contrast widens the band, lifts it toward white and brightens the glow.
  float band = ringLine(r, 0.99, 0.012 + 0.012 * uContrast);
  float innerLight = smoothstep(0.75, 0.99, r) * inside;
  float glow = (1.0 - inside) * exp(-max(r - 0.99, 0.0) * 55.0);
  vec3 rim = mix(uRim, vec3(1.0), 0.45 * uContrast);
  color += rim * (band * (1.6 + 1.4 * uContrast) + innerLight * 0.35 + glow * (0.9 + 0.6 * uContrast));
  alpha = max(alpha, band * 0.95) + glow * 0.55;

  // Fresnel lift: the glass brightens a little at grazing angles.
  vec3 V = normalize(cameraPosition - vWorldPos);
  float fresnel = pow(1.0 - abs(dot(normalize(vUp), V)), 2.0);
  color += uRim * fresnel * 0.18 * inside;
  alpha += fresnel * 0.12 * inside;

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
    uOpacity: { value: 0.55 },
    uContrast: HIGH_CONTRAST,
  }),
  vertexShader,
  fragmentShader,
  transparent: true,
  depthWrite: false,
  toneMapped: false,
});
