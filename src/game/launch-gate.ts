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
 * A release launches the comet only if it happened over the board and the
 * hand was tracked moments before; otherwise the planet snaps back. This
 * stops lost hand tracking (which also ends the pinch) from firing a launch.
 */
export function shouldLaunch({ overBoard, msSinceTracked }: ReleaseInfo): boolean {
  return overBoard && (msSinceTracked === null || msSinceTracked <= LAUNCH_TRACKING_GRACE_MS);
}
