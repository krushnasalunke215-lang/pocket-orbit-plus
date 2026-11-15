import type { World } from '@iwsdk/core';
import { XR_FOVEATION } from '../config.js';

/*
 * XR display quality that IWSDK 1.1.0-rc.2 leaves at the browser defaults:
 * a moderate fixed foveation (three applies it to the XR layer at session
 * start) and the highest of 90 or 72 Hz the session lists. MSAA stays on
 * (IWSDK creates the renderer with antialias: true).
 */

export interface DisplayState {
  /** The foveation level requested (null: the renderer does not support it). */
  foveation: number | null;
  /** The frame rate requested from the current or last session (null: none requested). */
  targetFrameRate: number | null;
}

const state: DisplayState = { foveation: null, targetFrameRate: null };

/** The display settings applied so far (debug snapshot). */
export function displayState(): DisplayState {
  return { ...state };
}

interface FrameRateSession {
  supportedFrameRates?: Float32Array | number[];
  updateTargetFrameRate?: (rate: number) => Promise<void>;
}

export function installDisplayQuality(world: World): void {
  const xr = world.renderer.xr;
  try {
    xr.setFoveation(XR_FOVEATION);
    state.foveation = XR_FOVEATION;
  } catch (error) {
    console.warn('XR foveation is not available', error);
  }
  xr.addEventListener('sessionstart', () => {
    const session = xr.getSession() as (XRSession & FrameRateSession) | null;
    if (!session) return;
    try {
      xr.setFoveation(XR_FOVEATION);
    } catch {
      // Already reported at install.
    }
    const rates = session.supportedFrameRates;
    if (!rates || typeof session.updateTargetFrameRate !== 'function') return;
    const list = Array.from(rates);
    const rate = list.includes(90) ? 90 : list.includes(72) ? 72 : null;
    if (rate === null) return;
    session.updateTargetFrameRate(rate).then(
      () => {
        state.targetFrameRate = rate;
      },
      (error: unknown) => console.warn(`XR target frame rate ${rate} Hz was refused`, error),
    );
  });
}
