/*
 * Graphics quality tier (pure): which cosmos profile a page load uses, the
 * Settings label, the XR frame rate to request, and the Meta VR Glasses
 * form-factor test on an XR view's field of view.
 */

export type GraphicsTier = 'high' | 'low';

export const GRAPHICS_TIERS: readonly GraphicsTier[] = ['high', 'low'];

/** Why the running tier was chosen. */
export type GraphicsSource = 'url' | 'glasses' | 'setting' | 'default';

export interface GraphicsInput {
  /** The `quality` URL parameter (null when absent). */
  readonly param: string | null;
  /** The saved Settings choice (null: none saved or unreadable). */
  readonly saved: GraphicsTier | null;
  /** The Meta VR Glasses form factor (or the metaVRGlasses emulator device). */
  readonly glasses: boolean;
}

export interface GraphicsResolution {
  readonly tier: GraphicsTier;
  readonly source: GraphicsSource;
}

/** A stored or URL value as a tier; anything else (corrupt, empty, old) is null. */
export function parseGraphicsTier(value: unknown): GraphicsTier | null {
  return value === 'high' || value === 'low' ? value : null;
}

/**
 * ?quality=low|high wins (testers), then the glasses form factor (always
 * Low: a narrow view and a phone-class budget), then the saved Settings
 * choice, then High.
 */
export function resolveGraphics({ param, saved, glasses }: GraphicsInput): GraphicsResolution {
  const fromUrl = parseGraphicsTier(param);
  if (fromUrl) return { tier: fromUrl, source: 'url' };
  if (glasses) return { tier: 'low', source: 'glasses' };
  if (saved) return { tier: saved, source: 'setting' };
  return { tier: 'high', source: 'default' };
}

const NAMES: Record<GraphicsTier, string> = { high: 'High', low: 'Low' };

/**
 * The Settings button label. It shows the saved choice (what the button
 * toggles); "(reload)" when the running page still uses the other tier, and
 * "(auto Low)" when the URL or the glasses override the choice.
 */
export function graphicsLabel(saved: GraphicsTier, running: GraphicsResolution): string {
  const base = `Graphics: ${NAMES[saved]}`;
  if (running.tier === saved) return base;
  if (running.source === 'url' || running.source === 'glasses') return `${base} (auto ${NAMES[running.tier]})`;
  return `${base} (reload)`;
}

/** The other tier (the Settings button toggles between the two). */
export function nextGraphicsTier(tier: GraphicsTier): GraphicsTier {
  return tier === 'high' ? 'low' : 'high';
}

/**
 * The XR display rate to request: 72 Hz by default (13.9 ms a frame);
 * 90 Hz only with ?hz=90. Null when the session does not list it.
 */
export function targetFrameRate(hzParam: string | null, supported: readonly number[]): number | null {
  const wanted = hzParam === '90' ? 90 : 72;
  return supported.includes(wanted) ? wanted : null;
}

/** Below this total angle (degrees) on both axes a view is the glasses' (74° x 68°; a Quest eye is about 100° x 100°). */
const GLASSES_MAX_FOV_DEG = 85;

/**
 * Whether an XR view's frustum (tangents of its left, right, up and down
 * half-angles, all positive) is the Meta VR Glasses' narrow view: 37° left
 * and right, 25° up and 43° down.
 */
export function isGlassesView(tanLeft: number, tanRight: number, tanUp: number, tanDown: number): boolean {
  const deg = (t: number) => (Math.atan(t) * 180) / Math.PI;
  const across = deg(tanLeft) + deg(tanRight);
  const tall = deg(tanUp) + deg(tanDown);
  return across > 0 && tall > 0 && across < GLASSES_MAX_FOV_DEG && tall < GLASSES_MAX_FOV_DEG;
}
