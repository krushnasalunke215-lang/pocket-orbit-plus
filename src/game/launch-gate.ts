import { LAUNCH_TRACKING_GRACE_MS, RELEASE_RADIUS } from '../config.js';
import type { Vec3 } from '../sim/vec.js';

/** True when a raw (unclamped) board point lies over the board disc. */
export function isOverBoard(raw: Vec3): boolean {
  return Math.hypot(raw[0], raw[2]) <= RELEASE_RADIUS;
}

export interface ReleaseInfo {
  readonly overBoard: boolean;
  /**
   * Milliseconds since the holding hand's pose was last tracked, or null for
   * an input with no tracking concept (the desktop mouse).
   */
  readonly msSinceTracked: number | null;
}

/**
 * The msSinceTracked value for a release. Mouse input (not immersive) has no
 * tracking concept: null. In XR, `lastTrackedMs` is when the holding hand's
 * pose was last seen, or null when the hold never reported a hand; that
 * cannot prove tracking, so it counts as never tracked (Infinity).
 * `handPresent` is false when the holding hand is known but its input source
 * is gone on the release frame (tracking lost, which also ends the pinch):
 * that release is never fresh, whatever the last pose time (Infinity).
 */
export function trackingAge(
  immersive: boolean,
  lastTrackedMs: number | null,
  nowMs: number,
  handPresent = true,
): number | null {
  if (!immersive) return null;
  if (!handPresent) return Infinity;
  return lastTrackedMs === null ? Infinity : nowMs - lastTrackedMs;
}

/**
 * A release launches the comet only if it happened over the board and the
 * hand was tracked moments before; otherwise the planet snaps back. This
 * stops lost hand tracking (which also ends the pinch) from firing a launch.
 */
export function shouldLaunch({ overBoard, msSinceTracked }: ReleaseInfo): boolean {
  return overBoard && (msSinceTracked === null || msSinceTracked <= LAUNCH_TRACKING_GRACE_MS);
}
