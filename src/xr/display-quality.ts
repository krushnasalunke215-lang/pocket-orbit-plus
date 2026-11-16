import type { World } from '@iwsdk/core';
import { XR_FOVEATION } from '../config.js';
import { targetFrameRate } from '../game/quality-rules.js';

/*
 * XR display quality that IWSDK 1.1.0-rc.2 leaves at the browser defaults:
 * a moderate fixed foveation (three applies it to the XR layer at session
 * start) and 72 Hz (13.9 ms a frame; Quest frame time is unmeasured, so
 * no 90 Hz by default), or 90 Hz with ?hz=90, if the session lists it.
 * MSAA stays on (IWSDK creates the renderer with antialias: true).
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
    const rate = targetFrameRate(new URLSearchParams(window.location.search).get('hz'), Array.from(rates));
    if (rate === null) return;
    session.updateTargetFrameRate(rate).then(
      () => {
        state.targetFrameRate = rate;
      },
      (error: unknown) => console.warn(`XR target frame rate ${rate} Hz was refused`, error),
    );
  });
}
