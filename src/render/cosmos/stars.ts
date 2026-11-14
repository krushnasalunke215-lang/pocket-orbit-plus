import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  PlaneGeometry,
  Points,
  Vector2,
} from '@iwsdk/core';
import { noRaycast } from '../shaders/common.js';
import { createSparkleMaterial, createStarPointsMaterial } from '../shaders/cosmos.js';
import { mulberry32, randomDirection } from './random.js';

/*
 * Instanced star layers in world meters around the cosmos center, one draw
 * call each: far dust (points, 11 m), twinkling mid stars (points, 9.5 m)
 * and near four-point comic sparkles (instanced billboards, 6-8 m).
 * `layers` (COSMOS_QUALITY.starLayers) drops the near, then the mid layer.
 */

const TINTS = [0xffffff, 0xffffff, 0xfff3c4, 0xcfe8ff, 0xffd1e8];

/** Point sizes are in pixels per 1000 drawing-buffer pixels of height (written before each render). */
const pixelScale = { value: 1 };
const drawingBuffer = new Vector2();

function pointLayer(name: string, count: number, radius: number, sizeMin: number, sizeMax: number, twinkle: number, seed: number): Points {
  const random = mulberry32(seed);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const tint = new Color();
  const d = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    randomDirection(random, d);
    const r = radius * (0.94 + 0.12 * random());
    positions[i * 3] = d[0] * r;
    positions[i * 3 + 1] = d[1] * r;
    positions[i * 3 + 2] = d[2] * r;
    tint.setHex(TINTS[Math.floor(random() * TINTS.length)]);
    const b = 0.45 + 0.55 * random() * random();
    colors[i * 3] = tint.r * b;
    colors[i * 3 + 1] = tint.g * b;
    colors[i * 3 + 2] = tint.b * b;
    sizes[i] = sizeMin + (sizeMax - sizeMin) * random() * random();
    phases[i] = random();
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new BufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new BufferAttribute(phases, 1));
  const points = new Points(geometry, createStarPointsMaterial(twinkle, pixelScale));
  points.name = name;
  points.frustumCulled = false;
  points.renderOrder = -9;
  points.raycast = noRaycast;
  points.onBeforeRender = (renderer) => {
    renderer.getDrawingBufferSize(drawingBuffer);
    pixelScale.value = drawingBuffer.y / 1000;
  };
  return points;
}

function sparkleLayer(count: number, seed: number): InstancedMesh {
  const random = mulberry32(seed);
  const geometry = new PlaneGeometry(2, 2);
  const offsets = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const d = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    randomDirection(random, d);
    const r = 6 + 2 * random();
    offsets[i * 3] = d[0] * r;
    offsets[i * 3 + 1] = d[1] * r;
    offsets[i * 3 + 2] = d[2] * r;
    sizes[i] = 0.035 + 0.075 * random() * random();
    phases[i] = random();
  }
  geometry.setAttribute('aOffset', new InstancedBufferAttribute(offsets, 3));
  geometry.setAttribute('aSize', new InstancedBufferAttribute(sizes, 1));
  geometry.setAttribute('aPhase', new InstancedBufferAttribute(phases, 1));
  const mesh = new InstancedMesh(geometry, createSparkleMaterial(), count);
  mesh.name = 'CosmosSparkles';
  mesh.frustumCulled = false;
  // After the planets, so their depth hides the sparkles behind them.
  mesh.renderOrder = -6.5;
  mesh.raycast = noRaycast;
  return mesh;
}

export function createStars(layers: number): Group {
  const root = new Group();
  root.name = 'CosmosStars';
  root.add(pointLayer('CosmosDust', 1800, 11, 1.3, 2.6, 0, 0x5eed));
  if (layers >= 2) root.add(pointLayer('CosmosMidStars', 600, 9.5, 2.2, 4.4, 0.65, 0x5eee));
  if (layers >= 3) root.add(sparkleLayer(120, 0x5eef));
  return root;
}
