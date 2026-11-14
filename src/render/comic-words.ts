import {
  CanvasTexture,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  PlaneGeometry,
  ShaderMaterial,
  SRGBColorSpace,
} from '@iwsdk/core';
import {
  markRange,
  noRaycast,
  OCCLUSION_FRAGMENT,
  OCCLUSION_FRAGMENT_PARS,
  OCCLUSION_VERTEX,
  OCCLUSION_VERTEX_PARS,
  withOcclusion,
} from './shaders/common.js';

/*
 * Comic onomatopoeia: "WHOOSH!", "DING!", "BOOM!", "ZAP!", "KA-POW!" drawn once
 * at init into one 1024 x 512 canvas atlas (system fonts, thick ink stroke,
 * a bright fill and a drop offset; no font download), shown by one
 * InstancedMesh of SLOTS camera-facing billboards under the board root
 * (board units). A word pops (scale 0.6 to 1.1 to 1 over 0.25 s), holds and
 * fades out by LIFE; with reduced motion it only fades in and out. Every
 * word stays inside the rim and within MAX_TOP board units above the board
 * plane (the Meta VR Glasses fit).
 */

export type ComicWord = 'WHOOSH!' | 'DING!' | 'BOOM!' | 'ZAP!' | 'KA-POW!';
export const COMIC_WORDS: readonly ComicWord[] = ['WHOOSH!', 'DING!', 'BOOM!', 'ZAP!', 'KA-POW!'];

const SLOTS = 12;
const LIFE = 1.1;
const POP = 0.25;
/** Top of every word above the board plane (board units). */
export const MAX_TOP = 0.5;

const ATLAS_W = 1024;
const ATLAS_H = 512;

interface WordStyle {
  /** Word height on the board (board units). */
  height: number;
  /** Atlas cell (pixels). */
  cell: [number, number, number, number];
  fill: string;
  fill2: string;
  tilt: number;
}

const STYLES: Record<ComicWord, WordStyle> = {
  'KA-POW!': { height: 0.42, cell: [0, 0, 1024, 176], fill: '#ffe03a', fill2: '#ff7a1c', tilt: -0.06 },
  'WHOOSH!': { height: 0.3, cell: [0, 176, 1024, 160], fill: '#ffffff', fill2: '#7fd8ff', tilt: 0.05 },
  'BOOM!': { height: 0.34, cell: [0, 336, 400, 176], fill: '#ffb21c', fill2: '#ff4a1c', tilt: -0.05 },
  'ZAP!': { height: 0.26, cell: [400, 336, 312, 176], fill: '#e8f6ff', fill2: '#3fb6ff', tilt: 0.07 },
  'DING!': { height: 0.18, cell: [712, 336, 312, 176], fill: '#fff6a0', fill2: '#ffd23f', tilt: -0.04 },
};

/** Tight drawn rect of each word in the atlas (pixels), filled by the bake. */
const RECTS = new Map<ComicWord, [number, number, number, number]>();

function bakeAtlas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_H;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, ATLAS_W, ATLAS_H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  for (const word of COMIC_WORDS) {
    const { cell, fill, fill2, tilt } = STYLES[word];
    const [cx, cy, cw, ch] = cell;
    const stroke = ch * 0.1;
    const drop = ch * 0.06;
    // Largest font that fits the cell with the stroke, the drop and the tilt.
    let size = ch * 0.72;
    ctx.font = `900 ${size}px Impact, 'Arial Black', 'Helvetica Neue', sans-serif`;
    const measured = ctx.measureText(word).width;
    const maxW = cw - 2 * stroke - drop - ch * Math.abs(tilt) - 8;
    if (measured > maxW) size *= maxW / measured;
    ctx.font = `900 ${size}px Impact, 'Arial Black', 'Helvetica Neue', sans-serif`;
    const textW = ctx.measureText(word).width;
    const x = cx + cw / 2;
    const y = cy + ch / 2;
    ctx.save();
    ctx.translate(x, y);
    ctx.transform(1, 0, tilt, 1, 0, 0);
    // Drop offset, then the thick ink stroke, then the two-tone fill.
    ctx.lineWidth = stroke * 2;
    ctx.strokeStyle = '#101018';
    ctx.fillStyle = '#101018';
    ctx.strokeText(word, drop, drop);
    ctx.fillText(word, drop, drop);
    ctx.strokeText(word, 0, 0);
    const gradient = ctx.createLinearGradient(0, -size * 0.45, 0, size * 0.45);
    gradient.addColorStop(0, fill);
    gradient.addColorStop(0.55, fill);
    gradient.addColorStop(1, fill2);
    ctx.fillStyle = gradient;
    ctx.fillText(word, 0, 0);
    ctx.restore();
    const w = Math.min(cw, textW + 2 * stroke + drop + ch * Math.abs(tilt) + 8);
    RECTS.set(word, [x - w / 2, cy, w, ch]);
  }
  return canvas;
}

const vertexShader = /* glsl */ `${OCCLUSION_VERTEX_PARS}
attribute vec3 aOffset;
attribute vec2 aSize;
attribute vec4 aRect;
attribute float aAlpha;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(aOffset, 1.0);
  float s = length(modelViewMatrix[0].xyz);
  mv.xy += position.xy * aSize * s;
  // The atlas is not flipped (row 0 at v = 0): the quad's top samples the cell's top.
  vUv = aRect.xy + vec2(position.x + 0.5, 0.5 - position.y) * aRect.zw;
  vAlpha = aAlpha;
  gl_Position = aAlpha > 0.001 ? projectionMatrix * mv : vec4(0.0, 0.0, 2.0, 1.0);
  ${OCCLUSION_VERTEX}
}
`;

const fragmentShader = /* glsl */ `${OCCLUSION_FRAGMENT_PARS}
uniform sampler2D uAtlas;
varying vec2 vUv;
varying float vAlpha;
void main() {
  ${OCCLUSION_FRAGMENT}
  vec4 texel = texture2D(uAtlas, vUv);
  if (texel.a * vAlpha < 0.01) discard;
  gl_FragColor = vec4(texel.rgb, texel.a * vAlpha);
  #include <colorspace_fragment>
}
`;

export interface ComicWords {
  readonly mesh: InstancedMesh;
  /** Pops `word` at board point (x, y, z); y is the bottom of the word. */
  pop(word: ComicWord, x: number, y: number, z: number): void;
  update(dt: number, reducedMotion: boolean): void;
  /** Words showing now (debug). */
  active(): ComicWord[];
  /** The last 16 words popped, oldest first (debug). */
  recent(): ComicWord[];
}

export function createComicWords(): ComicWords {
  const texture = new CanvasTexture(bakeAtlas());
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = true;
  texture.flipY = false;

  const geometry = new PlaneGeometry(1, 1);
  const make = (n: number) => new InstancedBufferAttribute(new Float32Array(SLOTS * n), n).setUsage(DynamicDrawUsage);
  const offset = make(3);
  const size = make(2);
  const rect = make(4);
  const alpha = make(1);
  geometry.setAttribute('aOffset', offset);
  geometry.setAttribute('aSize', size);
  geometry.setAttribute('aRect', rect);
  geometry.setAttribute('aAlpha', alpha);
  const material = new ShaderMaterial({
    name: 'ComicWords',
    uniforms: withOcclusion({ uAtlas: { value: texture } }),
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    // Always legible over the bodies and the trail (real objects still hide them).
    depthTest: false,
    toneMapped: false,
  });
  const mesh = new InstancedMesh(geometry, material, SLOTS);
  mesh.name = 'ComicWords';
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  mesh.raycast = noRaycast;
  mesh.visible = false;

  const words: (ComicWord | null)[] = new Array(SLOTS).fill(null);
  const ages = new Float32Array(SLOTS);
  const widths = new Float32Array(SLOTS);
  const heights = new Float32Array(SLOTS);
  const history: ComicWord[] = [];
  let next = 0;

  const write = (slot: number, scale: number, a: number) => {
    const s = size.array as Float32Array;
    s[slot * 2] = widths[slot] * scale;
    s[slot * 2 + 1] = heights[slot] * scale;
    (alpha.array as Float32Array)[slot] = a;
    markRange(size, slot, 1);
    markRange(alpha, slot, 1);
  };

  return {
    mesh,
    pop(word, x, y, z) {
      const style = STYLES[word];
      const r = RECTS.get(word)!;
      const h = style.height;
      const w = (h * r[2]) / r[3];
      // Inside the rim: clamp the center so the word's half width stays inside.
      const maxX = Math.max(0, 1 - w / 2);
      const cx = Math.min(maxX, Math.max(-maxX, x));
      const maxZ = Math.max(0, Math.sqrt(Math.max(0, 1 - cx * cx)) - 0.1);
      const cz = Math.min(maxZ, Math.max(-maxZ, z));
      const cy = Math.min(MAX_TOP - h / 2, y + h / 2);
      const slot = next;
      next = (next + 1) % SLOTS;
      words[slot] = word;
      ages[slot] = 0;
      widths[slot] = w;
      heights[slot] = h;
      const o = offset.array as Float32Array;
      o[slot * 3] = cx;
      o[slot * 3 + 1] = cy;
      o[slot * 3 + 2] = cz;
      const q = rect.array as Float32Array;
      q[slot * 4] = r[0] / ATLAS_W;
      q[slot * 4 + 1] = r[1] / ATLAS_H;
      q[slot * 4 + 2] = r[2] / ATLAS_W;
      q[slot * 4 + 3] = r[3] / ATLAS_H;
      markRange(offset, slot, 1);
      markRange(rect, slot, 1);
      write(slot, 0.6, 0);
      history.push(word);
      if (history.length > 16) history.shift();
      mesh.visible = true;
    },
    update(dt, reducedMotion) {
      let any = false;
      for (let i = 0; i < SLOTS; i++) {
        if (words[i] === null) continue;
        const age = (ages[i] += dt);
        if (age >= LIFE) {
          words[i] = null;
          write(i, 0, 0);
          continue;
        }
        any = true;
        const fadeOut = 1 - Math.min(1, Math.max(0, (age - (LIFE - 0.35)) / 0.35));
        if (reducedMotion) {
          // No pop: the word only fades in and out.
          write(i, 1, Math.min(1, age / 0.15) * fadeOut);
        } else {
          const p = Math.min(1, age / POP);
          const scale = p < 0.6 ? 0.6 + (1.1 - 0.6) * (p / 0.6) : 1.1 - 0.1 * ((p - 0.6) / 0.4);
          write(i, scale, Math.min(1, age / 0.06) * fadeOut);
        }
      }
      mesh.visible = any;
    },
    active() {
      return words.filter((w): w is ComicWord => w !== null);
    },
    recent() {
      return [...history];
    },
  };
}
