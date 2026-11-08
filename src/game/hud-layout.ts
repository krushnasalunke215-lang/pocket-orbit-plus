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

/**
 * World size of the near-rim Launch/Replay button (meters). The UIKitML root
 * is exactly this size (60 x 35 kit units at the 10 units = 1 cm scale).
 */
export const RIM_BUTTON_SIZE = { width: 0.06, height: 0.035 } as const;

/**
 * Near-rim button placement. `angleDeg` is measured in the board plane from
 * board-local +Z (the handle, toward the player); negative is the player's
 * left. `radial` is in board radii, `lift` and `maxHeadDistance` in meters.
 * Tuned with the geometry tests (reach, Meta VR Glasses view, poke and
 * sight-line separation from the handle and every level's planets). Bodies
 * must keep out of board angles [-70°, -25°] beyond radius 0.85 and
 * [-55°, -35°] beyond 0.8, which the levels' reserved sector [-60°, -15°]
 * (radius >= 0.7) mostly covers.
 */
export const RIM_BUTTON = { angleDeg: -39, radial: 1.2, lift: 0, maxHeadDistance: 0.5 } as const;

/**
 * The near-rim Launch/Replay button: beside the board's near rim on the
 * player's left (the handle sits at angle 0, level trays to the right), so a
 * fingertip reaches it without crossing the board. When that point is
 * farther than maxHeadDistance from the head (a table placed out of reach),
 * the button moves along the head-to-anchor line to exactly that distance,
 * which keeps it in line with the near-left rim. It faces the head.
 */
export function rimButtonPose(board: BoardPose, head: HeadPose): Pose {
  const a = (RIM_BUTTON.angleDeg * Math.PI) / 180;
  const r = RIM_BUTTON.radial * board.radius;
  const o = quatRotate(board.quaternion, [Math.sin(a) * r, RIM_BUTTON.lift, Math.cos(a) * r]);
  let x = board.center[0] + o[0];
  let y = board.center[1] + o[1];
  let z = board.center[2] + o[2];
  const [hx, hy, hz] = head.position;
  const d = Math.hypot(x - hx, y - hy, z - hz);
  if (d > RIM_BUTTON.maxHeadDistance) {
    const s = RIM_BUTTON.maxHeadDistance / d;
    x = hx + (x - hx) * s;
    y = hy + (y - hy) * s;
    z = hz + (z - hz) * s;
  }
  const position: Vec3 = [x, y, z];
  return { position, quaternion: quatLookAt(position, head.position) };
}

/**
 * World size of the level-select panel (meters): the UIKitML root is 46 cm
 * wide and about 27 cm tall (the Your Table button shares the header row),
 * at the 10 units = 1 cm scale (height rounded up).
 */
export const LEVEL_SELECT_SIZE = { width: 0.46, height: 0.28 } as const;
/** Distance of the level-select panel from the head (meters): a fingertip reaches it. */
export const LEVEL_SELECT_DISTANCE = 0.45;

/**
 * The level-select panel: LEVEL_SELECT_DISTANCE from the head along the line
 * from the head to the board center, facing the head. It sits where the
 * player is already looking (the board) and within poke reach; while open it
 * may cover the board.
 */
export function levelSelectPose(board: BoardPose, head: HeadPose): Pose {
  const [hx, hy, hz] = head.position;
  let dx = board.center[0] - hx;
  let dy = board.center[1] - hy;
  let dz = board.center[2] - hz;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) {
    // Head at the board center: fall back to the head's forward direction.
    [dx, dy, dz] = head.forward;
  } else {
    dx /= d;
    dy /= d;
    dz /= d;
  }
  const position: Vec3 = [
    hx + dx * LEVEL_SELECT_DISTANCE,
    hy + dy * LEVEL_SELECT_DISTANCE,
    hz + dz * LEVEL_SELECT_DISTANCE,
  ];
  return { position, quaternion: quatLookAt(position, head.position) };
}

/** World size of the Your Table panel (meters): 26 cm wide, about 33 cm tall (rounded up). */
export const SANDBOX_PANEL_SIZE = { width: 0.26, height: 0.34 } as const;
/** Gap between the HUD and the Your Table panel (meters). */
export const SANDBOX_PANEL_GAP = 0.02;

/**
 * The Your Table panel: beside the HUD beyond the far rim, on the player's
 * right (board-local +X), at the HUD's height, facing the head.
 */
export function sandboxPanelPose(board: BoardPose, head: HeadPose): Pose {
  const hud = hudPose(board, head).position;
  const side = quatRotate(board.quaternion, [HUD_SIZE.width / 2 + SANDBOX_PANEL_GAP + SANDBOX_PANEL_SIZE.width / 2, 0, 0]);
  const position: Vec3 = [hud[0] + side[0], hud[1] + side[1], hud[2] + side[2]];
  return { position, quaternion: quatLookAt(position, head.position) };
}

/**
 * World size of the ?debug=1 overlay panel (meters): the UIKitML root is
 * 22 cm wide and about 10 cm tall with the hit line wrapped (rounded up).
 */
export const DEBUG_OVERLAY_SIZE = { width: 0.22, height: 0.11 } as const;
/** Gap between the HUD and the debug overlay (meters). */
export const DEBUG_OVERLAY_GAP = 0.02;

/**
 * The ?debug=1 overlay panel: beside the HUD beyond the far rim, on the
 * player's left (board-local -X, opposite the Your Table panel), at the
 * HUD's height, facing the head.
 */
export function debugOverlayPose(board: BoardPose, head: HeadPose): Pose {
  const hud = hudPose(board, head).position;
  const side = quatRotate(board.quaternion, [-(HUD_SIZE.width / 2 + DEBUG_OVERLAY_GAP + DEBUG_OVERLAY_SIZE.width / 2), 0, 0]);
  const position: Vec3 = [hud[0] + side[0], hud[1] + side[1], hud[2] + side[2]];
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
