import { describe, expect, it } from 'vitest';
import { COSMOS_QUALITY_PROFILES } from '../config.js';
import { graphicsLabel, isGlassesView, nextGraphicsTier, parseGraphicsTier, resolveGraphics, targetFrameRate } from './quality-rules.js';

const tan = (deg: number) => Math.tan((deg * Math.PI) / 180);

describe('resolveGraphics', () => {
  it('defaults to High and follows the saved Settings choice', () => {
    expect(resolveGraphics({ param: null, saved: null, glasses: false })).toEqual({ tier: 'high', source: 'default' });
    expect(resolveGraphics({ param: null, saved: 'low', glasses: false })).toEqual({ tier: 'low', source: 'setting' });
    expect(resolveGraphics({ param: null, saved: 'high', glasses: false })).toEqual({ tier: 'high', source: 'setting' });
  });

  it('uses Low on the glasses whatever was saved', () => {
    expect(resolveGraphics({ param: null, saved: 'high', glasses: true })).toEqual({ tier: 'low', source: 'glasses' });
    expect(resolveGraphics({ param: null, saved: null, glasses: true })).toEqual({ tier: 'low', source: 'glasses' });
  });

  it('lets ?quality=low|high override everything; other values are ignored', () => {
    expect(resolveGraphics({ param: 'low', saved: 'high', glasses: false })).toEqual({ tier: 'low', source: 'url' });
    expect(resolveGraphics({ param: 'high', saved: 'low', glasses: true })).toEqual({ tier: 'high', source: 'url' });
    expect(resolveGraphics({ param: 'ultra', saved: null, glasses: false })).toEqual({ tier: 'high', source: 'default' });
  });

  it('reads only exact stored tiers (a corrupt value is no choice)', () => {
    expect(parseGraphicsTier('low')).toBe('low');
    expect(parseGraphicsTier('high')).toBe('high');
    for (const bad of ['Low', '', '{"tier":"low"}', null, undefined, 1]) expect(parseGraphicsTier(bad)).toBeNull();
  });
});

describe('graphicsLabel', () => {
  it('shows the saved choice, with (reload) until a reload applies it', () => {
    expect(graphicsLabel('high', { tier: 'high', source: 'default' })).toBe('Graphics: High');
    expect(graphicsLabel('low', { tier: 'low', source: 'setting' })).toBe('Graphics: Low');
    expect(graphicsLabel('low', { tier: 'high', source: 'default' })).toBe('Graphics: Low (reload)');
    expect(graphicsLabel('high', { tier: 'low', source: 'setting' })).toBe('Graphics: High (reload)');
  });

  it('names the override when the URL or the glasses force the other tier', () => {
    expect(graphicsLabel('high', { tier: 'low', source: 'glasses' })).toBe('Graphics: High (auto Low)');
    expect(graphicsLabel('low', { tier: 'high', source: 'url' })).toBe('Graphics: Low (auto High)');
    expect(graphicsLabel('low', { tier: 'low', source: 'glasses' })).toBe('Graphics: Low');
  });

  it('toggles between the two tiers', () => {
    expect(nextGraphicsTier('high')).toBe('low');
    expect(nextGraphicsTier('low')).toBe('high');
  });
});

describe('targetFrameRate', () => {
  it('requests 72 Hz by default and 90 Hz only with ?hz=90', () => {
    expect(targetFrameRate(null, [72, 80, 90, 120])).toBe(72);
    expect(targetFrameRate('90', [72, 80, 90, 120])).toBe(90);
    expect(targetFrameRate('120', [72, 90, 120])).toBe(72);
  });

  it('requests nothing the session does not list', () => {
    expect(targetFrameRate(null, [60, 90])).toBeNull();
    expect(targetFrameRate('90', [72])).toBeNull();
    expect(targetFrameRate(null, [])).toBeNull();
  });
});

describe('isGlassesView', () => {
  it("matches the Meta VR Glasses' view (37° left/right, 25° up, 43° down)", () => {
    expect(isGlassesView(tan(37), tan(37), tan(25), tan(43))).toBe(true);
  });

  it('does not match a Quest eye or a degenerate frustum', () => {
    // A Quest 3 eye: about 50° out, 45° in, 48° up and 52° down.
    expect(isGlassesView(tan(50), tan(45), tan(48), tan(52))).toBe(false);
    expect(isGlassesView(tan(37), tan(37), tan(48), tan(52))).toBe(false);
    expect(isGlassesView(0, 0, 0, 0)).toBe(false);
  });
});

describe('COSMOS_QUALITY_PROFILES', () => {
  it('Low is the documented cheap profile and High the full one', () => {
    expect(COSMOS_QUALITY_PROFILES.low).toMatchObject({ textureSize: 1024, starCount: 2500, glints: false, dustMotes: 0, gridSegments: 48, asteroids: 60 });
    expect(COSMOS_QUALITY_PROFILES.high).toMatchObject({ textureSize: 2048, starCount: 6000, glints: true, dustMotes: 300, gridSegments: 96, asteroids: 160 });
  });
});
