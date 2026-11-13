import {
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  PlaneGeometry,
  type ShaderMaterial,
} from '@iwsdk/core';
import { markRange, noRaycast } from './shaders/common.js';
import { haloMaterial } from './shaders/halo.js';
import { outlineMaterial } from './shaders/outline.js';
import { pullRingMaterial } from './shaders/pull-ring.js';

/*
 * Shared instanced sprite pools, each one InstancedMesh (one draw call) that
 * the board visual parents under the board root, so slot positions are in
 * board units. Bodies, the target and the comet head allocate slots, write
 * them as they move, and free them on dispose. Free slots have size 0, which
 * the shaders collapse to nothing.
 */

const scratchColor = new Color();

export class SpritePool {
  readonly mesh: InstancedMesh;
  private readonly offset: InstancedBufferAttribute;
  private readonly size: InstancedBufferAttribute;
  private readonly color: InstancedBufferAttribute;
  private readonly alpha: InstancedBufferAttribute;
  private readonly pattern: InstancedBufferAttribute;
  private readonly freeSlots: number[] = [];

  constructor(name: string, geometry: PlaneGeometry, material: ShaderMaterial, readonly capacity: number) {
    const make = (itemSize: number) =>
      new InstancedBufferAttribute(new Float32Array(capacity * itemSize), itemSize).setUsage(DynamicDrawUsage);
    this.offset = make(3);
    this.size = make(1);
    this.color = make(3);
    this.alpha = make(1);
    this.pattern = make(1);
    geometry.setAttribute('aOffset', this.offset);
    geometry.setAttribute('aSize', this.size);
    geometry.setAttribute('aColor', this.color);
    geometry.setAttribute('aAlpha', this.alpha);
    geometry.setAttribute('aPattern', this.pattern);
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.name = name;
    // Instances move with the bodies; the mesh bounds are never valid.
    this.mesh.frustumCulled = false;
    this.mesh.raycast = noRaycast;
    for (let i = capacity - 1; i >= 0; i--) this.freeSlots.push(i);
  }

  /** Returns a slot index, or -1 when the pool is full (the sprite is then skipped). */
  allocate(colorHex: number, alpha: number, pattern = 0): number {
    const slot = this.freeSlots.pop();
    if (slot === undefined) return -1;
    this.setColor(slot, colorHex);
    this.setAlpha(slot, alpha);
    const p = this.pattern.array as Float32Array;
    p[slot] = pattern;
    markRange(this.pattern, slot, 1);
    return slot;
  }

  release(slot: number): void {
    if (slot < 0) return;
    this.setSize(slot, 0);
    this.freeSlots.push(slot);
  }

  setPosition(slot: number, x: number, y: number, z: number): void {
    if (slot < 0) return;
    const a = this.offset.array as Float32Array;
    const k = slot * 3;
    if (a[k] === x && a[k + 1] === y && a[k + 2] === z) return;
    a[k] = x;
    a[k + 1] = y;
    a[k + 2] = z;
    markRange(this.offset, slot, 1);
  }

  setSize(slot: number, size: number): void {
    if (slot < 0) return;
    const a = this.size.array as Float32Array;
    if (a[slot] === size) return;
    a[slot] = size;
    markRange(this.size, slot, 1);
  }

  setAlpha(slot: number, alpha: number): void {
    if (slot < 0) return;
    const a = this.alpha.array as Float32Array;
    if (a[slot] === alpha) return;
    a[slot] = alpha;
    markRange(this.alpha, slot, 1);
  }

  setColor(slot: number, hex: number): void {
    if (slot < 0) return;
    scratchColor.setHex(hex);
    const a = this.color.array as Float32Array;
    const k = slot * 3;
    a[k] = scratchColor.r;
    a[k + 1] = scratchColor.g;
    a[k + 2] = scratchColor.b;
    markRange(this.color, slot, 1);
  }
}

/** Fake-bloom halos (camera-facing, additive). */
export const HALOS = new SpritePool('Halos', new PlaneGeometry(2, 2), haloMaterial, 16);
HALOS.mesh.renderOrder = 3;

/** Flat influence rings on the board, one per body. */
export const PULL_RINGS = new SpritePool(
  'PullRings',
  new PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
  pullRingMaterial,
  16,
);
PULL_RINGS.mesh.renderOrder = -1;

/**
 * High-contrast outline rings around the bodies (camera-facing); the pool's
 * pattern is the inner radius fraction. Hidden (no draw call) unless high
 * contrast is on; bodies keep their slots current either way.
 */
export const OUTLINES = new SpritePool('Outlines', new PlaneGeometry(2, 2), outlineMaterial, 16);
OUTLINES.mesh.renderOrder = 3;
OUTLINES.mesh.visible = false;
