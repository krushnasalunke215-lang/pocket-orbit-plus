import { BOARD, DESKTOP_VIEW } from '../config.js';
import type { Vec3 } from '../sim/vec.js';
import {
  quatConjugate,
  quatRotate,
  yawQuaternion,
  yawToward,
  type BoardPose,
  type Quat,
} from './board-math.js';

/**
 * A detected plane, reduced to what placement needs. The polygon lies in the
 * plane's local XZ plane (local +Y is the plane normal); `extents` is its
 * axis-aligned bounding box in those local coordinates.
 */
export interface PlaneInfo {
  readonly id: string;
  readonly label?: string;
  readonly orientation?: 'horizontal' | 'vertical';
  readonly center: Vec3;
  readonly quaternion: Quat;
  readonly extents: {
    readonly minX: number;
    readonly maxX: number;
    readonly minZ: number;
    readonly maxZ: number;
  };
}

/** Viewer pose in world meters; `forward` is the view direction. */
export interface HeadPose {
  readonly position: Vec3;
  readonly forward: Vec3;
}

export type PlacementSource = 'table-plane' | 'horizontal-plane' | 'fallback' | 'desktop';

export interface BoardPlacement {
  readonly pose: BoardPose;
  readonly source: PlacementSource;
  readonly planeId?: string;
  readonly planeLabel?: string;
}

/** A plane counts as horizontal when its normal is within this of up. */
const MAX_TILT_RAD = (25 * Math.PI) / 180;
/** Eligible plane heights relative to the eye (meters). */
const MAX_BELOW_EYE = 1.0;
const MIN_BELOW_EYE = 0.1;
const EXCLUDED_LABELS = new Set(['floor', 'ceiling']);
/**
 * A plane whose nearest point is closer than this (meters, horizontally) lies
 * under the head, as when a seated player leans over a desk. It counts as in
 * front even though the nearest point is the head's own projection.
 */
const UNDER_HEAD = 0.05;
/** The board center may sit at most this far behind the head (meters). */
const MAX_CENTER_BEHIND = 0.01;

/** Unit horizontal view direction; -Z when the head looks straight up or down. */
function flatForward(head: HeadPose): [number, number] {
  const fx = head.forward[0];
  const fz = head.forward[2];
  const len = Math.hypot(fx, fz);
  if (len < 1e-6) return [0, -1];
  return [fx / len, fz / len];
}

/** Yaw that turns board +Z from `center` toward the head (horizontally). */
function yawFacing(center: Vec3, head: HeadPose): number {
  const dx = head.position[0] - center[0];
  const dz = head.position[2] - center[2];
  if (Math.hypot(dx, dz) < 1e-6) {
    const [fx, fz] = flatForward(head);
    return yawToward(-fx, -fz);
  }
  return yawToward(dx, dz);
}

/**
 * No usable plane: float the board just ahead of the user, below eye height,
 * so play never waits for scene understanding.
 */
export function fallbackPlacement(head: HeadPose): BoardPlacement {
  const [fx, fz] = flatForward(head);
  const center: Vec3 = [
    head.position[0] + fx * BOARD.fallbackDistance,
    head.position[1] - BOARD.fallbackDrop,
    head.position[2] + fz * BOARD.fallbackDistance,
  ];
  return {
    pose: {
      center,
      quaternion: yawQuaternion(yawToward(-fx, -fz)),
      radius: BOARD.fallbackRadius,
    },
    source: 'fallback',
  };
}

/** The fixed board pose for non-immersive (desktop) play. */
export function desktopPlacement(): BoardPlacement {
  const [cx, cy, cz] = DESKTOP_VIEW.boardCenter;
  const [px, , pz] = DESKTOP_VIEW.cameraPosition;
  return {
    pose: {
      center: [cx, cy, cz],
      quaternion: yawQuaternion(yawToward(px - cx, pz - cz)),
      radius: DESKTOP_VIEW.boardRadius,
    },
    source: 'desktop',
  };
}

/** Board radius for a table whose smaller side is `minSide` meters. */
export function boardRadiusForTable(minSide: number): number {
  return Math.min(BOARD.maxRadius, Math.max(BOARD.minRadius, BOARD.tableFill * minSide));
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

interface Candidate {
  readonly plane: PlaneInfo;
  readonly isTable: boolean;
  /** Horizontal distance from the head to the plane's nearest point. */
  readonly distance: number;
  readonly area: number;
  readonly radius: number;
  /** World position of the board center on this plane. */
  readonly center: Vec3;
}

function evaluatePlane(plane: PlaneInfo, head: HeadPose): Candidate | null {
  if (plane.orientation === 'vertical') return null;
  const label = plane.label?.toLowerCase();
  if (label && EXCLUDED_LABELS.has(label)) return null;

  const normal = quatRotate(plane.quaternion, [0, 1, 0]);
  if (normal[1] < Math.cos(MAX_TILT_RAD)) return null;

  const eyeY = head.position[1];
  const top = plane.center[1];
  if (top < eyeY - MAX_BELOW_EYE || top > eyeY - MIN_BELOW_EYE) return null;

  const { minX, maxX, minZ, maxZ } = plane.extents;
  const minSide = Math.min(maxX - minX, maxZ - minZ);
  if (minSide < BOARD.minPlaneSide) return null;

  const rel = quatRotate(quatConjugate(plane.quaternion), [
    head.position[0] - plane.center[0],
    head.position[1] - plane.center[1],
    head.position[2] - plane.center[2],
  ]);
  const nearestLocal: Vec3 = [clamp(rel[0], minX, maxX), 0, clamp(rel[2], minZ, maxZ)];
  const offset = quatRotate(plane.quaternion, nearestLocal);
  const dx = plane.center[0] + offset[0] - head.position[0];
  const dz = plane.center[2] + offset[2] - head.position[2];
  const distance = Math.hypot(dx, dz);
  if (distance > BOARD.reach) return null;
  const [fx, fz] = flatForward(head);
  if (distance >= UNDER_HEAD && dx * fx + dz * fz <= 0) return null;

  // Seed the center one radius plus a gap ahead of the head, so a plane under
  // the head gets the board in front of the player rather than under the
  // chin, then shift it so the whole disc stays on the plane.
  const radius = boardRadiusForTable(minSide);
  const fLocal = quatRotate(quatConjugate(plane.quaternion), [fx, 0, fz]);
  const fLen = Math.hypot(fLocal[0], fLocal[2]) || 1;
  const ahead = radius + BOARD.headGap;
  const seedX = rel[0] + (fLocal[0] / fLen) * ahead;
  const seedZ = rel[2] + (fLocal[2] / fLen) * ahead;
  const lx = minX + radius <= maxX - radius ? clamp(seedX, minX + radius, maxX - radius) : (minX + maxX) / 2;
  const lz = minZ + radius <= maxZ - radius ? clamp(seedZ, minZ + radius, maxZ - radius) : (minZ + maxZ) / 2;
  const centerOffset = quatRotate(plane.quaternion, [lx, 0, lz]);
  const center: Vec3 = [
    plane.center[0] + centerOffset[0],
    plane.center[1] + centerOffset[1] + BOARD.lift,
    plane.center[2] + centerOffset[2],
  ];
  const centerAhead = (center[0] - head.position[0]) * fx + (center[2] - head.position[2]) * fz;
  if (centerAhead < -MAX_CENTER_BEHIND) return null;

  return {
    plane,
    isTable: label === 'table',
    distance,
    area: (maxX - minX) * (maxZ - minZ),
    radius,
    center,
  };
}

/** Table first, then nearest, then larger. Negative = a ranks first. */
function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.isTable !== b.isTable) return a.isTable ? -1 : 1;
  if (Math.abs(a.distance - b.distance) > 1e-6) return a.distance - b.distance;
  return b.area - a.area;
}

/**
 * Picks the best plane for the board: a reachable horizontal plane in front
 * of the user or under the head, preferring one labeled 'table'. The board
 * fills part of the table, sits as close as it can to one radius plus
 * BOARD.headGap ahead of the head while the whole disc stays on the plane,
 * and faces the user. Returns the fallback placement when no plane qualifies.
 */
export function chooseBoardPlacement(planes: readonly PlaneInfo[], head: HeadPose): BoardPlacement {
  let best: Candidate | null = null;
  for (const plane of planes) {
    const candidate = evaluatePlane(plane, head);
    if (candidate && (!best || compareCandidates(candidate, best) < 0)) best = candidate;
  }
  if (!best) return fallbackPlacement(head);

  const { plane, radius, center } = best;
  return {
    pose: { center, quaternion: yawQuaternion(yawFacing(center, head)), radius },
    source: best.isTable ? 'table-plane' : 'horizontal-plane',
    planeId: plane.id,
    planeLabel: plane.label,
  };
}
