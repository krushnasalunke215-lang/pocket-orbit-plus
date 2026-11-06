import { BufferAttribute, BufferGeometry, Group, Line, LineBasicMaterial } from '@iwsdk/core';
import { ROLE_COLORS } from './palette.js';
import type { TrailVisual } from './visual-types.js';

// Placeholder look (FEAT-004 swaps in instanced ribbons): one line for the
// preview arc and one for the current flight, both on preallocated buffers.
const MAX_PREVIEW_POINTS = 1024;
const MAX_FLIGHT_POINTS = 4096;

const previewMaterial = new LineBasicMaterial({
  color: ROLE_COLORS.preview,
  transparent: true,
  opacity: 0.5,
  depthWrite: false,
  toneMapped: false,
});
const flightMaterial = new LineBasicMaterial({
  color: ROLE_COLORS.cometTrail,
  transparent: true,
  opacity: 0.9,
  depthWrite: false,
  toneMapped: false,
});

function makeLine(capacity: number, material: LineBasicMaterial): { line: Line; attr: BufferAttribute } {
  const attr = new BufferAttribute(new Float32Array(capacity * 3), 3);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', attr);
  geometry.setDrawRange(0, 0);
  const line = new Line(geometry, material);
  // The buffer changes every frame, so a stale bounding sphere must not cull it.
  line.frustumCulled = false;
  line.visible = false;
  return { line, attr };
}

export function createTrailVisual(): TrailVisual {
  const root = new Group();
  root.name = 'Trails';
  const preview = makeLine(MAX_PREVIEW_POINTS, previewMaterial);
  const flight = makeLine(MAX_FLIGHT_POINTS, flightMaterial);
  root.add(preview.line, flight.line);
  let flightCount = 0;

  return {
    root,
    showPreview(samples, count) {
      const n = Math.min(count, MAX_PREVIEW_POINTS, Math.floor(samples.length / 3));
      const array = preview.attr.array as Float32Array;
      for (let i = 0; i < n * 3; i++) array[i] = samples[i];
      preview.attr.needsUpdate = true;
      preview.line.geometry.setDrawRange(0, n);
      preview.line.visible = n >= 2;
    },
    beginFlight() {
      flightCount = 0;
      flight.line.geometry.setDrawRange(0, 0);
      flight.line.visible = true;
    },
    pushPoint(p) {
      if (flightCount >= MAX_FLIGHT_POINTS) return;
      const array = flight.attr.array as Float32Array;
      const k = flightCount * 3;
      array[k] = p[0];
      array[k + 1] = p[1];
      array[k + 2] = p[2];
      flightCount++;
      flight.attr.needsUpdate = true;
      flight.line.geometry.setDrawRange(0, flightCount);
    },
    endFlight() {},
    clear() {
      flightCount = 0;
      flight.line.geometry.setDrawRange(0, 0);
      flight.line.visible = false;
      preview.line.geometry.setDrawRange(0, 0);
      preview.line.visible = false;
    },
  };
}
