// XR interaction scenarios beyond the level-1 solve: the release gate's
// snap-back, a near pinch, losing hand tracking mid-hold, the board handle,
// levels 2-3 by hand and the immersive-vr starfield fallback. Each returns
// plain data; verify-iwer.mjs turns it into checks.
import { sleep } from './cli.mjs';
import {
  bodyOf,
  dist,
  enterXR,
  exitXR,
  game,
  hoveredNames,
  letGo,
  rayDrag,
  rayGrab,
  rayMoveTo,
  round,
  snapshot,
  toWorld,
  vec,
  waitFor,
  waitNotFlying,
  xr,
} from './xr-helpers.mjs';

const DEVICE = 'hand-right';
const samePlacements = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function freshLevel(index) {
  await game('loadLevel', index);
  await sleep(300);
  const snap = snapshot();
  return { snap, body: snap.bodies.find((b) => b.movable) };
}

/** Grab planet 1 with the hand ray, carry it off the board, let go: expect a snap-back, no launch. */
export async function offBoardRelease() {
  const { snap, body } = await freshLevel(0);
  const grab = await rayGrab(DEVICE, body.world, (s) => bodyOf(s, body.id).held);
  if (!grab.held) {
    await letGo(DEVICE);
    return { held: false, hovered: grab.hovered };
  }
  // 1.6 board radii to the right of the center: well past the 1.05 release radius.
  await rayMoveTo(DEVICE, toWorld(snap.board, [1.6, 0, 0.2]), grab.distance);
  const mid = snapshot();
  const heldBoard = bodyOf(mid, body.id).board;
  await letGo(DEVICE);
  await sleep(800);
  const after = snapshot();
  const back = bodyOf(after, body.id).board;
  return {
    held: true,
    heldWhileOff: bodyOf(mid, body.id).held,
    clampedRadiusWhileHeld: round(Math.hypot(heldBoard[0], heldBoard[2])),
    attemptsBefore: snap.attempts,
    attemptsAfter: after.attempts,
    phase: after.phase,
    placementsUnchanged: samePlacements(after.placements, snap.placements),
    snapBackError: round(Math.hypot(back[0] - body.board[0], back[2] - body.board[2]), 6),
  };
}

/**
 * Near pinch: the ray origin a few centimeters from planet 1 (inside its
 * invisible collider), aimed so the ray passes beside the visible sphere.
 * Pinch, carry 8 cm toward the board center, let go: expect a launch.
 */
export async function nearPinch() {
  const { snap, body } = await freshLevel(0);
  const r = snap.board.radius;
  const p = body.world;
  const head = xr('get-transform', { device: 'headset' }).position;
  const th = [head.x - p[0], 0, head.z - p[2]];
  const thLen = Math.hypot(th[0], th[2]);
  const toHead = [th[0] / thLen, 0, th[2] / thLen];
  const side = [-toHead[2], 0, toHead[0]];
  // Ray origin 3 cm toward the head and 2 cm above the planet center.
  const hand = [p[0] + toHead[0] * 0.03, p[1] + 0.02, p[2] + toHead[2] * 0.03];
  // Aim past the planet and 6 cm to its side, so the ray passes the center
  // about 2.3 cm away: outside the visible sphere, inside the collider.
  const aim = [p[0] - toHead[0] * 0.05 + side[0] * 0.06, p[1], p[2] - toHead[2] * 0.05 + side[2] * 0.06];
  xr('set-transform', { device: DEVICE, position: vec(hand) });
  xr('look-at', { device: DEVICE, target: vec(aim) });
  await sleep(600);
  const hovered = hoveredNames();

  // Geometry of the attempt (meters): ray origin and closest ray approach to the center.
  const u = [aim[0] - hand[0], aim[1] - hand[1], aim[2] - hand[2]];
  const ul = Math.hypot(...u);
  const w = [p[0] - hand[0], p[1] - hand[1], p[2] - hand[2]];
  const cross = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]];
  const geometry = {
    handToCenterM: round(dist(hand, p)),
    rayMissM: round(Math.hypot(...cross) / ul),
    visibleRadiusM: round(0.07 * r),
    colliderRadiusM: round(Math.max(0.16, 0.035 / r) * r),
  };

  xr('set-select-value', { device: DEVICE, value: 1 });
  await sleep(600);
  const held = Boolean(bodyOf(snapshot(), body.id).held);
  if (!held) {
    await letGo(DEVICE);
    return { hovered, held, geometry };
  }
  const c = snap.board.center;
  const toCenter = [c[0] - p[0], 0, c[2] - p[2]];
  const tcLen = Math.hypot(toCenter[0], toCenter[2]);
  const carried = [hand[0] + (toCenter[0] / tcLen) * 0.08, hand[1], hand[2] + (toCenter[2] / tcLen) * 0.08];
  xr('set-transform', { device: DEVICE, position: vec(carried) });
  await sleep(800);
  const mid = snapshot();
  const movedBoard = bodyOf(mid, body.id).board;
  await letGo(DEVICE);
  await sleep(600);
  const after = snapshot();
  const placed = after.placements[body.id];
  return {
    hovered,
    held,
    geometry,
    heldWhileCarried: bodyOf(mid, body.id).held,
    movedBoardUnits: round(Math.hypot(movedBoard[0] - body.board[0], movedBoard[2] - body.board[2])),
    attemptsBefore: snap.attempts,
    attemptsAfter: after.attempts,
    committed: placed && round(placed),
  };
}

/**
 * Hand tracking lost mid-hold: grab planet 1, carry it over the board, then
 * disconnect the hand (IWER's way of losing tracking), wait, reconnect and
 * open the pinch. Records what the gate did.
 */
export async function trackingLoss() {
  const { snap, body } = await freshLevel(0);
  const grab = await rayGrab(DEVICE, body.world, (s) => bodyOf(s, body.id).held);
  if (!grab.held) {
    await letGo(DEVICE);
    return { held: false, hovered: grab.hovered };
  }
  await rayMoveTo(DEVICE, toWorld(snap.board, [0.2, 0, 0.3]), grab.distance);
  const before = snapshot();
  xr('set-connected', { device: DEVICE, connected: false });
  await sleep(600);
  const during = snapshot();
  xr('set-connected', { device: DEVICE, connected: true });
  await sleep(800);
  const reconnected = snapshot();
  xr('set-select-value', { device: DEVICE, value: 0 });
  await sleep(800);
  const after = snapshot();
  return {
    held: true,
    attemptsBefore: before.attempts,
    heldWhileDisconnected: bodyOf(during, body.id).held,
    attemptsWhileDisconnected: during.attempts,
    heldAfterReconnect: bodyOf(reconnected, body.id).held,
    attemptsAfterReconnect: reconnected.attempts,
    attemptsAfterLetGo: after.attempts,
    placementsUnchanged: samePlacements(after.placements, snap.placements),
    phase: after.phase,
  };
}

/** Grab the board handle with the hand ray and move it 10 cm to the right. */
export async function handleDrag() {
  const start = snapshot().board;
  const grab = await rayGrab(DEVICE, start.handle, (s) => s.board.handleHeld);
  if (!grab.held) {
    await letGo(DEVICE);
    return { held: false, hovered: grab.hovered, handle: round(start.handle) };
  }
  const target = [start.handle[0] + 0.1, start.handle[1], start.handle[2]];
  await rayMoveTo(DEVICE, target, grab.distance);
  const mid = snapshot();
  await letGo(DEVICE);
  await sleep(400);
  const after = snapshot().board;
  const delta = [0, 1, 2].map((i) => after.center[i] - start.center[i]);
  return {
    hovered: grab.hovered,
    held: true,
    heldWhileMoving: mid.board.handleHeld,
    releasedAfter: !after.handleHeld,
    sourceBefore: start.source,
    sourceAfter: after.source,
    centerBefore: round(start.center),
    centerAfter: round(after.center),
    delta: round(delta),
    radiusUnchanged: after.radius === start.radius,
  };
}

/** Solves levels 2 and 3 with hand-ray drags of every movable planet in turn. */
export async function solveLevelsByHand(levels) {
  const results = [];
  for (const index of [1, 2]) {
    await game('loadLevel', index);
    await sleep(300);
    const level = levels[index];
    const ids = Object.keys(level.solution);
    const drags = [];
    for (let k = 0; k < ids.length; k++) {
      await waitNotFlying().catch(() => null);
      drags.push(await rayDrag(DEVICE, ids[k], level.solution[ids[k]], { expectSolve: k === ids.length - 1 }));
    }
    const snap = snapshot();
    results.push({ level: level.id, solved: snap.solved, attempts: snap.attempts, drags });
  }
  return results;
}

/**
 * Leaves the AR session, requests the immersive-vr fallback the HUD offers
 * when AR is missing, and reads what the app shows there.
 */
export async function vrStarfield(takeScreenshot) {
  await exitXR();
  game('enterVR');
  const status = await waitFor('an active immersive-vr session', () => {
    const s = xr('status');
    return s.sessionActive ? s : null;
  }, 20_000);
  xr('set-input-mode', { mode: 'hand' });
  await sleep(3000);
  const snap = snapshot();
  xr('look-at', { device: 'headset', target: vec(snap.board.center) });
  await sleep(500);
  takeScreenshot();
  return {
    sessionMode: status.sessionMode,
    appMode: snap.session.mode,
    blendMode: snap.session.blendMode,
    starfieldVisible: snap.starfieldVisible,
    boardSource: snap.board.source,
    levelBuilt: snap.levelBuilt,
    renderer: snap.renderer,
  };
}

export { enterXR, exitXR };
