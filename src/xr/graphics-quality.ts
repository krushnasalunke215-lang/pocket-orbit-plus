import { COSMOS_QUALITY_PROFILES, type CosmosQuality } from '../config.js';
import {
  parseGraphicsTier,
  resolveGraphics,
  type GraphicsResolution,
  type GraphicsSource,
  type GraphicsTier,
} from '../game/quality-rules.js';

/*
 * The graphics tier of this page load (src/game/quality-rules.ts decides):
 * ?quality=low|high, then Low on the Meta VR Glasses (the metaVRGlasses
 * emulator device here; the real form factor is recognised in the session
 * by its narrow view, see CosmosSystem), then the Settings choice saved
 * under its own storage key (not in the game save, so the save format and
 * its corrupt-save recovery are untouched), then High. The cosmos and the
 * board plate are built once from the resolved profile, so a Settings
 * change applies on the next reload. Director mode ignores the saved
 * choice, so every take looks the same.
 */

/** Storage key of the saved Settings choice ('high' or 'low'). */
export const GRAPHICS_KEY = 'orbit-puzzle.graphics';

/** IWER's name for the metaVRGlasses emulator profile. */
const GLASSES_DEVICE_NAME = 'Meta VR Glasses';

export interface GraphicsState extends GraphicsResolution {
  /** The saved Settings choice (High when none). */
  readonly saved: GraphicsTier;
  /** The profile the cosmos and the board plate were built from (live: switched to Low in an XR session). */
  readonly profile: CosmosQuality;
}

let resolved: GraphicsResolution | null = null;
let liveSource: GraphicsSource | null = null;
let savedTier: GraphicsTier | null = null;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readSaved(): GraphicsTier | null {
  try {
    return parseGraphicsTier(storage()?.getItem(GRAPHICS_KEY) ?? null);
  } catch {
    return null;
  }
}

function emulatorIsGlasses(): boolean {
  if (typeof window === 'undefined') return false;
  const device = (window as { IWER_DEVICE?: { name?: unknown } }).IWER_DEVICE;
  return device?.name === GLASSES_DEVICE_NAME;
}

function resolveOnce(): GraphicsResolution {
  if (resolved) return resolved;
  const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
  // Director mode (?demo=1, dev builds) starts from a fresh game: no saved choice either.
  const demo = params.get('demo') === '1';
  savedTier = readSaved();
  resolved = resolveGraphics({ param: params.get('quality'), saved: demo ? null : savedTier, glasses: emulatorIsGlasses() });
  return resolved;
}

/** The cosmos and board-plate profile of this page load (resolved on first use). */
export function cosmosQuality(): CosmosQuality {
  return COSMOS_QUALITY_PROFILES[resolveOnce().tier];
}

/** The running tier, why, and the saved choice (for the Settings label and the debug snapshot). */
export function graphicsState(): GraphicsState {
  const r = resolveOnce();
  const live = liveSource !== null;
  const tier: GraphicsTier = live ? 'low' : r.tier;
  return {
    tier,
    source: liveSource ?? r.source,
    saved: savedTier ?? 'high',
    profile: live ? COSMOS_QUALITY_PROFILES.low : COSMOS_QUALITY_PROFILES[r.tier],
  };
}

/** Saves the Settings choice (it applies on the next reload); false when storage refused it. */
export function saveGraphicsTier(tier: GraphicsTier): boolean {
  resolveOnce();
  savedTier = tier;
  try {
    const store = storage();
    if (!store) return false;
    store.setItem(GRAPHICS_KEY, tier);
    return true;
  } catch {
    return false;
  }
}

/** Records that an XR session showed the glasses' view and the scene switched to Low live (CosmosSystem). */
export function markLiveGlassesLow(): void {
  liveSource = 'glasses';
}
