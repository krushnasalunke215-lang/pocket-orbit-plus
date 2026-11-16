import {
  AssetManager,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  ClampToEdgeWrapping,
  type IUniform,
  type Texture,
  type WebGLRenderer,
} from '@iwsdk/core';
import { SPACE_MAPS, SPACE_READY } from './shaders/common.js';

/*
 * Loads the vendored space textures (lazy manifest entries in src/assets.ts)
 * after the first frames, sets them up for clean minification (mipmaps,
 * trilinear, anisotropy), swaps them into the shared SPACE_MAPS uniforms
 * and eases each ready uniform from 0 to 1 over READY_SECONDS (real clock),
 * so the procedural fallback cross-fades into the photo map. A failure logs
 * one console.warn and keeps the fallback.
 */

const READY_SECONDS = 0.6;

export interface SpaceTextureStatus {
  requested: string[];
  loaded: string[];
  failed: string[];
}

export interface SpaceTextureLoader {
  /** Eases the ready uniforms (call every frame with the real frame time). */
  tick(dt: number): void;
  status(): SpaceTextureStatus;
}

interface Slot {
  id: string;
  map: IUniform<Texture>;
  ready: IUniform<number>;
  equirect: boolean;
  loaded: boolean;
}

/** Which maps a loader starts: the planet atlas alone (at startup), the other three, or all four. */
export type SpaceTextureGroup = 'atlas' | 'others' | 'all';

/**
 * Starts loading the space maps of `group` at `size` (2048: the -2k files,
 * otherwise the -1k files). Each map is uploaded to the GPU as soon as it
 * has loaded (renderer.initTexture), not on the first frame that draws it.
 */
export function loadSpaceTextures(renderer: WebGLRenderer, size: number, group: SpaceTextureGroup = 'all'): SpaceTextureLoader {
  const suffix = size >= 2048 ? '2k' : '1k';
  const all: Slot[] = [
    { id: `tex-milky-way-${suffix}`, map: SPACE_MAPS.uMilkyWay, ready: SPACE_READY.uSkyReady, equirect: true, loaded: false },
    { id: `tex-saturn-${suffix}`, map: SPACE_MAPS.uSaturn, ready: SPACE_READY.uSaturnReady, equirect: true, loaded: false },
    { id: 'tex-saturn-ring', map: SPACE_MAPS.uRing, ready: SPACE_READY.uRingReady, equirect: false, loaded: false },
    { id: `tex-planets-${suffix}`, map: SPACE_MAPS.uAtlas, ready: SPACE_READY.uAtlasReady, equirect: false, loaded: false },
  ];
  const isAtlas = (s: Slot) => s.map === SPACE_MAPS.uAtlas;
  const slots = group === 'all' ? all : all.filter((s) => isAtlas(s) === (group === 'atlas'));
  const requested = slots.map((s) => s.id);
  const loaded: string[] = [];
  const failed: string[] = [];
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  for (const slot of slots) {
    AssetManager.loadTextureById(slot.id).then(
      (texture) => {
        texture.colorSpace = SRGBColorSpace;
        texture.anisotropy = anisotropy;
        texture.generateMipmaps = true;
        texture.minFilter = LinearMipmapLinearFilter;
        texture.wrapS = slot.equirect ? RepeatWrapping : ClampToEdgeWrapping;
        texture.wrapT = ClampToEdgeWrapping;
        texture.needsUpdate = true;
        slot.map.value = texture;
        slot.loaded = true;
        loaded.push(slot.id);
      },
      (error: unknown) => {
        failed.push(slot.id);
        console.warn(`space texture ${slot.id} failed to load; keeping the procedural fallback`, error);
      },
    );
  }

  return {
    tick(dt) {
      const step = Math.max(0, dt) / READY_SECONDS;
      for (const slot of slots) {
        if (slot.loaded && slot.ready.value < 1) slot.ready.value = Math.min(1, slot.ready.value + step);
      }
    },
    status() {
      return { requested: [...requested], loaded: [...loaded], failed: [...failed] };
    },
  };
}
