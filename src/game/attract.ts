import { SIM_DT } from '../sim/constants.js';
import type { SimResult } from '../sim/simulate.js';

/*
 * The attract loop shown before the first interaction: the comet flies the
 * current level's flight at real speed (with untouched planets it always
 * misses), fades out at its end, waits, and relaunches. Pure timeline: the
 * caller owns the clock and the SimResult; nothing here touches the game.
 */

/** Seconds the comet takes to fade out at the end of the flight. */
export const ATTRACT_FADE = 0.6;
/** Seconds of empty board between the fade and the relaunch. */
export const ATTRACT_GAP = 0.8;

/** Writable xyz target (a tuple or a typed array). */
type XYZ = { [index: number]: number };

/** One attract frame: the comet board position and its opacity (0..1). */
export interface AttractFrame {
  readonly position: XYZ;
  alpha: number;
}

/** Loop length in seconds: the flight, the fade and the gap. */
export function attractPeriod(result: SimResult): number {
  return result.time + ATTRACT_FADE + ATTRACT_GAP;
}

/**
 * Writes the comet's board position `time` seconds into a recorded flight,
 * interpolating the samples (clamped to the flight's ends). A teleport
 * between two samples splits the interval: before the jump the comet moves
 * toward the entry point, after it away from the exit.
 */
export function flightPositionAt<T extends XYZ>(result: SimResult, time: number, out: T): T {
  const s = result.samples;
  const stepF = Math.max(0, time) / SIM_DT;
  const i0 = Math.floor(stepF / result.sampleEvery);
  if (i0 >= result.sampleCount - 1) {
    const k = (result.sampleCount - 1) * 3;
    out[0] = s[k];
    out[1] = s[k + 1];
    out[2] = s[k + 2];
    return out;
  }
  const k = i0 * 3;
  let fromStep = i0 * result.sampleEvery;
  let toStep = Math.min(fromStep + result.sampleEvery, result.steps);
  let ax = s[k];
  let ay = s[k + 1];
  let az = s[k + 2];
  let bx = s[k + 3];
  let by = s[k + 4];
  let bz = s[k + 5];
  const teleports = result.teleports;
  for (let j = 0; j < teleports.length; j++) {
    const tp = teleports[j];
    if (tp.step <= fromStep || tp.step > toStep) continue;
    if (stepF < tp.step) {
      bx = tp.entry[0];
      by = tp.entry[1];
      bz = tp.entry[2];
      toStep = tp.step;
    } else {
      ax = tp.exit[0];
      ay = tp.exit[1];
      az = tp.exit[2];
      fromStep = tp.step;
    }
  }
  const a = toStep > fromStep ? Math.min(1, Math.max(0, (stepF - fromStep) / (toStep - fromStep))) : 0;
  out[0] = ax + (bx - ax) * a;
  out[1] = ay + (by - ay) * a;
  out[2] = az + (bz - az) * a;
  return out;
}

/**
 * The attract loop at loop time `t` (seconds, any value; the loop repeats
 * every attractPeriod): fly the path with alpha 1, hold the end point while
 * fading out over ATTRACT_FADE, then sit at the start with alpha 0 for
 * ATTRACT_GAP. At t = 0 the comet is at its start, fully visible.
 */
export function attractFrame<T extends AttractFrame>(result: SimResult, t: number, out: T): T {
  const period = attractPeriod(result);
  let tau = t % period;
  if (tau < 0) tau += period;
  const flight = result.time;
  if (tau < flight) {
    flightPositionAt(result, tau, out.position);
    out.alpha = 1;
  } else if (tau < flight + ATTRACT_FADE) {
    flightPositionAt(result, flight, out.position);
    out.alpha = 1 - (tau - flight) / ATTRACT_FADE;
  } else {
    flightPositionAt(result, 0, out.position);
    out.alpha = 0;
  }
  return out;
}
