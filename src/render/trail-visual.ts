import { Group } from '@iwsdk/core';
import { ROLE_COLORS } from './palette.js';
import { markRange, SHARED_TIME } from './shaders/common.js';
import { createRibbon, createRibbonMaterial, type Ribbon } from './shaders/ribbon.js';
import type { TrailVisual } from './visual-types.js';

/*
 * Flight trails and the preview arc as instanced ribbons (one draw call
 * each). The flight ribbon is a ring buffer of segments that keeps the last
 * three flights: each new flight halves the older segments' alpha (1, 0.5,
 * 0.25, then hidden), and every segment fades by age to a floor over about
 * 6 s. The preview arc is a dashed white ribbon at about 50%.
 */

const FLIGHT_CAPACITY = 2048;
const PREVIEW_CAPACITY = 1024;
const FLIGHT_DECAY = 0.5;
/** Alpha below this hides a segment, so only the last three flights show. */
const MIN_FLIGHT_ALPHA = 0.2;
const PREVIEW_ALPHA = 0.5;

const flightMaterial = createRibbonMaterial({
  color: ROLE_COLORS.cometTrail,
  width: 0.024,
  fade: 6,
  floor: 0.3,
  dashed: false,
});
const previewMaterial = createRibbonMaterial({
  color: ROLE_COLORS.preview,
  width: 0.014,
  fade: 1e9,
  floor: 1,
  dashed: true,
});

function writeSegment(
  ribbon: Ribbon,
  index: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  age: number,
  alpha: number,
): void {
  const s = ribbon.start.array as Float32Array;
  const e = ribbon.end.array as Float32Array;
  const k = index * 3;
  s[k] = ax;
  s[k + 1] = ay;
  s[k + 2] = az;
  e[k] = bx;
  e[k + 1] = by;
  e[k + 2] = bz;
  (ribbon.age.array as Float32Array)[index] = age;
  (ribbon.alpha.array as Float32Array)[index] = alpha;
}

export function createTrailVisual(): TrailVisual {
  const root = new Group();
  root.name = 'Trails';
  const flight = createRibbon(FLIGHT_CAPACITY, flightMaterial);
  flight.mesh.name = 'FlightTrails';
  flight.mesh.renderOrder = 2;
  const preview = createRibbon(PREVIEW_CAPACITY, previewMaterial);
  preview.mesh.name = 'PreviewArc';
  preview.mesh.renderOrder = 2;
  root.add(flight.mesh, preview.mesh);

  let head = 0;
  let written = 0;
  const last = [0, 0, 0];
  let hasLast = false;

  return {
    root,
    showPreview(samples, count) {
      const points = Math.min(count, Math.floor(samples.length / 3));
      const wanted = Math.max(0, points - 1);
      const stride = Math.max(1, Math.ceil(wanted / PREVIEW_CAPACITY));
      const segments = Math.floor(wanted / stride);
      for (let i = 0; i < segments; i++) {
        const a = i * stride * 3;
        const b = (i + 1) * stride * 3;
        writeSegment(
          preview,
          i,
          samples[a],
          samples[a + 1],
          samples[a + 2],
          samples[b],
          samples[b + 1],
          samples[b + 2],
          i / Math.max(1, segments),
          PREVIEW_ALPHA,
        );
      }
      if (segments > 0) {
        markRange(preview.start, 0, segments);
        markRange(preview.end, 0, segments);
        markRange(preview.age, 0, segments);
        markRange(preview.alpha, 0, segments);
      }
      preview.mesh.count = segments;
    },
    beginFlight() {
      const used = Math.min(written, FLIGHT_CAPACITY);
      const alpha = flight.alpha.array as Float32Array;
      for (let i = 0; i < used; i++) {
        const next = alpha[i] * FLIGHT_DECAY;
        alpha[i] = next < MIN_FLIGHT_ALPHA ? 0 : next;
      }
      if (used > 0) markRange(flight.alpha, 0, used);
      hasLast = false;
    },
    pushPoint(p) {
      if (hasLast) {
        writeSegment(flight, head, last[0], last[1], last[2], p[0], p[1], p[2], SHARED_TIME.value, 1);
        markRange(flight.start, head, 1);
        markRange(flight.end, head, 1);
        markRange(flight.age, head, 1);
        markRange(flight.alpha, head, 1);
        head = (head + 1) % FLIGHT_CAPACITY;
        written++;
        flight.mesh.count = Math.min(written, FLIGHT_CAPACITY);
      }
      last[0] = p[0];
      last[1] = p[1];
      last[2] = p[2];
      hasLast = true;
    },
    breakLine() {
      hasLast = false;
    },
    endFlight() {
      hasLast = false;
    },
    clear() {
      head = 0;
      written = 0;
      hasLast = false;
      flight.mesh.count = 0;
      preview.mesh.count = 0;
    },
  };
}
