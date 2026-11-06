import type { Vec3 } from '../sim/vec.js';
import { quatLookAt, quatRotate, type BoardPose, type Quat } from './board-math.js';
import type { HeadPose } from './placement.js';

/**
 * World size of the HUD panel (meters), used for layout checks. The UIKitML
 * root is 30 cm wide and about 21 cm tall; the height is rounded up.
 */
export const HUD_SIZE = { width: 0.3, height: 0.22 } as const;

/** Gap between the board's far rim and the HUD (meters). */
export const HUD_GAP = 0.06;
/** Height of the HUD center above the board plane (meters). */
export const HUD_LIFT = 0.15;

/** Handle offset from the board center in board-local meters, beyond the near rim. */
const HANDLE_RISE = 0.012;
const HANDLE_GAP = 0.04;

export interface Pose {
  readonly position: Vec3;
  readonly quaternion: Quat;
}

/**
 * Places the HUD just beyond the board's far rim (board local -Z, the side
 * away from the player), raised so its lower edge stays above the line of
 * sight over the far rim, and turned to face the head.
 *
 * Why not in front of the near rim: anything raised between the eyes and the
 * board hides the board, and a 30 cm panel that close cannot fit the Meta VR
 * Glasses view (37° left/right, 25° up, 43° down). Beyond the far rim the
 * board and the panel both fit, and hand rays reach the buttons.
 */
export function hudPose(board: BoardPose, head: HeadPose): Pose {
  const offset = quatRotate(board.quaternion, [0, 0, -(board.radius + HUD_GAP)]);
  const position: Vec3 = [
    board.center[0] + offset[0],
    board.center[1] + offset[1] + HUD_LIFT,
    board.center[2] + offset[2],
  ];
  return { position, quaternion: quatLookAt(position, head.position) };
}

function handleOffset(board: BoardPose): Vec3 {
  return quatRotate(board.quaternion, [0, HANDLE_RISE, board.radius + HANDLE_GAP]);
}

/**
 * The board's grab handle: just outside the near rim (toward the player),
 * opposite the HUD, aligned with the board.
 */
export function boardHandlePose(board: BoardPose): Pose {
  const o = handleOffset(board);
  return {
    position: [board.center[0] + o[0], board.center[1] + o[1], board.center[2] + o[2]],
    quaternion: board.quaternion,
  };
}

/** Inverse of boardHandlePose: the board center for a handle position. */
export function boardCenterFromHandle(board: BoardPose, handlePosition: Vec3): Vec3 {
  const o = handleOffset(board);
  return [handlePosition[0] - o[0], handlePosition[1] - o[1], handlePosition[2] - o[2]];
}
