// XR interaction scenarios beyond the level-1 solve: the release gate's
// snap-back, a near pinch, losing hand tracking mid-hold, the board handle,
// levels 2-3 by hand, the near-rim Launch button, hand models served from our
// origin, and the immersive-vr fallback (also from a fresh desktop page).
// Each returns plain data; verify-iwer.mjs turns it into checks.
import { call, sleep } from './cli.mjs';
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
  navigateSearch,
  rayDrag,
  rayGrab,
  rayMoveTo,
  reloadPage,
  restoreEmulatorDevice,
  round,
  setEmulatorDevice,
  snapshot,
  toWorld,
  vec,
  waitFor,
  waitForEmulatorDevice,
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

/** Waits for an armed hold (hold.atFraction / hold.ghost) to pause the game. */
const waitForHold = (label) =>
  waitFor(label, () => {
    const h = game('hold.read').value;
    return h?.held ? h : null;
  }, 20_000, 200).catch(() => game('hold.read').value);

/**
 * Levels 4-6 by hand-ray drags of every movable body to its stored solution.
 * The solving flight is held about 40% in (an emulated page hide pauses the
 * game; frames keep rendering) for `takeShot(name)`, then released.
 */
export async function solveLevels456ByHand(levels, takeShot) {
  const results = [];
  for (const index of [3, 4, 5]) {
    await game('loadLevel', index);
    await sleep(300);
    const level = levels[index];
    xr('look-at', { device: 'headset', target: vec(snapshot().board.center) });
    const ids = Object.keys(level.solution);
    const drags = [];
    const began = Date.now();
    for (let k = 0; k < ids.length; k++) {
      await waitNotFlying().catch(() => null);
      const last = k === ids.length - 1;
      if (last) game('hold.atFraction', 0.4);
      const afterRelease = last
        ? async () => {
            const hold = await waitForHold('the mid-flight hold');
            await sleep(300);
            const shot = hold?.held ? takeShot(`iwer-l${index + 1}-midflight.png`) : null;
            const released = game('hold.release').value;
            return { held: Boolean(hold?.held), heldAt: hold?.heldAt ?? null, flightDuration: hold?.flightDuration ?? null, pauseReason: hold?.pause?.reason ?? null, shot, released };
          }
        : null;
      drags.push(await rayDrag(DEVICE, ids[k], level.solution[ids[k]], { expectSolve: last, afterRelease }));
    }
    const snap = snapshot();
    results.push({
      level: level.id,
      solved: snap.solved,
      attempts: snap.attempts,
      stars: snap.stars.last,
      rung: snap.stars.rung,
      wallMs: Date.now() - began,
      mid: drags.at(-1).after,
      drags,
    });
  }
  return results;
}

/** One fingertip press on a UI element; once more if a slow frame held the touch too long. */
function press(target, done) {
  const run = () => xr('run-sequence', {
    device: DEVICE,
    steps: [{ label: `press ${target}`, target, press: { hold: 0.05, retract: 0.05 } }],
  }, { timeoutMs: 60_000 });
  let result = run();
  let retried = false;
  if ((result.presses?.[0]?.contactMs ?? 0) >= 800 && !done()) {
    result = run();
    retried = true;
  }
  return { contactMs: result.presses?.[0]?.contactMs ?? null, retried };
}

/** A short hand-ray pinch (a click) aimed at a UI element's center. */
async function rayClick(elementId, device = DEVICE) {
  const point = game('uiWorldPoint', elementId).value;
  handAtChest(device);
  xr('look-at', { device, target: vec(point) });
  await sleep(500);
  const hovered = hoveredNames();
  xr('select', { device, duration: 0.2 });
  await sleep(700);
  return { point: round(point), hovered };
}

/**
 * Onboarding on a fresh save (ghost hand screenshot, held mid-carry), then
 * the level-select panel: opened by a fingertip poke on the HUD Levels
 * button, a screenshot while open, a poke on level 2 (loads it, closes),
 * then hand-ray clicks on Mute (twice) and level 3.
 */
export async function onboardingAndLevelSelect(takeShot) {
  xr('set-input-mode', { mode: 'hand' });
  game('placeBoard');
  await sleep(500);
  const seated = xr('get-transform', { device: 'headset' });
  const board = snapshot().board;
  xr('look-at', { device: 'headset', target: vec(board.center) });
  // Hands low and to the sides, pointing at the floor, out of the board's
  // picture: no hand ray may hover a planet (that would end the attract loop).
  const t = seated.position;
  for (const [device, dx] of [['hand-left', -0.3], ['hand-right', 0.3]]) {
    xr('set-transform', { device, position: { x: t.x + dx, y: t.y - 0.45, z: t.z - 0.05 } });
    xr('look-at', { device, target: { x: t.x + dx * 2, y: 0, z: t.z } });
  }
  await sleep(300);
  game('clearSave');
  game('resetOnboarding');
  await game('loadLevel', 0);
  await sleep(500);
  const fresh = snapshot();
  game('hold.ghost', 1.9, 2.7, 5.2);
  const ghostHold = await waitForHold('the ghost hand mid-carry');
  await sleep(300);
  const ghostShot = ghostHold?.held ? takeShot('iwer-ghost-hand.png') : null;
  game('hold.release');
  const ghost = {
    levelIndex: fresh.level.index,
    phase: fresh.phase,
    done: fresh.ghostHand.done,
    visible: fresh.ghostHand.visible,
    attract: fresh.attract,
    held: Boolean(ghostHold?.held),
    heldAt: ghostHold?.heldAt ?? null,
    shot: ghostShot,
  };

  // Open the panel with a fingertip on the HUD Levels button. The HUD is
  // beyond the board, out of arm's reach, so the press walks the emulated
  // head forward; sit back down afterwards (the open panel re-poses once the
  // head moved more than 25 cm) and bring the hand back to the chest, in
  // front of the panel, as a seated player would before reaching for it.
  const targets = xr('list-targets').targets.map((x) => x.name);
  const openPress = press('levels-button', () => snapshot().levelSelect.open);
  await sleep(500);
  const openedAt = snapshot().levelSelect.open;
  xr('set-transform', { device: 'headset', position: seated.position, orientation: seated.orientation });
  xr('look-at', { device: 'headset', target: vec(board.center) });
  handAtChest(DEVICE);
  await sleep(800);
  let s = snapshot();
  const head = xr('get-transform', { device: 'headset' }).position;
  const opened = {
    listed: targets.includes('levels-button'),
    contactMs: openPress.contactMs,
    open: openedAt && s.levelSelect.open,
    attractAfter: s.attract,
    position: s.levelSelect.position && round(s.levelSelect.position),
    size: s.levelSelect.size && round(s.levelSelect.size),
    reachM: s.levelSelect.position ? round(dist([head.x, head.y, head.z], s.levelSelect.position)) : null,
    shownStars: s.levelSelect.shownStars,
  };
  if (s.levelSelect.position) xr('look-at', { device: 'headset', target: vec(s.levelSelect.position) });
  await sleep(600);
  const panelShot = s.levelSelect.open ? takeShot('iwer-level-select.png') : null;

  // Poke level 2.
  const levelTargets = xr('list-targets').targets.map((x) => x.name);
  const pokeLevel = press('level-2', () => snapshot().level.index === 1);
  await sleep(600);
  s = snapshot();
  const poked = { listed: levelTargets.includes('level-2'), contactMs: pokeLevel.contactMs, retried: pokeLevel.retried, levelId: s.level.id, open: s.levelSelect.open };

  // Ray: reopen from the HUD (only if closed; the button toggles), Mute twice, then level 3.
  xr('set-transform', { device: 'headset', position: seated.position, orientation: seated.orientation });
  xr('look-at', { device: 'headset', target: vec(board.center) });
  await sleep(400);
  const reopenClick = snapshot().levelSelect.open ? null : await rayClick('levels-button');
  await sleep(400);
  const reopened = snapshot().levelSelect.open;
  // The audio settings live on the Settings page.
  await rayClick('settings-button');
  const settingsPage = snapshot().levelSelect.page;
  const mutedBefore = game('audio.state').value.muted;
  const muteClick = await rayClick('mute-button');
  const mutedAfter = game('audio.state').value.muted;
  await rayClick('mute-button');
  const mutedRestored = game('audio.state').value.muted;
  await rayClick('settings-back');
  const levelsPage = snapshot().levelSelect.page;
  const levelClick = await rayClick('level-3');
  s = snapshot();
  const ray = {
    reopened,
    reopenHovered: reopenClick?.hovered ?? null,
    pages: [settingsPage, levelsPage],
    muted: [mutedBefore, mutedAfter, mutedRestored],
    muteHovered: muteClick.hovered,
    levelHovered: levelClick.hovered,
    levelId: s.level.id,
    open: s.levelSelect.open,
  };
  return { ghost, opened, panelShot, poked, ray };
}

/** Launches the current placements and waits for the flight to end; returns the end snapshot. */
async function launchAndWait() {
  await waitNotFlying().catch(() => null);
  game('launch');
  await sleep(300);
  return waitNotFlying(30_000).catch(() => snapshot());
}

/** Waits until the armed reticle shows a hit of class `hit` (or any hit when null). */
const waitForReticle = (hit) =>
  waitFor(`a '${hit ?? 'any'}' reticle hit`, () => {
    const r = snapshot().sandbox.reticle;
    return r?.visible && (hit === null || r.hit === hit) ? r : null;
  }, 15_000, 300).catch(() => snapshot().sandbox.reticle);

/**
 * Your Table (F5) by hand: the level select's Your Table button (ray
 * click), Next target to table-2, a no-well flight, then Make well with the
 * right hand ray aimed at the cup's top: a pinch makes a 'real-object' well
 * and the next flight differs. Fallback: Make well aimed at bare table
 * inside the board gives a puck, dragged 0.3 board units by hand ray and
 * raised twice; that flight differs again. Story check (wells still set):
 * c1-l1's stored solution solves with the same pathHash as before the
 * sandbox. Then Clear wells.
 */
export async function realObjectWells({ cup, tableHead, expectedMass, takeShot }) {
  xr('set-input-mode', { mode: 'hand' });
  xr('set-transform', { device: 'headset', position: tableHead, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  await sleep(300);
  game('sandbox.clear');
  const levels = game('levels').value;

  // Story baseline: c1-l1's stored solution.
  await game('loadLevel', 0);
  await sleep(300);
  game('setPlacements', levels[0].solution);
  const storyBefore = await launchAndWait();

  // Level select -> Your Table -> Next target (table-2).
  xr('look-at', { device: 'headset', target: vec(snapshot().board.center) });
  await sleep(300);
  const openClick = await rayClick('levels-button');
  const opened = snapshot().levelSelect.open;
  const sandboxClick = await rayClick('sandbox-button');
  let s = snapshot();
  const entered = { opened, openHovered: openClick.hovered, sandboxHovered: sandboxClick.hovered, mode: s.mode, levelId: s.level.id, panelShown: s.sandbox.panel.shown };
  // The panel sits beside the HUD; look between it and the board for the clicks.
  const panelAt = s.sandbox.panel.position;
  const lookPanel = () => {
    const c = snapshot().board.center;
    xr('set-transform', { device: 'headset', position: tableHead, orientation: { x: 0, y: 0, z: 0, w: 1 } });
    if (panelAt) xr('look-at', { device: 'headset', target: vec([(panelAt[0] + c[0]) / 2, (panelAt[1] + c[1]) / 2, (panelAt[2] + c[2]) / 2]) });
  };
  lookPanel();
  await sleep(400);
  const nextClick = await rayClick('next-target');
  s = snapshot();
  const target = { levelId: s.level.id, nextHovered: nextClick.hovered };
  const plain = await launchAndWait();

  // Make well, then aim the right hand ray from the chest at the cup's top and pinch.
  const armClick = await rayClick('make-well');
  const armed = snapshot().sandbox;
  const cupTop = { x: cup.x, y: cup.y + cup.height / 2, z: cup.z };
  xr('look-at', { device: 'headset', target: cupTop });
  handAtChest(DEVICE);
  xr('look-at', { device: DEVICE, target: cupTop });
  await sleep(600);
  const reticle = await waitForReticle('object');
  xr('select', { device: DEVICE, duration: 0.2 });
  await sleep(800);
  s = snapshot();
  const well = s.sandbox.wells[0] ?? null;
  const cupWell = {
    armed: { armed: armed.armed, armHand: armed.armHand, status: armed.status, hovered: armClick.hovered },
    reticle,
    wells: s.sandbox.wells.length,
    well,
    axisDistanceM: well ? round(Math.hypot(well.world[0] - cup.x, well.world[2] - cup.z)) : null,
    expectedMass: well ? expectedMass(well.measuredHeightM) : null,
    armedAfter: s.sandbox.armed,
    status: s.sandbox.status,
  };
  await sleep(300);
  takeShot('iwer-real-object-well.png');
  const withCup = await launchAndWait();
  const notes = game('audio.expectedNotes').value;
  const cupFlight = notes[0]?.flightId ?? null;
  const wellFlybys = game('audio.events').value.filter((e) => e.flightId === cupFlight && e.kind === 'flyby' && e.source === 'real-object');

  // Fallback: Make well aimed at bare table inside the board (no object) -> a puck.
  lookPanel();
  await sleep(400);
  await rayClick('make-well');
  const board = snapshot().board;
  const bare = toWorld(board, [-0.45, 0, 0.35]);
  xr('look-at', { device: 'headset', target: vec(board.center) });
  handAtChest(DEVICE);
  xr('look-at', { device: DEVICE, target: vec(bare) });
  await sleep(600);
  const bareReticle = await waitForReticle(null);
  xr('select', { device: DEVICE, duration: 0.2 });
  await sleep(800);
  s = snapshot();
  const puck = s.sandbox.wells.find((w) => w.kind === 'puck') ?? null;
  let drag = null;
  if (puck) {
    // Hand-ray drag 0.3 board units toward the center (MoveFromTarget keeps the ray length).
    const to = [puck.position[0] + 0.3, 0, puck.position[2] - 0.05];
    const grab = await rayGrab(DEVICE, puck.world, (snap) => snap.sandbox.wells.find((w) => w.id === puck.id)?.held);
    if (grab.held) await rayMoveTo(DEVICE, toWorld(board, to), grab.distance);
    const held = snapshot().sandbox.wells.find((w) => w.id === puck.id);
    await letGo(DEVICE);
    await sleep(600);
    const after = snapshot().sandbox.wells.find((w) => w.id === puck.id);
    drag = {
      hovered: grab.hovered,
      held: grab.held,
      heldWhileMoving: held?.held ?? false,
      from: round(puck.position),
      to,
      after: after ? round(after.position) : null,
      movedBoard: after ? round(Math.hypot(after.position[0] - puck.position[0], after.position[2] - puck.position[2])) : 0,
    };
  }
  lookPanel();
  await sleep(400);
  const heightBefore = snapshot().sandbox.wells.find((w) => w.id === snapshot().sandbox.selectedId)?.heightM ?? null;
  const up1 = await rayClick('height-up');
  const up2 = await rayClick('height-up');
  s = snapshot();
  const heightAfter = s.sandbox.wells.find((w) => w.id === s.sandbox.selectedId)?.heightM ?? null;
  xr('look-at', { device: 'headset', target: vec(board.center) });
  await sleep(400);
  takeShot('iwer-puck.png');
  const withPuck = await launchAndWait();

  // Story check with the wells still set.
  const wellsBeforeExit = snapshot().sandbox.wells.length;
  game('sandbox.exit');
  await sleep(300);
  await game('loadLevel', 0);
  await sleep(300);
  game('setPlacements', levels[0].solution);
  const storyAfter = await launchAndWait();

  // Clear wells (from the sandbox panel).
  await game('sandbox.enter', 1);
  await sleep(300);
  lookPanel();
  await sleep(400);
  const clearClick = await rayClick('clear-wells');
  s = snapshot();
  const cleared = { wells: s.sandbox.wells.length, pucks: s.sandbox.pucks, activeWells: s.sandbox.activeWells, hovered: clearClick.hovered, status: s.sandbox.status };

  // Armed, the confirming pinch grabs nothing even with the ray on a planet
  // (its ray grab is off while armed): no Grabbed, no move, no launch.
  xr('look-at', { device: 'headset', target: vec(snapshot().board.center) });
  game('sandbox.arm', 'right');
  await sleep(300);
  s = snapshot();
  const planet = s.bodies.find((b) => b.movable);
  handAtChest(DEVICE);
  xr('look-at', { device: DEVICE, target: vec(planet.world) });
  await sleep(600);
  const armedHovered = hoveredNames();
  xr('set-select-value', { device: DEVICE, value: 1 });
  await sleep(500);
  const armedGrabbed = grabbedNames();
  xr('set-select-value', { device: DEVICE, value: 0 });
  await sleep(800);
  const afterArmed = snapshot();
  const armedPinch = {
    body: planet.id,
    hovered: armedHovered,
    grabbed: armedGrabbed,
    movedBoard: round(dist(planet.board, bodyOf(afterArmed, planet.id).board)),
    attempts: [s.attempts, afterArmed.attempts],
    wells: afterArmed.sandbox.wells.map((w) => w.kind),
    armedAfter: afterArmed.sandbox.armed,
  };

  // Armed, a ray pinch on a panel button only presses it: Height + raises
  // the selected puck, no well is added and the hand stays armed.
  game('sandbox.arm', 'right');
  await sleep(300);
  lookPanel();
  await sleep(400);
  s = snapshot();
  const heightBeforePanel = s.sandbox.wells.find((w) => w.id === s.sandbox.selectedId)?.heightM ?? null;
  const panelClick = await rayClick('height-up');
  s = snapshot();
  const panelPinch = {
    hovered: panelClick.hovered,
    wells: [afterArmed.sandbox.wells.length, s.sandbox.wells.length],
    heights: [heightBeforePanel, s.sandbox.wells.find((w) => w.id === s.sandbox.selectedId)?.heightM ?? null],
    armedAfter: s.sandbox.armed,
    status: s.sandbox.status,
  };
  game('sandbox.disarm');
  // The puck from the armed pinch lies over the planet; clear it (clearing
  // leaves the planets and the handle alone).
  game('sandbox.clear');
  await sleep(300);

  // Armed, a pinch at the cup's top with the HUD behind the cup places the
  // well: the ray does not see the cup, so its first virtual hit is the HUD,
  // but the hit-test point on the cup is nearer. The hand is 25 cm above the
  // board plane in front of the near rim, on the line from the HUD's Launch
  // button through the cup's top. The HUD ignores that hand's ray click
  // until its select ends, so the same pinch does not launch; the hand's
  // next ray click on Launch does.
  xr('set-transform', { device: 'headset', position: tableHead, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  xr('look-at', { device: 'headset', target: vec(snapshot().board.center) });
  await sleep(300);
  s = snapshot();
  const behindBefore = s.attempts;
  const launchAt = game('uiWorldPoint', 'launch-button').value;
  const behindAim = [launchAt[0], launchAt[1] - 0.02, launchAt[2]];
  const lowY = s.board.center[1] + 0.25;
  const along = (lowY - behindAim[1]) / (cupTop.y - behindAim[1]);
  const lowHand = [behindAim[0] + along * (cupTop.x - behindAim[0]), lowY, behindAim[2] + along * (cupTop.z - behindAim[2])];
  game('sandbox.arm', 'right');
  await sleep(300);
  xr('set-transform', { device: DEVICE, position: vec(lowHand) });
  xr('look-at', { device: DEVICE, target: cupTop });
  await sleep(600);
  const behindReticle = await waitForReticle('object');
  const behindHovered = hoveredNames();
  xr('select', { device: DEVICE, duration: 0.2 });
  await sleep(800);
  s = snapshot();
  const behindWell = s.sandbox.wells[0] ?? null;
  const behindPanel = {
    hand: round(lowHand),
    handAboveBoardM: round(lowHand[1] - s.board.center[1]),
    handOutsideRimM: round(Math.hypot(lowHand[0] - s.board.center[0], lowHand[2] - s.board.center[2]) - s.board.radius),
    aim: round(behindAim),
    hovered: behindHovered,
    reticle: behindReticle,
    wells: s.sandbox.wells.length,
    well: behindWell,
    axisDistanceM: behindWell ? round(Math.hypot(behindWell.world[0] - cup.x, behindWell.world[2] - cup.z)) : null,
    armedAfter: s.sandbox.armed,
    status: s.sandbox.status,
    attempts: [behindBefore, s.attempts],
    phase: s.phase,
    confirmPinchAfter: s.sandbox.confirmPinch,
  };
  const nextLaunch = await rayClick('launch-button');
  s = snapshot();
  behindPanel.nextClick = { hovered: nextLaunch.hovered, attempts: s.attempts, phase: s.phase };
  await waitNotFlying(30_000).catch(() => null);
  game('sandbox.clear');
  await sleep(300);

  // The same with the Your Table panel's Clear wells behind the cup: the
  // pinch places the well and does not clear it.
  xr('set-transform', { device: 'headset', position: tableHead, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  xr('look-at', { device: 'headset', target: vec(snapshot().board.center) });
  await sleep(300);
  const clearAt = game('uiWorldPoint', 'clear-wells').value;
  const clearAlong = (lowY - clearAt[1]) / (cupTop.y - clearAt[1]);
  const clearHand = [clearAt[0] + clearAlong * (cupTop.x - clearAt[0]), lowY, clearAt[2] + clearAlong * (cupTop.z - clearAt[2])];
  game('sandbox.arm', 'right');
  await sleep(300);
  xr('set-transform', { device: DEVICE, position: vec(clearHand) });
  xr('look-at', { device: DEVICE, target: cupTop });
  await sleep(600);
  const clearReticle = await waitForReticle('object');
  const clearHovered = hoveredNames();
  xr('select', { device: DEVICE, duration: 0.2 });
  await sleep(800);
  s = snapshot();
  const behindSandboxPanel = {
    hand: round(clearHand),
    aim: round(clearAt),
    hovered: clearHovered,
    reticle: clearReticle,
    wells: s.sandbox.wells.map((w) => w.kind),
    armedAfter: s.sandbox.armed,
    status: s.sandbox.status,
    confirmPinchAfter: s.sandbox.confirmPinch,
  };
  game('sandbox.clear');
  await sleep(300);

  // A fingertip poke on Make well arms the hand that poked: the left one,
  // though the right hand pinched last.
  lookPanel();
  await sleep(400);
  const pokeMakeWell = () =>
    xr('run-sequence', { device: 'hand-left', steps: [{ label: 'poke make-well', target: 'make-well', press: { hold: 0.05, retract: 0.05 } }] }, { timeoutMs: 60_000 });
  let leftPress = pokeMakeWell();
  // A slow headless frame can hold the touch too long to count as a click.
  if ((leftPress.presses?.[0]?.contactMs ?? 0) >= 800 && !snapshot().sandbox.armed) leftPress = pokeMakeWell();
  await sleep(300);
  s = snapshot();
  const pokeArm = { contactMs: leftPress.presses?.[0]?.contactMs ?? null, armed: s.sandbox.armed, armHand: s.sandbox.armHand, status: s.sandbox.status };
  game('sandbox.disarm');
  // The left hand back down and out of the picture.
  const seatedAt = xr('get-transform', { device: 'headset' }).position;
  xr('set-transform', { device: 'hand-left', position: { x: seatedAt.x - 0.3, y: seatedAt.y - 0.45, z: seatedAt.z - 0.05 } });
  xr('look-at', { device: 'hand-left', target: { x: seatedAt.x - 0.6, y: 0, z: seatedAt.z } });
  await sleep(300);

  // A late miss: armed, the reticle first sees the cup, then the ray points
  // straight up at nothing in reach (from the chest, else from above the
  // room); the pinch gives a centered puck and its own message.
  xr('set-transform', { device: 'headset', position: tableHead, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  xr('look-at', { device: 'headset', target: vec(snapshot().board.center) });
  await sleep(300);
  game('sandbox.arm', 'right');
  await sleep(300);
  const chest = handAtChest(DEVICE);
  xr('look-at', { device: DEVICE, target: cupTop });
  await sleep(600);
  const missFirstHit = await waitForReticle('object');
  const hitsBefore = snapshot().sandbox.hitLog.total;
  let missFrom = null;
  let missReticle = null;
  let missHovered = [];
  for (const from of [chest, [chest[0], chest[1] + 5, chest[2]]]) {
    xr('set-transform', { device: DEVICE, position: vec(from) });
    // A little toward the player (+Z, away from the panels), so the aim is not exactly vertical.
    xr('look-at', { device: DEVICE, target: { x: from[0], y: from[1] + 10, z: from[2] + 0.5 } });
    await sleep(800);
    missReticle = snapshot().sandbox.reticle;
    missHovered = hoveredNames();
    missFrom = round(from);
    if (!missReticle?.visible && missHovered.length === 0) break;
  }
  xr('select', { device: DEVICE, duration: 0.2 });
  await sleep(800);
  s = snapshot();
  const lateMiss = {
    firstHit: missFirstHit?.hit ?? null,
    hitsBefore,
    from: missFrom,
    reticleVisible: missReticle?.visible ?? null,
    hovered: missHovered,
    wells: s.sandbox.wells.map((w) => ({ kind: w.kind, position: round(w.position) })),
    armedAfter: s.sandbox.armed,
    status: s.sandbox.status,
  };
  game('sandbox.clear');
  await sleep(300);

  // Arming took the ray grab off the same planet and board handle, and the
  // confirm (then the disarm) gave it back: the hand ray grabs and moves each again.
  xr('set-transform', { device: 'headset', position: tableHead, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  xr('look-at', { device: 'headset', target: vec(snapshot().board.center) });
  await sleep(300);
  const regrab = { planet: await regrabPlanet(planet.id), handle: await regrabHandle() };
  // Back to the verified table pose for the next groups.
  xr('set-transform', { device: 'headset', position: tableHead, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  await sleep(300);
  game('placeBoard');
  await sleep(800);
  game('sandbox.exit');
  await sleep(300);

  return {
    entered,
    target,
    plain: { outcome: plain.lastOutcome, pathHash: plain.lastPathHash, attempts: plain.attempts },
    cupWell,
    withCup: { outcome: withCup.lastOutcome, pathHash: withCup.lastPathHash, wellFlybys: wellFlybys.map((e) => ({ bodyId: e.bodyId, source: e.source, flightTime: round(e.flightTime, 3) })), expectedWellNotes: notes.filter((n) => n.source === 'real-object') },
    fallback: { reticle: bareReticle, puck, drag, heights: [heightBefore, heightAfter], upHovered: [up1.hovered, up2.hovered] },
    withPuck: { outcome: withPuck.lastOutcome, pathHash: withPuck.lastPathHash },
    story: { wellsBeforeExit, before: { id: storyBefore.level.id, outcome: storyBefore.lastOutcome, pathHash: storyBefore.lastPathHash }, after: { id: storyAfter.level.id, mode: storyAfter.mode, outcome: storyAfter.lastOutcome, pathHash: storyAfter.lastPathHash, activeWells: storyAfter.sandbox.activeWells } },
    cleared,
    armedPinch,
    regrab,
    panelPinch,
    behindPanel,
    behindSandboxPanel,
    pokeArm,
    lateMiss,
  };
}

/** Hand-ray grab of planet `bodyId`, carried 0.15 board units; the move is read while held. */
async function regrabPlanet(bodyId) {
  const before = snapshot();
  const body = bodyOf(before, bodyId);
  const grab = await rayGrab(DEVICE, body.world, (snap) => bodyOf(snap, bodyId)?.held);
  const grabbed = grabbedNames();
  let movedBoard = 0;
  if (grab.held) {
    const sign = body.board[0] > 0 ? -1 : 1;
    await rayMoveTo(DEVICE, toWorld(before.board, [body.board[0] + sign * 0.15, 0, body.board[2]]), grab.distance);
    const mid = bodyOf(snapshot(), bodyId);
    movedBoard = round(dist(body.board, mid.board));
  }
  await letGo(DEVICE);
  await waitNotFlying(30_000).catch(() => null);
  return { body: bodyId, hovered: grab.hovered, held: grab.held, grabbed, movedBoard };
}

/** Hand-ray grab of the board handle, carried 5 cm to the right; the board move is read after the release. */
async function regrabHandle() {
  const start = snapshot().board;
  const grab = await rayGrab(DEVICE, start.handle, (snap) => snap.board.handleHeld);
  const grabbed = grabbedNames();
  if (grab.held) await rayMoveTo(DEVICE, [start.handle[0] + 0.05, start.handle[1], start.handle[2]], grab.distance);
  await letGo(DEVICE);
  await sleep(400);
  const movedM = round(dist(start.center, snapshot().board.center));
  return { hovered: grab.hovered, held: grab.held, grabbed, movedM };
}

/** Frames rendered over `ms` of the page clock (renderStats().frames between two page-clock readings). */
async function frameRate(ms) {
  const a = game('renderStats');
  await sleep(ms);
  const b = game('renderStats');
  const seconds = (b.perfNow - a.perfNow) / 1000;
  return { frames: b.value.frames - a.value.frames, seconds: round(seconds, 3), fps: round((b.value.frames - a.value.frames) / seconds, 2) };
}

/**
 * Depth occlusion cost and look: status, then XR render stats and the
 * frame rate over 5 s with occlusion on and off (the cup in view from the
 * table pose), screenshots of both when IWER provides depth frames, and
 * shader errors in the console.
 */
export async function occlusionCost({ cup, tableHead, takeShot }) {
  xr('set-transform', { device: 'headset', position: tableHead, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  await game('loadLevel', 0);
  await sleep(300);
  // Look at the cup across the board (the cup stands on the board's footprint).
  xr('look-at', { device: 'headset', target: { x: cup.x, y: cup.y, z: cup.z } });
  for (const [device, dx] of [['hand-left', -0.3], ['hand-right', 0.3]]) {
    xr('set-transform', { device, position: { x: tableHead.x + dx, y: tableHead.y - 0.45, z: tableHead.z - 0.05 } });
  }
  game('setOcclusion', true);
  game('resetRenderStats');
  await sleep(1500);
  const status = game('occlusion').value;
  const measure = async (on) => {
    game('setOcclusion', on);
    await sleep(800);
    game('resetRenderStats');
    const rate = await frameRate(5000);
    const stats = game('renderStats').value;
    return { occlusion: on, status: game('occlusion').value, ...rate, max: stats.max, last: stats.last, programs: stats.programs, depthFrames: stats.depthFrames };
  };
  const on = await measure(true);
  const shotOn = on.depthFrames > 0 ? takeShot('iwer-occlusion.png') : null;
  const off = await measure(false);
  const shotOff = on.depthFrames > 0 ? takeShot('iwer-occlusion-off.png') : null;
  game('setOcclusion', true);
  // Compile or link failures only: three also prints the driver's "Program
  // Info Log" when it holds mere warnings (ANGLE/D3D X4122 precision notes),
  // which are kept as data, not counted as errors.
  let logs = [];
  let warnings = [];
  try {
    const text = JSON.stringify(call(['browser', 'logs'], { input: { count: 200 } }));
    logs = text.match(/[^"]*(Shader Error|shader error|ERROR: 0:|VALIDATE_STATUS false)[^"]*/g) ?? [];
    warnings = text.match(/[^"]*Program Info Log[^"]*/g) ?? [];
  } catch (error) {
    logs = [`could not read logs: ${String(error?.message ?? error).slice(0, 200)}`];
  }
  return { status, on, off, shotOn, shotOff, shaderErrors: logs, shaderWarnings: warnings.map((w) => w.slice(0, 300)) };
}

/** UIKit text of one element of the panel entity (ui inspect), as a flat string. */
function inspectText(entityIndex, selector) {
  try {
    return JSON.stringify(call(['ui', 'inspect'], { input: { entityIndex, selector } }).result);
  } catch (error) {
    return `inspect failed: ${String(error?.message ?? error).slice(0, 200)}`;
  }
}

/**
 * The ?debug=1 tester overlay (F6): navigate the managed page to ?debug=1,
 * read the desktop DOM overlay, enter XR seated at the table, find the
 * overlay panel entity and read its fps and render lines; then Your Table
 * armed with the right hand ray on the cup's top for the hit line, a
 * screenshot, and back to the plain URL.
 */
export async function debugOverlay({ cup, tableHead, takeShot }) {
  if (xr('status').sessionActive) await exitXR();
  const nav = await navigateSearch('?debug=1');
  await sleep(1500);
  const desktop = game('page.debugOverlayText').value;

  await enterXR();
  // Seated at the table, then place the board there.
  xr('set-transform', { device: 'headset', position: tableHead, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  await sleep(300);
  game('placeBoard');
  await sleep(1500);
  const board = snapshot().board;
  const found = call(['ecs', 'find'], { input: { namePattern: '^debug-overlay$' } }).result.entities;
  const entity = found[0] ?? null;
  const entityIndex = entity ? (entity.entityIndex ?? entity.index) : null;
  const domInXr = game('page.debugOverlayText').value;
  const fpsText = entityIndex === null ? '' : inspectText(entityIndex, '#fps-text');
  const renderText = entityIndex === null ? '' : inspectText(entityIndex, '#render-text');

  // Your Table, armed, the right hand ray on the cup's top.
  game('sandbox.enter', 0);
  await sleep(500);
  game('sandbox.arm', 'right');
  const cupTop = { x: cup.x, y: cup.y + cup.height / 2, z: cup.z };
  handAtChest(DEVICE);
  xr('look-at', { device: DEVICE, target: cupTop });
  await sleep(2500);
  const s = snapshot();
  const hitText = entityIndex === null ? '' : inspectText(entityIndex, '#hit-text');
  // Frame the board, the HUD and the overlay on its left.
  const c = s.board.center;
  xr('look-at', { device: 'headset', target: { x: c[0] - 0.15, y: c[1] + 0.1, z: c[2] - 0.25 } });
  await sleep(1200);
  const shot = takeShot('iwer-debug-overlay.png');

  // Render budget with the overlay shown, depth occlusion on and off: the
  // busiest panel view (Your Table armed: HUD, Your Table panel, overlay,
  // reticle), then level 6 (the most bodies) during its solving flight.
  const budget = { sandboxArmed: [await budgetSample(true, 3000), await budgetSample(false, 3000)], level6Flight: [] };
  game('sandbox.disarm');
  game('sandbox.clear');
  game('sandbox.exit');
  const levels = game('levels').value;
  const last = levels.length - 1;
  await game('loadLevel', last);
  await sleep(500);
  game('setPlacements', levels[last].solution);
  for (const on of [true, false]) {
    game('launch');
    budget.level6Flight.push({ level: levels[last].id, ...(await budgetSample(on, 2500)) });
  }
  game('setOcclusion', true);
  await exitXR();
  const back = await navigateSearch('');
  const plain = game('page.debugOverlayText').value;
  return {
    search: nav.search,
    desktop,
    board: { source: board.source, center: round(board.center) },
    entity,
    entityIndex,
    domInXr,
    fpsText,
    renderText,
    hitLog: s.sandbox.hitLog,
    reticle: s.sandbox.reticle,
    hitText,
    shot,
    budget,
    searchAfter: back.search,
    plain,
  };
}

/**
 * XR render counts with the level select open over the busiest views, on
 * the current page URL (the group runs it plain and with ?debug=1): level 1
 * on a fresh save with the ghost hand, level 6 placing, the chapter-complete
 * moment and Your Table armed. Seated at the table, the clicking hand left
 * at the chest (in view, as after a real click), occlusion on and off.
 * clearSave keeps the running game's stars, so the solved levels' star pips
 * stay shown (the costliest case).
 */
export async function levelSelectBudget({ tableHead, takeShot, shotName }) {
  if (xr('status').sessionActive) await exitXR();
  await enterXR();
  const seat = async () => {
    xr('set-transform', { device: 'headset', position: tableHead, orientation: { x: 0, y: 0, z: 0, w: 1 } });
    await sleep(300);
    xr('look-at', { device: 'headset', target: vec(snapshot().board.center) });
    await sleep(300);
  };
  xr('set-transform', { device: 'headset', position: tableHead, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  await sleep(300);
  game('placeBoard');
  await sleep(1500);
  await seat();
  const levels = game('levels').value;
  const last = levels.length - 1;
  const views = [];
  const openLevels = async (device = DEVICE) => {
    if (!snapshot().levelSelect.open) await rayClick('levels-button', device);
    await waitFor('the level select open', () => snapshot().levelSelect.open, 10_000, 300).catch(() => null);
    await sleep(800);
  };
  const closeLevels = async (device = DEVICE) => {
    if (snapshot().levelSelect.open) await rayClick('close-levels', device);
    await sleep(400);
  };
  const sampleView = async (view) => {
    const s = snapshot();
    const state = {
      open: s.levelSelect.open,
      level: s.level.id,
      mode: s.mode,
      ghostHand: s.ghostHand.visible,
      chapter: s.chapterComplete.shown,
      armed: s.sandbox.armed,
      shownStars: s.levelSelect.shownStars,
    };
    views.push({ view, ...state, on: await budgetSample(true, 2500), off: await budgetSample(false, 2500) });
  };

  // 1. A fresh save on level 1: the ghost hand runs until the first grab.
  game('clearSave');
  game('resetOnboarding');
  await game('loadLevel', 0);
  await sleep(500);
  await openLevels();
  await sampleView('level 1, ghost hand');
  await closeLevels();

  // 2. Level 6 placing (the most bodies).
  await game('loadLevel', last);
  await sleep(500);
  await openLevels();
  await sampleView('level 6 placing');
  await closeLevels();

  // 3. The chapter-complete moment: solve level 6, then Next.
  game('setPlacements', levels[last].solution);
  game('launch');
  await waitFor('level 6 solved', () => snapshot().solved, 90_000, 500);
  await seat();
  await rayClick('next-button');
  await waitFor('the chapter moment', () => snapshot().chapterComplete.shown, 10_000, 300).catch(() => null);
  await sleep(1500);
  await openLevels();
  await sampleView('chapter complete');
  const shot = shotName ? takeShot(shotName) : null;
  await closeLevels();

  // 4. Your Table armed with the right hand; the left hand opens the level
  // select, so no confirming pinch can end the arming.
  game('sandbox.enter', 0);
  await sleep(500);
  await seat();
  game('sandbox.arm', 'right');
  await sleep(300);
  await openLevels('hand-left');
  await sampleView('Your Table armed');
  await closeLevels('hand-left');
  game('sandbox.disarm');
  game('sandbox.clear');
  game('sandbox.exit');
  game('setOcclusion', true);
  await exitXR();
  return { views, shot };
}

/** Settings back to the defaults (the save keeps them, so later groups would inherit them). */
export const DEFAULT_TEST_SETTINGS = {
  muted: false,
  volume: 0.8,
  quiet: false,
  leftHanded: false,
  highContrast: false,
  reducedMotion: false,
  boardSize: 'medium',
  roomView: 'mixed',
};

/**
 * Accessibility settings in XR, seated at the table with hands: the level
 * select opened by a hand-ray click on the HUD Levels button, the Settings
 * page and Left-handed by fingertip pokes, High contrast, Reduced motion,
 * Board and the audio buttons by hand ray. Then one screenshot of each mode
 * on its own (set through the debug API): the left ghost hand mid-carry,
 * high contrast off and on over level 6, the board at small, medium and
 * large, and reduced motion's static trail and still chapter moment, with
 * render counts in the high-contrast view. Settings return to the defaults
 * at the end.
 */
export async function accessibilitySettings({ tableHead, takeShot }) {
  if (xr('status').sessionActive) await exitXR();
  await enterXR();
  const seat = async () => {
    xr('set-transform', { device: 'headset', position: tableHead, orientation: { x: 0, y: 0, z: 0, w: 1 } });
    await sleep(300);
    xr('look-at', { device: 'headset', target: vec(snapshot().board.center) });
    await sleep(300);
  };
  const handsDown = () => {
    for (const [device, dx] of [['hand-left', -0.3], ['hand-right', 0.3]]) {
      xr('set-transform', { device, position: { x: tableHead.x + dx, y: tableHead.y - 0.45, z: tableHead.z - 0.05 } });
      xr('look-at', { device, target: { x: tableHead.x + dx * 2, y: 0, z: tableHead.z } });
    }
  };
  const lookAtPanel = async () => {
    const p = snapshot().levelSelect.position;
    if (p) xr('look-at', { device: 'headset', target: vec(p) });
    await sleep(600);
  };
  const settings = () => snapshot().accessibility.settings;
  game('audio.setSettings', DEFAULT_TEST_SETTINGS);
  xr('set-transform', { device: 'headset', position: tableHead, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  await sleep(300);
  game('placeBoard');
  await sleep(1500);
  await game('loadLevel', 1);
  await sleep(500);
  await seat();

  // 1. Real input: open by ray, Settings by poke, then every setting.
  const openClick = await rayClick('levels-button');
  await waitFor('the level select open', () => snapshot().levelSelect.open, 10_000, 300).catch(() => null);
  await sleep(600);
  handAtChest(DEVICE);
  await sleep(300);
  const settingsPress = press('settings-button', () => snapshot().levelSelect.page === 'settings');
  await sleep(600);
  await seat();
  handAtChest(DEVICE);
  await sleep(400);
  const page = snapshot().levelSelect.page;
  const panel = { position: snapshot().levelSelect.position, size: snapshot().levelSelect.size };
  await lookAtPanel();
  const panelShot = page === 'settings' ? takeShot('iwer-settings.png') : null;
  await seat();
  const leftPress = press('left-handed-button', () => settings().leftHanded);
  await sleep(500);
  await seat();
  const radiusBefore = snapshot().board.radius;
  const rays = {};
  for (const id of ['contrast-button', 'motion-button', 'board-size-button', 'mute-button', 'volume-up']) {
    rays[id] = (await rayClick(id)).hovered;
  }
  let s = snapshot();
  const clicked = {
    page,
    openHovered: openClick.hovered,
    settingsContactMs: settingsPress.contactMs,
    leftContactMs: leftPress.contactMs,
    settings: s.accessibility.settings,
    ghostHandLeft: s.accessibility.ghostHandLeft,
    highContrast: s.accessibility.highContrast,
    outlinesVisible: s.accessibility.outlinesVisible,
    trailFade: s.accessibility.trailFade,
    radius: [round(radiusBefore), round(s.board.radius)],
    muted: game('audio.state').value.muted,
    rays,
  };
  await lookAtPanel();
  const audioShot = takeShot('iwer-a11y-audio.png');
  await seat();
  await rayClick('settings-back');
  const backPage = snapshot().levelSelect.page;
  await rayClick('close-levels');
  await sleep(400);
  const closed = !snapshot().levelSelect.open;

  // 2. Left-handed alone: the ghost hand mid-carry.
  game('audio.setSettings', { ...DEFAULT_TEST_SETTINGS, leftHanded: true });
  game('resetOnboarding');
  await game('loadLevel', 0);
  await sleep(500);
  handsDown();
  await seat();
  game('hold.ghost', 1.9, 2.7, 5.2);
  const ghostHold = await waitForHold('the left ghost hand mid-carry');
  await sleep(300);
  const left = { held: Boolean(ghostHold?.held), ghostHandLeft: snapshot().accessibility.ghostHandLeft, visible: snapshot().ghostHand.visible };
  const leftShot = ghostHold?.held ? takeShot('iwer-a11y-left-handed.png') : null;
  game('hold.release');
  await sleep(500);

  // 3. High contrast alone over level 6, off then on, with XR render counts.
  game('audio.setSettings', { ...DEFAULT_TEST_SETTINGS });
  await game('loadLevel', 5);
  await sleep(600);
  await seat();
  const contrastOffShot = takeShot('iwer-a11y-contrast-off.png');
  const offStats = await budgetSample(true, 2000);
  game('audio.setSettings', { ...DEFAULT_TEST_SETTINGS, highContrast: true });
  await sleep(600);
  const contrastShot = takeShot('iwer-a11y-high-contrast.png');
  const onStats = await budgetSample(true, 2000);
  s = snapshot();
  const contrast = { highContrast: s.accessibility.highContrast, outlinesVisible: s.accessibility.outlinesVisible, targetOutlineVisible: s.accessibility.targetOutlineVisible, off: offStats.max, on: onStats.max, frames: [offStats.frames, onStats.frames] };

  // 4. Board sizes on level 2, on the table plane.
  await game('loadLevel', 1);
  const sizes = [];
  for (const size of ['small', 'medium', 'large']) {
    game('audio.setSettings', { ...DEFAULT_TEST_SETTINGS, boardSize: size });
    await sleep(700);
    await seat();
    const b = snapshot().board;
    sizes.push({ size, radius: round(b.radius), source: b.source, center: round(b.center), shot: takeShot(`iwer-a11y-board-${size}.png`) });
  }

  // 5. Reduced motion alone: the decorative clock stands still, the level 6
  // solve leaves a static trail, and the chapter moment has no burst.
  game('audio.setSettings', { ...DEFAULT_TEST_SETTINGS, reducedMotion: true });
  await game('loadLevel', 5);
  await sleep(600);
  await seat();
  const m0 = snapshot().accessibility;
  await sleep(1000);
  const m1 = snapshot().accessibility;
  const levels = game('levels').value;
  game('setPlacements', levels[5].solution);
  game('launch');
  await waitFor('level 6 solved', () => snapshot().solved, 90_000, 500);
  await sleep(300);
  const trailFade = snapshot().accessibility.trailFade;
  const trailShot = takeShot('iwer-a11y-reduced-motion-trail.png');
  await rayClick('next-button');
  await waitFor('the chapter moment', () => snapshot().chapterComplete.shown, 10_000, 300).catch(() => null);
  await sleep(300);
  const c0 = snapshot().chapterComplete;
  await sleep(1200);
  const c1 = snapshot().chapterComplete;
  await seat();
  const chapterShot = c1.shown ? takeShot('iwer-a11y-reduced-motion-chapter.png') : null;
  const motion = {
    still: { motionTime: [m0.motionTime, m1.motionTime], targetStarYaw: [m0.targetStarYaw, m1.targetStarYaw], bodyYaw: [m0.bodyYaw, m1.bodyYaw] },
    trailFade,
    chapter: [c0, c1].map((c) => ({ shown: c.shown, starHeight: round(c.starHeight), starSpin: c.starSpin })),
  };

  // Back to the defaults and level 1, out of the chapter moment.
  game('audio.setSettings', DEFAULT_TEST_SETTINGS);
  await game('loadLevel', 0);
  await sleep(700);
  const restored = { settings: settings(), radius: round(snapshot().board.radius), chapter: snapshot().chapterComplete.shown };
  await exitXR();
  return {
    panel,
    clicked,
    backPage,
    closed,
    left,
    contrast,
    sizes,
    motion,
    restored,
    shots: { panelShot, audioShot, leftShot, contrastOffShot, contrastShot, trailShot, chapterShot },
  };
}

/** The Meta VR Glasses view from the view axis (degrees), and the margin every checked point keeps inside it. */
export const GLASSES_VIEW = { side: 37, up: 25, down: 43, marginDeg: 1 };

/** Angles (degrees) of world point p from the view axis of headset transform t: horizontal (+ right) and vertical (+ up). */
function viewAngles(t, p) {
  const { x, y, z, w } = t.orientation;
  const d = [p[0] - t.position.x, p[1] - t.position.y, p[2] - t.position.z];
  // Rotate d by the conjugate of the head orientation (world to head frame).
  const qx = -x, qy = -y, qz = -z;
  const tx = 2 * (qy * d[2] - qz * d[1]);
  const ty = 2 * (qz * d[0] - qx * d[2]);
  const tz = 2 * (qx * d[1] - qy * d[0]);
  const lx = d[0] + w * tx + (qy * tz - qz * ty);
  const ly = d[1] + w * ty + (qz * tx - qx * tz);
  const lz = d[2] + w * tz + (qx * ty - qy * tx);
  const DEG = 180 / Math.PI;
  return { h: Math.atan2(lx, -lz) * DEG, v: Math.atan2(ly, -lz) * DEG };
}

/** Horizontal and vertical angle ranges of `points` and the smallest margin to the glasses' view edges. */
function fitOf(t, points) {
  const a = points.map((p) => viewAngles(t, p));
  const hs = a.map((x) => x.h);
  const vs = a.map((x) => x.v);
  const margin = Math.min(...a.map(({ h, v }) => Math.min(GLASSES_VIEW.side - Math.abs(h), GLASSES_VIEW.up - v, v + GLASSES_VIEW.down)));
  return {
    points: points.length,
    h: [round(Math.min(...hs), 1), round(Math.max(...hs), 1)],
    v: [round(Math.min(...vs), 1), round(Math.max(...vs), 1)],
    marginDeg: round(margin, 1),
    fits: margin >= GLASSES_VIEW.marginDeg,
  };
}

/**
 * Glasses view angles of every surface shown now, from the current headset
 * pose: the board (16 rim points), and the corners of the HUD, the near-rim
 * button, the level select (or its Settings page) and the Your Table panel.
 */
function measureFit(label) {
  const head = xr('get-transform', { device: 'headset' });
  const snap = snapshot();
  const panels = game('panelCorners').value;
  const rim = Array.from({ length: 16 }, (_, k) => toWorld(snap.board, [Math.cos((2 * Math.PI * k) / 16), 0, Math.sin((2 * Math.PI * k) / 16)]));
  const surfaces = { board: fitOf(head, rim) };
  const names = { hud: 'hud', rimButton: 'rimButton', levelSelect: snap.levelSelect.page === 'settings' ? 'settings' : 'levelSelect', sandboxPanel: 'yourTable' };
  for (const [key, name] of Object.entries(names)) {
    if (panels[key]?.shown) surfaces[name] = fitOf(head, panels[key].corners);
  }
  return {
    label,
    head: { position: round([head.position.x, head.position.y, head.position.z], 3), orientation: round([head.orientation.x, head.orientation.y, head.orientation.z, head.orientation.w], 3) },
    boardSource: snap.board.source,
    boardRadius: round(snap.board.radius),
    surfaces,
  };
}

/**
 * One gaze-plus-pinch press: the gaze aims at the element's center, the
 * hovered entities are read, then `hand` pinches (a default-length select,
 * a click). `done(snapshot)` judges the effect; returns the evidence.
 */
async function gazePress(elementId, done, hand = DEVICE) {
  const point = game('uiWorldPoint', elementId).value;
  if (!point) return { id: elementId, hand, point: null, hovered: [], ok: false };
  xr('look-at', { device: 'gaze', target: vec(point) });
  await sleep(500);
  const hovered = hoveredNames();
  xr('select', { device: hand });
  await sleep(700);
  let s = snapshot();
  let ok = Boolean(done(s));
  if (!ok) {
    // A slow frame can land the effect a moment later.
    await sleep(800);
    s = snapshot();
    ok = Boolean(done(s));
  }
  return { id: elementId, hand, point: round(point, 3), hovered, ok };
}

/**
 * Meta VR Glasses (iwsdk-glasses-test): switches the emulator to the
 * metaVRGlasses profile (iwsdk.config.json; Vite restarts in place), checks
 * gaze-tracking, then measures every surface against the glasses' view at
 * the fallback pose (head 1.2 m above the floor, level gaze: the geometry
 * tests' default seated pose) and seated at the coffee table looking at the
 * board, with field-of-view-masked screenshots. At the table, level 1 is
 * solved and every in-XR button pressed by gaze plus a right-hand pinch:
 * HUD Replay, Next, Levels and Play again, the near-rim button, the six
 * level buttons, Your Table, Settings and Close, every Settings button and
 * every Your Table button; one press uses the left hand, and with gaze
 * disconnected the hand ray selects again. (The HUD's Enter AR button is
 * hidden in XR.) Settings return to the defaults and the device to the
 * one before, also on failure.
 */
export async function glassesFit({ tableHead, fallbackHead, takeShot }) {
  if (xr('status').sessionActive) await exitXR();
  const started = Date.now();
  const deviceBefore = setEmulatorDevice('metaVRGlasses');
  const presses = [];
  const fits = [];
  const shots = {};
  const handsDown = (head) => {
    for (const [device, dx] of [['hand-left', -0.3], ['hand-right', 0.3]]) {
      xr('set-transform', { device, position: { x: head.x + dx, y: head.y - 0.45, z: head.z - 0.05 } });
      xr('look-at', { device, target: { x: head.x + dx * 2, y: 0, z: head.z } });
    }
  };
  const seatAt = async (head, lookAtBoard) => {
    xr('set-transform', { device: 'headset', position: head, orientation: { x: 0, y: 0, z: 0, w: 1 } });
    await sleep(300);
    if (lookAtBoard) xr('look-at', { device: 'headset', target: vec(snapshot().board.center) });
    handsDown(head);
    await sleep(500);
  };
  const press = async (id, done, hand) => {
    const r = await gazePress(id, done, hand);
    presses.push(r);
    return r;
  };
  const openLevels = async () => {
    if (!snapshot().levelSelect.open) await press('levels-button', (s) => s.levelSelect.open);
    await sleep(600);
  };
  let result;
  try {
    const ready = await waitForEmulatorDevice('Meta VR Glasses');
    const restartMs = Date.now() - started;
    game('audio.setSettings', DEFAULT_TEST_SETTINGS);

    // 1. The profile, with a session.
    let status = await enterXR();
    const deviceState = xr('get-device-state');
    const device = {
      before: deviceBefore,
      deviceName: status.deviceName ?? ready.deviceName,
      sessionActive: status.sessionActive,
      sessionMode: status.sessionMode,
      gazeGranted: (status.enabledFeatures ?? []).includes('gaze-tracking'),
      enabledFeatures: status.enabledFeatures,
      gazeConnected: deviceState.gaze?.connected === true,
      restartMs,
    };

    // 2. The fallback pose: level gaze, the board 0.45 m ahead.
    xr('set-transform', { device: 'headset', position: fallbackHead, orientation: { x: 0, y: 0, z: 0, w: 1 } });
    await exitXR();
    await enterXR();
    await game('loadLevel', 0);
    await seatAt(fallbackHead, false);
    fits.push(measureFit('fallback: level 1'));
    await openLevels();
    fits.push(measureFit('fallback: level select'));
    await press('settings-button', (s) => s.levelSelect.page === 'settings');
    await sleep(300);
    fits.push(measureFit('fallback: Settings page'));
    shots.fallbackSettings = takeShot('iwer-glasses-fallback-settings.png');
    await press('settings-back', (s) => s.levelSelect.page === 'levels');
    await press('sandbox-button', (s) => s.mode === 'sandbox' && s.sandbox.panel.shown);
    await sleep(800);
    fits.push(measureFit('fallback: Your Table'));
    shots.fallbackYourTable = takeShot('iwer-glasses-fallback-your-table.png');
    await press('exit-sandbox', (s) => s.mode === 'story');

    // 3. Seated at the coffee table, looking at the board (the table plane).
    xr('set-transform', { device: 'headset', position: tableHead, orientation: { x: 0, y: 0, z: 0, w: 1 } });
    await exitXR();
    status = await enterXR();
    await game('loadLevel', 0);
    await sleep(500);
    await seatAt(tableHead, true);
    fits.push(measureFit('table: level 1'));
    shots.table = takeShot('iwer-glasses-table.png');

    // 4. Level 1 by gaze plus pinch: the gaze picks planet 1, the right
    // hand pinches and carries it (a gaze-started grab follows the hand).
    const levels = game('levels').value;
    let snap = snapshot();
    const body = snap.bodies.find((b) => b.movable);
    const solution = levels[0].solution[body.id];
    const hoverBefore = hoveredNames();
    xr('look-at', { device: 'gaze', target: vec(body.world) });
    await sleep(600);
    const hoverPlanet = hoveredNames();
    const attemptsBefore = snap.attempts;
    xr('set-select-value', { device: DEVICE, value: 1 });
    await sleep(700);
    snap = snapshot();
    const heldAfterPinch = Boolean(bodyOf(snap, body.id)?.held);
    let reached = bodyOf(snap, body.id).board;
    let heldWhileMoving = false;
    if (heldAfterPinch) {
      const goal = toWorld(snap.board, [solution[0], 0, solution[1]]);
      const h = xr('get-transform', { device: DEVICE }).position;
      const hand = [h.x, h.y, h.z];
      let planet = bodyOf(snap, body.id).world;
      for (let i = 0; i < 6; i++) {
        hand[0] += goal[0] - planet[0];
        hand[2] += goal[2] - planet[2];
        xr('set-transform', { device: DEVICE, position: vec(hand) });
        await sleep(800);
        const b = bodyOf(snapshot(), body.id);
        heldWhileMoving = b.held;
        planet = b.world;
        reached = b.board;
        if (Math.hypot(solution[0] - reached[0], solution[1] - reached[2]) <= 0.005) break;
      }
    }
    xr('set-select-value', { device: DEVICE, value: 0 });
    const solvedSnap = await waitFor('level 1 solved', () => {
      const s = snapshot();
      return s.solved ? s : null;
    }, 60_000).catch(() => null);
    const end = solvedSnap ?? snapshot();
    const level1 = {
      body: body.id,
      hoverBefore,
      hoverPlanet,
      heldAfterPinch,
      heldWhileMoving,
      error: round(Math.hypot(solution[0] - reached[0], solution[1] - reached[2])),
      attempts: [attemptsBefore, end.attempts],
      solved: Boolean(solvedSnap),
      stars: end.stars.last,
      outcome: end.lastOutcome,
    };
    await seatAt(tableHead, true);
    shots.level1Solved = takeShot('iwer-glasses-l1-solved.png');

    // 5. The HUD and the near-rim button.
    let base = snapshot().attempts;
    await press('launch-button', (s) => s.attempts === base + 1);
    await waitNotFlying(60_000).catch(() => null);
    base = snapshot().attempts;
    await press('rim-launch-button', (s) => s.attempts === base + 1);
    await waitNotFlying(60_000).catch(() => null);
    await waitFor('level 1 solved again', () => snapshot().solved, 10_000, 300).catch(() => null);
    await press('next-button', (s) => s.level.index === 1);
    await sleep(500);

    // 6. The level select: measured open, then every level button.
    await openLevels();
    fits.push(measureFit('table: level select'));
    shots.levelSelect = takeShot('iwer-glasses-level-select.png');
    for (let i = 1; i <= levels.length; i++) {
      await openLevels();
      await press(`level-${i}`, (s) => s.level.index === i - 1 && !s.levelSelect.open);
      await sleep(400);
    }
    await openLevels();
    await press('close-levels', (s) => !s.levelSelect.open, 'hand-left');

    // 7. The Settings page: measured, every button, a screenshot with the labels on.
    await openLevels();
    await press('settings-button', (s) => s.levelSelect.page === 'settings');
    await sleep(300);
    fits.push(measureFit('table: Settings page'));
    const set = () => snapshot().accessibility.settings;
    const settingsBefore = set();
    const steps = [
      ['left-handed-button', (s) => s.accessibility.settings.leftHanded === !settingsBefore.leftHanded],
      ['contrast-button', (s) => s.accessibility.settings.highContrast === !settingsBefore.highContrast],
      ['motion-button', (s) => s.accessibility.settings.reducedMotion === !settingsBefore.reducedMotion],
      ['board-size-button', (s) => s.accessibility.settings.boardSize !== settingsBefore.boardSize],
      ['mute-button', (s) => s.accessibility.settings.muted === !settingsBefore.muted],
      ['volume-down', (s) => Math.abs(s.accessibility.settings.volume - (settingsBefore.volume - 0.1)) < 1e-9],
      ['volume-up', (s) => Math.abs(s.accessibility.settings.volume - settingsBefore.volume) < 1e-9],
      ['quiet-button', (s) => s.accessibility.settings.quiet === !settingsBefore.quiet],
    ];
    for (const [id, done] of steps) await press(id, done);
    const settingsAfter = set();
    await seatAt(tableHead, true);
    shots.settings = takeShot('iwer-glasses-settings.png');
    game('audio.setSettings', DEFAULT_TEST_SETTINGS);
    await sleep(700);
    await press('settings-back', (s) => s.levelSelect.page === 'levels');

    // 8. Your Table: measured beside the HUD, then every button.
    await press('sandbox-button', (s) => s.mode === 'sandbox' && s.sandbox.panel.shown);
    await sleep(800);
    await seatAt(tableHead, true);
    fits.push(measureFit('table: Your Table'));
    shots.yourTable = takeShot('iwer-glasses-your-table.png');
    await press('make-well', (s) => s.sandbox.armed && s.sandbox.armHand === 'right');
    // The confirming pinch: the right hand points at the board from the
    // chest (the reticle follows that hand's ray); the gaze rests on empty
    // space above the HUD, so the pinch selects no planet or button.
    const center = snapshot().board.center;
    const hudAt = snapshot().hud.position;
    handAtChest(DEVICE);
    xr('look-at', { device: DEVICE, target: vec(center) });
    xr('look-at', { device: 'gaze', target: { x: hudAt[0], y: hudAt[1] + 0.5, z: hudAt[2] } });
    await sleep(1200);
    const wellsBefore = snapshot().sandbox.wells.length;
    xr('select', { device: DEVICE });
    await sleep(900);
    snap = snapshot();
    const confirm = { wells: [wellsBefore, snap.sandbox.wells.length], armedAfter: snap.sandbox.armed, kinds: snap.sandbox.wells.map((w) => w.kind), status: snap.sandbox.status };
    handsDown(tableHead);
    await sleep(500);
    let pucks = snapshot().sandbox.pucks;
    await press('add-puck', (s) => s.sandbox.pucks === pucks + 1);
    const heightOf = (s) => s.sandbox.wells.find((w) => w.id === s.sandbox.selectedId)?.heightM ?? null;
    const h0 = heightOf(snapshot());
    await press('height-down', (s) => h0 !== null && Math.abs(heightOf(s) - (h0 - 0.01)) < 1e-6);
    await press('height-up', (s) => h0 !== null && Math.abs(heightOf(s) - h0) < 1e-6);
    await press('clear-wells', (s) => s.sandbox.wells.length === 0);
    const target = snapshot().sandbox.targetId;
    await press('next-target', (s) => s.sandbox.targetId !== target);
    await press('exit-sandbox', (s) => s.mode === 'story');

    // 9. Play again, in the chapter-complete moment after level 6.
    await game('loadLevel', levels.length - 1);
    await sleep(500);
    game('setPlacements', levels[levels.length - 1].solution);
    game('launch');
    await waitFor('level 6 solved', () => snapshot().solved, 120_000, 500).catch(() => null);
    await seatAt(tableHead, true);
    await press('next-button', (s) => s.chapterComplete.shown);
    await sleep(800);
    await press('play-again-button', (s) => !s.chapterComplete.shown && s.level.index === 0);

    // 10. Gaze disconnected: the hand ray selects; reconnected, gaze targets again.
    await seatAt(tableHead, true);
    xr('set-connected', { device: 'gaze', connected: false });
    await sleep(800);
    const offState = xr('get-device-state').gaze?.connected ?? null;
    const handClick = await rayClick('levels-button');
    const openedByHand = snapshot().levelSelect.open;
    xr('set-connected', { device: 'gaze', connected: true });
    await sleep(1000);
    const onState = xr('get-device-state').gaze?.connected ?? null;
    const closeByGaze = await gazePress('close-levels', (s) => !s.levelSelect.open);
    handsDown(tableHead);
    const fallback = { gazeConnected: [offState, onState], handHovered: handClick.hovered, openedByHand, closeByGaze };

    // 11. The console's gaze lines and errors.
    let gazeLines = [];
    let errors = null;
    let logShape = null;
    try {
      const logs = call(['browser', 'logs'], { input: { count: 200 } });
      gazeLines = [...new Set(JSON.stringify(logs).match(/\[iwsdk\]\[gaze\][^"\\]*/g) ?? [])];
      const entries = [logs?.result?.logs, logs?.logs, logs?.result?.entries, logs?.entries, logs?.result].find(Array.isArray);
      logShape = entries ? null : Object.keys(logs?.result ?? logs ?? {});
      errors = entries ? entries.filter((e) => e?.level === 'error' || e?.type === 'error').map((e) => String(e.text ?? e.message ?? '').slice(0, 200)) : null;
    } catch (error) {
      logShape = String(error?.message ?? error).slice(0, 300);
    }

    game('audio.setSettings', DEFAULT_TEST_SETTINGS);
    await sleep(300);
    const restoredSettings = set();
    await exitXR().catch(() => null);
    result = { device, fits, level1, presses, confirm, settingsBefore, settingsAfter, restoredSettings, fallback, gazeLines, errors, shots };
  } finally {
    if (restoreEmulatorDevice() && deviceBefore) {
      const name = { metaQuest3: 'Meta Quest 3' }[deviceBefore];
      if (name) {
        const back = await waitForEmulatorDevice(name).catch((error) => ({ error: String(error?.message ?? error) }));
        if (result) result.restored = { deviceName: back.deviceName ?? null, error: back.error ?? null };
      }
    }
  }
  return result;
}

/**
 * The surrounding cosmos (L1): the AR fade-in on session start (traced by
 * page timers), the Room view modes at the table pose (Mixed keeps the
 * table clear, Space fills the room, Room draws no cosmos), Your Table's
 * opacity cap, reduced motion (orbits, belt and shooting stars stand
 * still) and the opaque cosmos in VR. Screenshots of each.
 */
export async function cosmosModes({ tableHead, takeShot }) {
  const setRoomView = (roomView) => game('audio.setSettings', { roomView });
  const seatLook = async (target) => {
    xr('set-transform', { device: 'headset', position: tableHead, orientation: { x: 0, y: 0, z: 0, w: 1 } });
    await sleep(200);
    xr('look-at', { device: 'headset', target: vec(target ?? snapshot().board.center) });
    await sleep(900);
  };
  setRoomView('mixed');
  if (xr('status').sessionActive) await exitXR();
  await sleep(500);

  // 1. The fade-in: traced from just before the session starts.
  game('cosmos.traceStart', 9000);
  await enterXR();
  xr('set-transform', { device: 'headset', position: tableHead, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  await sleep(1500);
  const trace = game('cosmos.traceRead').value?.samples ?? [];
  const ar = trace.filter((s) => s.mode === 'immersive-ar' && s.visibility !== 'non-immersive');
  const t0 = ar[0]?.t ?? null;
  const near = (dt) => ar.reduce((best, s) => (best === null || Math.abs(s.t - t0 - dt) < Math.abs(best.t - t0 - dt) ? s : best), null);
  const fade = {
    first: ar[0] ? round(ar[0].fade, 3) : null,
    atHalfSecond: t0 === null ? null : round(near(500)?.fade ?? -1, 3),
    atHalfSecondDt: t0 === null ? null : Math.round((near(500)?.t ?? 0) - t0),
    atThreeSeconds: t0 === null ? null : round(near(3000)?.fade ?? -1, 3),
    after3s: ar.filter((s) => s.t - t0 >= 3000).map((s) => s.fade),
    samples: trace.length,
  };

  game('placeBoard');
  await sleep(1500);
  xr('set-transform', { device: 'hand-left', position: { x: tableHead.x - 0.18, y: tableHead.y - 0.25, z: tableHead.z - 0.2 } });
  xr('set-transform', { device: 'hand-right', position: { x: tableHead.x + 0.15, y: tableHead.y - 0.2, z: tableHead.z - 0.15 } });
  await game('loadLevel', 0);
  await seatLook();
  const view = (s) => ({ ...s.cosmos, calls: s.renderer.calls });
  const sampleCalls = async () => {
    game('resetRenderStats');
    await sleep(1500);
    return game('renderStats').value.max.calls;
  };

  // 2. Mixed (the default): the table area is clear.
  let s = snapshot();
  const mixed = { ...view(s), board: s.board.source, maxCalls: await sampleCalls(), shot: takeShot('l1-ar-mixed-table.png') };
  const c = s.board.center;
  await seatLook([c[0] - 1.5, tableHead.y + 0.9, c[2] - 3]);
  const mixedAhead = takeShot('l1-ar-mixed-ahead.png');

  // 3. Space: no mask, the room fills with space.
  setRoomView('space');
  await seatLook();
  s = snapshot();
  const space = { ...view(s), shot: takeShot('l1-ar-space.png') };

  // 4. Room: no cosmos at all.
  setRoomView('room');
  await seatLook();
  s = snapshot();
  const room = { ...view(s), maxCalls: await sampleCalls(), shot: takeShot('l1-ar-room.png') };

  // 5. Your Table (Mixed): capped opacity, island mask.
  setRoomView('mixed');
  await game('sandbox.enter', 0);
  await sleep(400);
  await seatLook();
  s = snapshot();
  const yourTable = { ...view(s), mode: s.mode, shot: takeShot('l1-ar-your-table.png') };
  game('sandbox.exit');
  await sleep(500);

  // 6. Reduced motion: orbits and the belt stand still, no shooting star.
  game('audio.setSettings', { reducedMotion: true });
  await sleep(600);
  const m0 = snapshot().cosmos;
  await sleep(2000);
  const m1 = snapshot().cosmos;
  const stillTrace = [];
  for (let i = 0; i < 4; i++) {
    stillTrace.push(snapshot().cosmos.shootingStars);
    await sleep(500);
  }
  game('audio.setSettings', { reducedMotion: false });
  await sleep(1500);
  const moving = snapshot().cosmos.motion;
  const reduced = { motion: [m0.motion, m1.motion], shootingStars: stillTrace, movingAfter: moving };

  // 7. VR: opaque, no mask.
  await exitXR();
  game('enterVR');
  await waitFor('an active immersive-vr session', () => xr('status').sessionActive, 20_000);
  xr('set-input-mode', { mode: 'hand' });
  await sleep(3000);
  xr('set-transform', { device: 'headset', position: tableHead, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  await sleep(300);
  game('placeBoard');
  await sleep(1500);
  await seatLook([c[0] - 1.2, tableHead.y + 0.3, c[2] - 3]);
  s = snapshot();
  const vr = { ...view(s), session: s.session.mode, blendMode: s.session.blendMode, shot: takeShot('l1-vr.png') };
  await exitXR();
  return { fade, mixed, mixedAhead, space, room, yourTable, reduced, vr };
}

/**
 * Before/after numbers of the busiest views with ?debug=1 (the URL testers
 * use): level 6 mid-flight, the chapter-complete moment, Your Table with
 * three pucks, and the level select open, first in immersive-ar at the table
 * pose, then in immersive-vr. Each view: the most draw calls and triangles
 * over 2.5 s and the IWER frame rate (frames / seconds), occlusion on.
 */
export async function budgetViews({ tableHead, takeShot }) {
  if (xr('status').sessionActive) await exitXR();
  const nav = game('page.search').value === '?debug=1' ? null : await navigateSearch('?debug=1');
  const SAMPLE_MS = 2500;
  const levels = game('levels').value;
  const last = levels.length - 1;
  const passes = [];
  for (const session of ['immersive-ar', 'immersive-vr']) {
    if (xr('status').sessionActive) await exitXR();
    if (session === 'immersive-ar') await enterXR();
    else {
      game('enterVR');
      await waitFor('an active immersive-vr session', () => xr('status').sessionActive, 20_000);
      xr('set-input-mode', { mode: 'hand' });
      await sleep(3000);
    }
    xr('set-transform', { device: 'headset', position: tableHead, orientation: { x: 0, y: 0, z: 0, w: 1 } });
    await sleep(300);
    game('placeBoard');
    await sleep(1500);
    const seatLook = async () => {
      xr('set-transform', { device: 'headset', position: tableHead, orientation: { x: 0, y: 0, z: 0, w: 1 } });
      await sleep(200);
      xr('look-at', { device: 'headset', target: vec(snapshot().board.center) });
      await sleep(300);
    };
    await seatLook();
    const views = [];
    const sample = async (view, shot) => {
      const s = snapshot();
      game('resetRenderStats');
      await sleep(SAMPLE_MS);
      const stats = game('renderStats').value;
      const file = shot ? takeShot(shot) : null;
      views.push({
        view,
        level: s.level.id,
        mode: s.mode,
        phase: s.phase,
        chapter: s.chapterComplete.shown,
        levelSelectOpen: s.levelSelect.open,
        wells: s.sandbox.wells.length,
        max: stats.max,
        frames: stats.frames,
        fps: round(stats.frames / (SAMPLE_MS / 1000), 1),
        programs: stats.programs,
        shot: file,
      });
    };
    const tag = session === 'immersive-ar' ? 'ar' : 'vr';

    // 1. Level 6 mid-flight (the most bodies, comet and trail).
    await game('loadLevel', last);
    await sleep(500);
    game('setPlacements', levels[last].solution);
    game('launch');
    await sleep(800);
    await sample('level 6 mid-flight', `budget-${tag}-l6-midflight.png`);

    // 2. The chapter-complete moment (solve level 6, then Next).
    await waitFor('level 6 solved', () => snapshot().solved, 90_000, 500).catch(() => null);
    await seatLook();
    await rayClick('next-button');
    await waitFor('the chapter moment', () => snapshot().chapterComplete.shown, 10_000, 300).catch(() => null);
    await sleep(1500);
    await sample('chapter complete', `budget-${tag}-chapter.png`);

    // 3. Your Table with three wells (pucks).
    game('sandbox.enter', 0);
    await sleep(500);
    for (let i = 0; i < 3; i++) game('sandbox.addPuck');
    await sleep(500);
    await seatLook();
    await sample('Your Table, 3 wells', `budget-${tag}-your-table.png`);
    game('sandbox.clear');
    game('sandbox.exit');
    await sleep(500);

    // 4. The level select open (over level 1).
    await game('loadLevel', 0);
    await sleep(500);
    await seatLook();
    if (!snapshot().levelSelect.open) await rayClick('levels-button');
    await waitFor('the level select open', () => snapshot().levelSelect.open, 10_000, 300).catch(() => null);
    await sleep(800);
    await sample('level select open', `budget-${tag}-level-select.png`);
    if (snapshot().levelSelect.open) await rayClick('close-levels');
    await sleep(400);
    passes.push({ session, appMode: snapshot().session.mode, views });
  }
  if (xr('status').sessionActive) await exitXR();
  const back = await navigateSearch('');
  return { search: nav?.search ?? '?debug=1', searchAfter: back.search, passes };
}

/** Most XR render counts over `ms` of the current view with depth occlusion on or off. */
async function budgetSample(on, ms) {
  game('setOcclusion', on);
  await sleep(600);
  game('resetRenderStats');
  await sleep(ms);
  const stats = game('renderStats').value;
  return { occlusion: on, max: stats.max, frames: stats.frames, programs: stats.programs, depthFrames: stats.depthFrames };
}
export { enterXR, exitXR };
