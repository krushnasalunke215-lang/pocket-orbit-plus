// XR interaction scenarios beyond the level-1 solve: the release gate's
// snap-back, a near pinch, losing hand tracking mid-hold, the board handle,
// levels 2-3 by hand, the near-rim Launch button, hand models served from our
// origin, and the immersive-vr fallback (also from a fresh desktop page).
// Each returns plain data; verify-iwer.mjs turns it into checks.
import { sleep } from './cli.mjs';
import {
  bodyOf,
  dist,
  enterXR,
  exitXR,
  game,
  grabbedNames,
  handAtChest,
  hoveredNames,
  letGo,
  rayDrag,
  rayGrab,
  rayMoveTo,
  reloadPage,
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
  const back = bodyOf(after, body.id).board;
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
    boardAfterLetGo: round(back, 6),
    snapBackError: round(Math.hypot(back[0] - body.board[0], back[2] - body.board[2]), 6),
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
  const head = headPose();
  xr('look-at', { device: 'headset', target: vec(snap.board.center) });
  await sleep(500);
  takeScreenshot();
  return {
    sessionMode: status.sessionMode,
    appMode: snap.session.mode,
    blendMode: snap.session.blendMode,
    starfieldVisible: snap.starfieldVisible,
    boardSource: snap.board.source,
    boardCenter: round(snap.board.center),
    boardRadius: snap.board.radius,
    head,
    levelBuilt: snap.levelBuilt,
    renderer: snap.renderer,
  };
}

/** Rotates [0, 0, -1] (the view direction) by the unit quaternion q. */
function viewForward(q) {
  const { x, y, z, w } = q;
  // Third column of the rotation matrix, negated.
  return [-(2 * (x * z + w * y)), -(2 * (y * z - w * x)), -(1 - 2 * (x * x + y * y))];
}

/** Headset position and view direction (world). */
function headPose() {
  const t = xr('get-transform', { device: 'headset' });
  const p = t.position;
  return { position: round([p.x, p.y, p.z]), forward: t.orientation ? round(viewForward(t.orientation)) : null };
}

/**
 * VR from a fresh page: leave XR, reload the managed page, wait for the
 * desktop board, then request immersive-vr the way the HUD does when AR is
 * missing, and read where the board landed relative to the head.
 */
export async function vrFromFreshPage() {
  const active = xr('status').sessionActive;
  if (active) await exitXR();
  const { snapshot: desktop } = await reloadPage();
  game('enterVR');
  const status = await waitFor('an active immersive-vr session', () => {
    const s = xr('status');
    return s.sessionActive ? s : null;
  }, 20_000);
  await sleep(3000);
  const snap = snapshot();
  const head = headPose();
  const c = snap.board.center;
  const f = head.forward ?? [0, 0, -1];
  const fl = Math.hypot(f[0], f[2]) || 1;
  const ahead = ((c[0] - head.position[0]) * f[0] + (c[2] - head.position[2]) * f[2]) / fl;
  return {
    sourceBeforeVR: desktop.board.source,
    sessionMode: status.sessionMode,
    appMode: snap.session.mode,
    boardSource: snap.board.source,
    boardCenter: round(c),
    boardRadius: snap.board.radius,
    head,
    aheadM: round(ahead),
  };
}

/** One fingertip press on `target` with hand-right; returns timing against the page clock. */
function poke(target) {
  const watchBase = game('watchLaunch.start').value.base;
  const press = xr('run-sequence', {
    device: DEVICE,
    steps: [{ label: `poke ${target}`, target, press: { hold: 0.05, retract: 0.05 } }],
  }, { timeoutMs: 60_000 });
  return { watchBase, press };
}

async function pokeResult(target) {
  let { watchBase, press } = poke(target);
  // A slow headless frame can hold the touch too long to count as a click
  // (contactMs >= 800); press once more in that case.
  if ((press.presses?.[0]?.contactMs ?? 0) >= 800 && snapshot().attempts === watchBase) {
    ({ watchBase, press } = poke(target));
  }
  await sleep(300);
  const watch = game('watchLaunch.read').value;
  const step = press.steps[0];
  const contactPerf = step.startPerf + (press.presses?.[0]?.contactMs ?? 0);
  return {
    attemptsBefore: watchBase,
    launchAfterContactMs: watch?.launchedAt != null ? Math.round(watch.launchedAt - contactPerf) : null,
    launchAfterPressEndMs: watch?.launchedAt != null ? Math.round(watch.launchedAt - step.endPerf) : null,
    contactMs: press.presses?.[0]?.contactMs ?? null,
  };
}

/**
 * The near-rim Launch/Replay button at the seated table pose: reach, a
 * fingertip poke, a poke while the other hand holds planet 1 (ignored), and
 * a hand-ray pinch aimed at the button.
 */
export async function rimButton(takeScreenshot) {
  xr('set-input-mode', { mode: 'hand' });
  // Back to the verified table pose (the handle group moved the board), so
  // the button is placed for this seated head.
  game('placeBoard');
  await sleep(500);
  const { snap, body } = await freshLevel(0);
  const t = xr('get-transform', { device: 'headset' }).position;
  const head = [t.x, t.y, t.z];
  const rim = snap.rimButton;
  const targets = xr('list-targets').targets.map((x) => x.name);

  // 1. Fingertip poke.
  const pokeA = await pokeResult('rim-launch-button');
  const afterPoke = snapshot();
  const grabbedAfterPoke = grabbedNames();

  // 2. Poke while hand-left holds planet 1 by ray: no launch. Then let go off the board.
  const p = bodyOf(snapshot(), body.id).world;
  const grab = await rayGrab('hand-left', p, (s) => bodyOf(s, body.id).held);
  let whileHeld = null;
  if (grab.held) {
    const attemptsHeld = snapshot().attempts;
    const pokeB = await pokeResult('rim-launch-button');
    const during = snapshot();
    await rayMoveTo('hand-left', toWorld(snap.board, [1.6, 0, 0.2]), grab.distance);
    await letGo('hand-left');
    await sleep(600);
    const after = snapshot();
    const back = bodyOf(after, body.id).board;
    whileHeld = {
      attemptsHeld,
      attemptsDuringPoke: during.attempts,
      heldDuringPoke: bodyOf(during, body.id).held,
      launchAfterPressEndMs: pokeB.launchAfterPressEndMs,
      attemptsAfterLetGo: after.attempts,
      phaseAfterLetGo: after.phase,
      snapBackError: round(Math.hypot(back[0] - body.board[0], back[2] - body.board[2]), 6),
    };
  } else {
    await letGo('hand-left');
  }

  // 3. Hand-ray pinch aimed at the button (where it is now). A held pinch
  // (set-select-value 1, read, 0) shows what the pinch grabs; it lasts over a
  // second through the CLI round trips, too long to count as a UIKit click.
  // The click itself is a short pinch: one 0.2 s `xr select`.
  await game('loadLevel', 0);
  await sleep(300);
  const ray = snapshot().rimButton.position;
  handAtChest(DEVICE);
  xr('look-at', { device: DEVICE, target: vec(ray) });
  await sleep(600);
  const hoveredBeforePinch = hoveredNames();
  xr('set-select-value', { device: DEVICE, value: 1 });
  await sleep(400);
  const grabbedWhilePinched = grabbedNames();
  xr('set-select-value', { device: DEVICE, value: 0 });
  await sleep(600);
  const pinchBase = snapshot().attempts;
  xr('select', { device: DEVICE, duration: 0.2 });
  await sleep(800);
  const afterPinch = snapshot();
  const grabbedAfterPinch = grabbedNames();

  // Screenshot: the head looks between the button and the board center.
  const c = snap.board.center;
  xr('look-at', { device: 'headset', target: vec([(ray[0] + c[0]) / 2, (ray[1] + c[1]) / 2, (ray[2] + c[2]) / 2]) });
  handAtChest(DEVICE);
  await sleep(600);
  takeScreenshot();

  return {
    rim: { ready: rim.ready, position: round(rim.position), size: rim.size && round(rim.size), label: rim.label },
    head: round(head),
    reachM: round(dist(head, rim.position)),
    listed: targets.includes('rim-launch-button'),
    poke: {
      ...pokeA,
      attemptsAfter: afterPoke.attempts,
      phaseAfter: afterPoke.phase,
      labelAfter: afterPoke.rimButton.label,
      grabbedAfter: grabbedAfterPoke,
      handleHeldAfter: afterPoke.board.handleHeld,
    },
    heldBy: { leftGrabbed: grab.held, hovered: grab.hovered },
    whileHeld,
    rayPinch: {
      hovered: hoveredBeforePinch,
      attemptsBefore: pinchBase,
      attemptsAfter: afterPinch.attempts,
      phaseAfter: afterPinch.phase,
      grabbedWhilePinched,
      grabbedAfter: grabbedAfterPinch,
      handleHeldAfter: afterPinch.board.handleHeld,
    },
  };
}

/**
 * Resource URLs of the app frame during an immersive-ar hands session (D3).
 * Earlier groups ran controller sessions (IWER starts with controllers,
 * whose models still come from the CDN), so the page is reloaded first: a
 * fresh Resource Timing buffer and visual cache, then a session that is in
 * hand mode from its first frame.
 */
export async function handsCdn() {
  if (xr('status').sessionActive) await exitXR();
  await reloadPage();
  // IWER starts sessions with controllers unless told otherwise before the
  // session (the CLI's set-input-mode needs an active one).
  const inputModeAtStart = game('iwer.setPrimaryInputMode', 'hand').value;
  xr('enter');
  const status = await waitFor('an active XR session', () => {
    const s = xr('status');
    return s.sessionActive ? s : null;
  }, 20_000);
  xr('set-input-mode', { mode: 'hand' });
  await sleep(4000);
  const reply = game('resourceUrls');
  const urls = reply.value;
  const origin = reply.origin;
  const local = (name) => urls.filter((u) => u.endsWith(`vendor/webxr-input-profiles/generic-hand/${name}.glb`));
  const crossOrigin = urls.filter((u) => {
    if (u.startsWith('data:') || u.startsWith('blob:')) return false;
    try {
      return new URL(u).origin !== origin;
    } catch {
      return true;
    }
  });
  const snap = snapshot();
  return {
    sessionMode: status.sessionMode,
    inputModeAtStart,
    origin,
    resourceCount: urls.length,
    localRight: local('right'),
    localLeft: local('left'),
    jsdelivr: urls.filter((u) => u.includes('cdn.jsdelivr.net')),
    crossOrigin,
    handVisuals: snap.handVisuals,
  };
}

/**
 * XR visibility (F4): solve level 1 by hand ray, replay it and blur the
 * session in the same page call (window.IWER_DEVICE.updateVisibilityState),
 * then check the pause: reason, frozen flight time, suspended audio, and a
 * hand-ray grab and release over the board that must not launch (IWER
 * reports no input sources while the session is not 'visible', in which case
 * the grab simply never happens). 'visible' then resumes the flight to its end.
 */
export async function visibilityPause() {
  const { body } = await freshLevel(0);
  const levels = game('levels').value;
  xr('look-at', { device: 'headset', target: vec(snapshot().board.center) });
  const solve = await rayDrag(DEVICE, body.id, levels[0].solution[body.id]);
  const audioBefore = game('audio.state').value;

  const blur = game('iwer.setVisibility', 'visible-blurred', { launch: true }).value;
  const paused = await waitFor('the pause after blurring', () => {
    const s = snapshot();
    return s.pause.paused ? s : null;
  }, 10_000).catch(() => snapshot());
  await sleep(1000);
  const later = snapshot();
  const audioBlurred = await waitFor('a suspended audio context', () => {
    const a = game('audio.state').value;
    return a.contextState === 'suspended' ? a : null;
  }, 5000).catch(() => game('audio.state').value);

  // A hand-ray grab of planet 1, carried over the board and released.
  const p = bodyOf(snapshot(), body.id).world;
  const grab = await rayGrab(DEVICE, p, (s) => bodyOf(s, body.id).held);
  if (grab.held) await rayMoveTo(DEVICE, toWorld(paused.board, [0.1, 0, -0.2]), grab.distance);
  await letGo(DEVICE);
  await sleep(600);
  const afterInput = snapshot();

  game('iwer.setVisibility', 'visible');
  const resumed = await waitFor('the resume', () => {
    const s = snapshot();
    return s.pause.paused ? null : s;
  }, 10_000).catch(() => snapshot());
  const end = await waitNotFlying(30_000).catch(() => snapshot());
  const audioAfter = await waitFor('a running audio context', () => {
    const a = game('audio.state').value;
    return a.contextState === 'running' ? a : null;
  }, 5000).catch(() => game('audio.state').value);

  return {
    solved: solve.solved,
    blur,
    paused: { paused: paused.pause.paused, reason: paused.pause.reason, phase: paused.phase, flightTime: round(paused.flightTime, 4), visibility: paused.session.visibility },
    later: { phase: later.phase, flightTime: round(later.flightTime, 4) },
    audio: { before: audioBefore.contextState, blurred: audioBlurred.contextState, after: audioAfter.contextState, unlocked: audioAfter.unlocked },
    input: {
      hovered: grab.hovered,
      held: grab.held,
      inputStopped: !grab.held && !grab.hovered.includes(`Body ${body.id}`),
      attemptsBefore: blur.attempts,
      attemptsAfter: afterInput.attempts,
      phaseAfter: afterInput.phase,
      flightTimeAfter: round(afterInput.flightTime, 4),
      placementsUnchanged: samePlacements(afterInput.placements, paused.placements),
    },
    resumed: { paused: resumed.pause.paused, reason: resumed.pause.reason, visibility: resumed.session.visibility },
    end: { phase: end.phase, attempts: end.attempts, flightTime: round(end.flightTime, 4), flightDuration: round(end.flightDuration, 4), lastOutcome: end.lastOutcome },
  };
}

export { enterXR, exitXR };
