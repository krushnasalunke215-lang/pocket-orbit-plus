import { BOARD, PLACE_RADIUS } from '../config.js';
import type { Vec2, Vec3 } from '../sim/vec.js';

/*
 * Tuple math between world meters and the board-normalized frame. The board
 * frame: origin at the board center, +Y up, +Z toward the player, one unit =
 * the board radius. Quaternions are [x, y, z, w].
 */

export type Quat = readonly [number, number, number, number];

/** Where the board sits in the world (meters). */
export interface BoardPose {
  readonly center: Vec3;
  readonly quaternion: Quat;
  readonly radius: number;
}

export const IDENTITY_QUAT: Quat = [0, 0, 0, 1];

export function quatConjugate(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** a * b (apply b first, then a). */
export function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Rotates v by the unit quaternion q. */
export function quatRotate(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  // t = 2 * cross(q.xyz, v); v' = v + w * t + cross(q.xyz, t)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}

/** World meters → board-normalized coordinates. */
export function worldToBoard(pose: BoardPose, p: Vec3): Vec3 {
  const local = quatRotate(quatConjugate(pose.quaternion), [
    p[0] - pose.center[0],
    p[1] - pose.center[1],
    p[2] - pose.center[2],
  ]);
  const s = 1 / pose.radius;
  return [local[0] * s, local[1] * s, local[2] * s];
}

/** Board-normalized coordinates → world meters. */
export function boardToWorld(pose: BoardPose, p: Vec3): Vec3 {
  const r = pose.radius;
  const w = quatRotate(pose.quaternion, [p[0] * r, p[1] * r, p[2] * r]);
  return [w[0] + pose.center[0], w[1] + pose.center[1], w[2] + pose.center[2]];
}

/** Pulls a board point inside radius `max`, keeping its direction. */
export function clampToDisc(p: Vec2, max: number = PLACE_RADIUS): Vec2 {
  const len = Math.hypot(p[0], p[1]);
  if (len <= max || len === 0) return [p[0], p[1]];
  const s = max / len;
  return [p[0] * s, p[1] * s];
}

/** Drops the height: the board point straight below (or above) p. */
export function projectVertical(p: Vec3): Vec2 {
  return [p[0], p[2]];
}

/**
 * Intersects the ray from `originBoard` through `throughBoard` with the
 * horizontal board plane y = height. Returns null when the ray is parallel
 * to the plane or the hit lies behind the origin. Pass `out` to reuse a
 * tuple instead of allocating one (per-frame callers).
 */
export function intersectRayWithBoardPlane(
  originBoard: Vec3,
  throughBoard: Vec3,
  height = 0,
  out?: [number, number],
): Vec2 | null {
  const dx = throughBoard[0] - originBoard[0];
  const dy = throughBoard[1] - originBoard[1];
  const dz = throughBoard[2] - originBoard[2];
  if (Math.abs(dy) < 1e-6) return null;
  const t = (height - originBoard[1]) / dy;
  if (t < 0) return null;
  const hit = out ?? [0, 0];
  hit[0] = originBoard[0] + t * dx;
  hit[1] = originBoard[2] + t * dz;
  return hit;
}

/**
 * Radius of a movable body's invisible grab collider in board units: at
 * least BOARD.minColliderRadiusM in world meters so a hand ray or pinch finds
 * it on small boards, and never below 0.16 board units.
 */
export function colliderLocalRadius(boardRadiusM: number): number {
  return Math.max(0.16, BOARD.minColliderRadiusM / boardRadiusM);
}

/** Rotation by `yaw` radians about +Y. Maps local +Z to (sin yaw, 0, cos yaw). */
export function yawQuaternion(yaw: number): Quat {
  const h = yaw / 2;
  return [0, Math.sin(h), 0, Math.cos(h)];
}

/** Yaw that turns local +Z toward the horizontal direction (dx, dz). */
export function yawToward(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

/** Shortest-arc rotation that maps unit vector a onto unit vector b. */
export function quatFromUnitVectors(a: Vec3, b: Vec3): Quat {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (dot < -1 + 1e-9) {
    // Opposite vectors: rotate 180° about any axis perpendicular to a.
    const axis: Vec3 = Math.abs(a[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
    const cx = a[1] * axis[2] - a[2] * axis[1];
    const cy = a[2] * axis[0] - a[0] * axis[2];
    const cz = a[0] * axis[1] - a[1] * axis[0];
    const len = Math.hypot(cx, cy, cz);
    return [cx / len, cy / len, cz / len, 0];
  }
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  const w = 1 + dot;
  const len = Math.hypot(x, y, z, w);
  return [x / len, y / len, z / len, w / len];
}

/**
 * Rotation whose local +Y is `up` (unit) and whose heading is `yaw` about
 * that up axis: yaw first, then tilt +Y onto `up`.
 */
export function quatFromUpAndYaw(up: Vec3, yaw: number): Quat {
  return quatMultiply(quatFromUnitVectors([0, 1, 0], up), yawQuaternion(yaw));
}

/**
 * Rotation whose local +Z points from `from` toward `to` with local +Y kept
 * as close to world up as possible (how a panel faces a viewer).
 */
export function quatLookAt(from: Vec3, to: Vec3): Quat {
  let zx = to[0] - from[0];
  let zy = to[1] - from[1];
  let zz = to[2] - from[2];
  const zl = Math.hypot(zx, zy, zz);
  if (zl < 1e-9) return IDENTITY_QUAT;
  zx /= zl;
  zy /= zl;
  zz /= zl;
  // x = normalize(cross(worldUp, z)); fall back to +X when z is vertical.
  let xx = zz;
  let xy = 0;
  let xz = -zx;
  const xl = Math.hypot(xx, xy, xz);
  if (xl < 1e-9) {
    xx = 1;
    xz = 0;
  } else {
    xx /= xl;
    xz /= xl;
  }
  // y = cross(z, x)
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  return quatFromBasis([xx, xy, xz], [yx, yy, yz], [zx, zy, zz]);
}

/** Quaternion of the rotation matrix with columns x, y, z. */
function quatFromBasis(x: Vec3, y: Vec3, z: Vec3): Quat {
  const m00 = x[0], m01 = y[0], m02 = z[0];
  const m10 = x[1], m11 = y[1], m12 = z[1];
  const m20 = x[2], m21 = y[2], m22 = z[2];
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}
