import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  PlaneGeometry,
} from '@iwsdk/core';
import { markRange, noRaycast } from '../shaders/common.js';
import { createConstellationLinkMaterial, createConstellationStarMaterial } from '../shaders/cosmos.js';
import type { ConstellationVisual } from '../visual-types.js';

/*
 * The chapter's constellation in the cosmos frame (meters, scaled by\n * CONSTELLATION_SCALE at render time): real stars and thin faint links; one instanced
 * star pool and one instanced pool of link strips, two draw calls. Stars
 * are lit by the saved solved levels; a solve flashes its star; links join
 * consecutive solved levels and can be drawn in order (the chapter-complete
 * moment). Writes happen only while something changes.
 */

const MAX_STARS = 8;
const MAX_LINKS = MAX_STARS - 1;
/**
 * sky-story.ts places the stars about 8 m out; they are drawn this much
 * farther (about 32 m: behind the planets, in front of the star field),
 * so they sit among the real stars instead of in front of the planets.
 */
export const CONSTELLATION_SCALE = 4;
/** Billboard half-size (meters at about 32 m): the core is a small fraction of it, the rest is glow and glint. */
const STAR_SIZE = 1.5;
/** Link strip width (meters at about 32 m: about 2 px on a Quest). */
const LINK_WIDTH = 0.06;
const FLASH_DECAY = 1.6;
const FADE_IN = 0.8;

const quadPosition = new BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0]), 3);
const quadIndex = new BufferAttribute(new Uint16Array([0, 1, 2, 2, 1, 3]), 1);

export function createConstellation(): ConstellationVisual {
  const root = new Group();
  root.name = 'Constellation';

  const starGeometry = new PlaneGeometry(2, 2);
  const make = (n: number, count: number) => new InstancedBufferAttribute(new Float32Array(count * n), n).setUsage(DynamicDrawUsage);
  const offset = make(3, MAX_STARS);
  const size = make(1, MAX_STARS);
  const lit = make(1, MAX_STARS);
  const flash = make(1, MAX_STARS);
  starGeometry.setAttribute('aOffset', offset);
  starGeometry.setAttribute('aSize', size);
  starGeometry.setAttribute('aLit', lit);
  starGeometry.setAttribute('aFlash', flash);
  const stars = new InstancedMesh(starGeometry, createConstellationStarMaterial(), MAX_STARS);
  stars.name = 'ConstellationStars';

  const linkGeometry = new BufferGeometry();
  linkGeometry.setAttribute('position', quadPosition);
  linkGeometry.setIndex(quadIndex);
  const start = make(3, MAX_LINKS);
  const end = make(3, MAX_LINKS);
  const progress = make(1, MAX_LINKS);
  linkGeometry.setAttribute('aStart', start);
  linkGeometry.setAttribute('aEnd', end);
  linkGeometry.setAttribute('aProgress', progress);
  const links = new InstancedMesh(linkGeometry, createConstellationLinkMaterial(LINK_WIDTH), MAX_LINKS);
  links.name = 'ConstellationLinks';
  links.count = 0;

  for (const mesh of [links, stars]) {
    mesh.frustumCulled = false;
    mesh.raycast = noRaycast;
    mesh.renderOrder = -6;
    root.add(mesh);
  }
  links.renderOrder = -6.2;

  let count = 0;
  const target = new Float32Array(MAX_STARS);
  const shownLit = new Float32Array(MAX_STARS);
  const flashes = new Float32Array(MAX_STARS);
  const positions: number[][] = [];
  const linkProgress = new Float32Array(MAX_LINKS);
  let linkCount = 0;
  /** Seconds per link while drawing in order (0: no drawing animation). */
  let drawSpeed = 0;
  let drawing = false;

  const writeStar = (i: number) => {
    (lit.array as Float32Array)[i] = shownLit[i];
    (flash.array as Float32Array)[i] = flashes[i];
    markRange(lit, i, 1);
    markRange(flash, i, 1);
  };
  const writeLink = (i: number) => {
    (progress.array as Float32Array)[i] = linkProgress[i];
    markRange(progress, i, 1);
  };

  return {
    root,
    setStars(points) {
      count = Math.min(MAX_STARS, points.length);
      positions.length = 0;
      const o = offset.array as Float32Array;
      const s = size.array as Float32Array;
      for (let i = 0; i < MAX_STARS; i++) {
        const p = points[i];
        if (i < count && p) {
          o[i * 3] = p[0] * CONSTELLATION_SCALE;
          o[i * 3 + 1] = p[1] * CONSTELLATION_SCALE;
          o[i * 3 + 2] = p[2] * CONSTELLATION_SCALE;
          s[i] = STAR_SIZE;
          positions.push([o[i * 3], o[i * 3 + 1], o[i * 3 + 2]]);
        } else s[i] = 0;
      }
      markRange(offset, 0, MAX_STARS);
      markRange(size, 0, MAX_STARS);
    },
    setLit(index, on, instant) {
      if (index < 0 || index >= count) return;
      target[index] = on ? 1 : 0;
      if (instant || !on) {
        shownLit[index] = target[index];
        writeStar(index);
      }
    },
    flash(index) {
      if (index < 0 || index >= count) return;
      flashes[index] = 1;
      writeStar(index);
    },
    setLinks(pairs, animate) {
      linkCount = Math.min(MAX_LINKS, pairs.length);
      const a = start.array as Float32Array;
      const b = end.array as Float32Array;
      for (let i = 0; i < linkCount; i++) {
        const p = positions[pairs[i][0]];
        const q = positions[pairs[i][1]];
        if (!p || !q) continue;
        a.set(p, i * 3);
        b.set(q, i * 3);
        linkProgress[i] = animate ? 0 : 1;
        writeLink(i);
      }
      markRange(start, 0, MAX_LINKS);
      markRange(end, 0, MAX_LINKS);
      links.count = linkCount;
      drawing = animate && linkCount > 0;
      drawSpeed = animate && linkCount > 0 ? linkCount / 1.2 : 0;
    },
    update(dt, reducedMotion) {
      for (let i = 0; i < count; i++) {
        let changed = false;
        if (shownLit[i] !== target[i]) {
          // Reduced motion or not, a newly lit star fades in (no pop).
          shownLit[i] = Math.min(target[i], shownLit[i] + dt / FADE_IN);
          changed = true;
        }
        if (flashes[i] > 0) {
          flashes[i] = reducedMotion ? 0 : Math.max(0, flashes[i] - dt * FLASH_DECAY);
          changed = true;
        }
        if (changed) writeStar(i);
      }
      if (drawing) {
        // Links draw one after another, about 1.2 s in all.
        let budget = dt * drawSpeed;
        drawing = false;
        for (let i = 0; i < linkCount; i++) {
          if (linkProgress[i] >= 1) continue;
          const step = Math.min(1 - linkProgress[i], budget);
          linkProgress[i] += step;
          budget -= step;
          writeLink(i);
          if (linkProgress[i] < 1) {
            drawing = true;
            break;
          }
        }
      }
    },
    litCount() {
      let n = 0;
      for (let i = 0; i < count; i++) if (target[i] > 0) n++;
      return n;
    },
    linkCount() {
      return linkCount;
    },
    drawing() {
      return drawing;
    },
  };
}
