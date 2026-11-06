import { SessionMode, type World } from '@iwsdk/core';

export interface XRSupport {
  readonly ar: boolean;
  readonly vr: boolean;
}

/** Which immersive modes this browser offers (false on any error). */
export async function detectXRSupport(): Promise<XRSupport> {
  const xr = navigator.xr;
  if (!xr) return { ar: false, vr: false };
  const check = async (mode: XRSessionMode): Promise<boolean> => {
    try {
      return await xr.isSessionSupported(mode);
    } catch {
      return false;
    }
  };
  const [ar, vr] = await Promise.all([check('immersive-ar'), check('immersive-vr')]);
  return { ar, vr };
}

/**
 * Starts the configured mixed-reality session, or the VR (starfield)
 * fallback when only immersive-vr is available. Call from a user gesture.
 */
export function enterXR(world: World, support: XRSupport): void {
  if (world.session) return;
  if (support.ar) world.launchXR();
  else if (support.vr) world.launchXR({ sessionMode: SessionMode.ImmersiveVR });
}

export type SessionModeName = 'none' | 'immersive-ar' | 'immersive-vr';

/** The running session's mode; an opaque blend mode means VR. */
export function currentSessionMode(world: World): SessionModeName {
  const session = world.session;
  if (!session) return 'none';
  return session.environmentBlendMode === 'opaque' ? 'immersive-vr' : 'immersive-ar';
}
