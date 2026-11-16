// IWER (emulated Quest 3) verification through the IWSDK CLI managed runtime,
// in named groups: placement (fallback, then the table plane in the
// sunlit_living_room SEM room), hand-solve (a hand-ray grab of planet 1 to the
// level-1 solution), poke (Launch), render (XR render stats), spike (the
// real-object probes), gate (off-board snap-back), near-pinch, tracking (hand
// lost mid-hold), levels (2-3 by hand), levels-4-6 (by hand, mid-flight
// screenshots), handle (the board handle), rim (the near-rim Launch button),
// onboarding (ghost hand on a fresh save, level select by poke and ray),
// audio (context running in XR, flyby and chord
// events after a hand solve), visibility (visible-blurred pauses the flight
// and audio), real-object (Your Table: a well on the cup, the puck fallback,
// clear, story levels untouched), occlusion (depth occlusion status and its
// cost on and off), hands-cdn (hand models from our own origin),
// vr (the immersive-vr fallback, also from a fresh desktop page),
// debug-overlay (the ?debug=1 tester overlay on desktop and in XR) and
// level-select-budget (XR draw calls with the level select open over the
// busiest views, plain and with ?debug=1), accessibility (the Settings
// page by ray and poke, and each accessibility mode with its screenshot) and
// glasses (the Meta VR Glasses profile: every surface inside its view, level
// 1 and every button by gaze plus pinch, masked screenshots).
// Setup, placement and the runtime teardown always run; the runtime is always
// stopped.
// Usage: npm run verify:iwer
//        node e2e/iwer/verify-iwer.mjs --only=rim,hands-cdn
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tsImport } from 'tsx/esm/api';
import { call, root, run, sleep } from './cli.mjs';
import {
  dist,
  enterXR,
  exitXR,
  game,
  letGo,
  navigateSearch,
  RESULTS,
  rayDrag,
  restoreEmulatorDevice,
  round,
  screenshot as saveScreenshot,
  SHOTS,
  snapshot,
  vec,
  waitFor,
  xr,
} from './xr-helpers.mjs';
import {
  accessibilitySettings,
  budgetViews,
  cosmosModes,
  debugOverlay,
  DEFAULT_TEST_SETTINGS,
  handleDrag,
  handsCdn,
  levelSelectBudget,
  nearPinch,
  GLASSES_VIEW,
  glassesFit,
  occlusionCost,
  offBoardRelease,
  onboardingAndLevelSelect,
  realObjectWells,
  rimButton,
  solveLevels456ByHand,
  solveLevelsByHand,
  trackingLoss,
  visibilityPause,
  vrFromFreshPage,
  vrStarfield,
} from './xr-scenarios.mjs';

const { boardRadiusForTable } = await tsImport('../../src/game/placement.ts', import.meta.url);
const { BOARD, BOARD_SIZE_SCALE, RENDER_BUDGET } = await tsImport('../../src/config.ts', import.meta.url);
const { wellMassForHeight } = await tsImport('../../src/game/real-object.ts', import.meta.url);
const { WELL_INFLUENCE_RADIUS } = await tsImport('../../src/sim/wells.ts', import.meta.url);

const TABLE_HEAD = { x: 0, y: 1.15, z: -1.2 };
/** The geometry tests' default seated head (room origin, 1.2 m up, level gaze): the coffee table is out of reach, so the fallback board. */
const FALLBACK_HEAD = { x: 0, y: 1.2, z: 0 };
// The cup on the sunlit_living_room coffee table: group at z = -1.95, cup at
// local [0.08, 0.512, 0.17], a 0.15 m tall cylinder (radius 0.035-0.045).
const CUP = { x: 0.08, y: 0.512, z: -1.78, height: 0.15, radius: 0.045 };
const BUDGET = { calls: RENDER_BUDGET.maxDrawCalls, triangles: RENDER_BUDGET.maxTriangles };

/** Every group in run order; vr goes last because it reloads the page. */
const GROUPS = [
  'placement',
  'hand-solve',
  'poke',
  'render',
  'spike',
  'gate',
  'near-pinch',
  'tracking',
  'levels',
  'levels-4-6',
  'handle',
  'rim',
  'onboarding',
  'audio',
  'visibility',
  'real-object',
  'occlusion',
  'hands-cdn',
  'vr',
  // After vr: it navigates the page to ?debug=1 and back.
  'debug-overlay',
  'level-select-budget',
  // It changes the saved settings (and restores the defaults).
  'accessibility',
  // The surrounding cosmos (it changes the Room view and restores Mixed).
  'cosmos',
  // Before/after render numbers of the busiest views with ?debug=1 (AR, then VR).
  'budget-views',
  // Last: it switches the emulator to the Meta VR Glasses profile (Vite
  // restarts) and back.
  'glasses',
];
const ALWAYS = new Set(['placement']);

function selectedGroups(argv) {
  const only = argv.find((a) => a.startsWith('--only='));
  if (!only) return new Set(GROUPS);
  const names = only.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = names.filter((n) => !GROUPS.includes(n));
  if (unknown.length) throw new Error(`unknown group(s): ${unknown.join(', ')}; known: ${GROUPS.join(', ')}`);
  return new Set([...ALWAYS, ...names]);
}

const summary = { ok: false, groups: [], checks: [], data: {} };
const check = (name, pass, detail) => {
  summary.checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
  return Boolean(pass);
};
const require_ = (name, pass, detail) => {
  if (!check(name, pass, detail)) throw new Error(`required check failed: ${name}`);
};
const screenshot = (name) => saveScreenshot(name, summary);

/** Seated at the coffee table, looking ahead (the pose interaction groups start from). */
async function seat() {
  xr('set-transform', { device: 'headset', position: TABLE_HEAD, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  await sleep(300);
}

/** State shared between groups. */
const ctx = { table: null, levels: null, poked: null };

const GROUP_RUNNERS = {
  // 2-3. Fallback at the default pose, then the table plane when seated.
  async placement() {
    // Default pose (room origin, facing -Z): the coffee table is out of reach → fallback.
    const before = xr('status');
    check('xr runtime offers a session', before.sessionOffered, { deviceName: before.deviceName, runtimeKind: before.runtimeKind });
    const device = xr('get-device-state');
    summary.data.headsetDeviceId = 'headset' in device ? 'headset' : Object.keys(device)[0];
    const status = await enterXR();
    require_('session active (immersive-ar)', status.sessionActive && status.sessionMode === 'immersive-ar', status.sessionMode);
    summary.data.enabledFeatures = status.enabledFeatures;
    let snap = snapshot();
    const head0 = xr('get-transform', { device: 'headset' }).position;
    const c0 = snap.board.center;
    const ahead = Math.hypot(c0[0] - head0.x, c0[2] - head0.z);
    summary.data.fallback = { head: head0, board: snap.board };
    check('fallback placement at the default pose', snap.board.source === 'fallback', snap.board.source);
    check('fallback board ~0.45 m ahead of the head', Math.abs(ahead - BOARD.fallbackDistance) < 0.03 && c0[2] < head0.z, round(ahead));
    check('fallback board below eye height', c0[1] < head0.y - 0.1 && c0[1] > head0.y - 0.35, round(c0[1] - head0.y));
    screenshot('iwer-fallback.png');

    // Seated at the coffee table → the board lands on the 'table' plane.
    xr('set-transform', { device: 'headset', position: TABLE_HEAD, orientation: { x: 0, y: 0, z: 0, w: 1 } });
    await exitXR();
    await enterXR();
    snap = snapshot();
    const planes = game('spike.planes').value;
    summary.data.planes = planes.map((p) => ({ id: p.id, label: p.label, orientation: p.orientation, size: round(p.size, 3), center: round(p.center, 3) }));
    const b = snap.board;
    ctx.table = b;
    ctx.levels = game('levels').value;
    summary.data.table = { board: b };
    check('table-plane placement', b.source === 'table-plane', b.source);
    check("plane label 'table'", b.planeLabel === 'table', b.planeLabel);
    check('board height 0.44 +/- 0.03 m', Math.abs(b.center[1] - 0.44) <= 0.03, round(b.center[1]));
    const plane = planes.find((p) => p.id === b.planeId);
    if (check('placed plane reported by spike.planes()', plane, b.planeId)) {
      const [lx, ly, lz] = plane.boardCenterLocal;
      const e = plane.extents;
      check('board center inside the table footprint', lx >= e.minX && lx <= e.maxX && lz >= e.minZ && lz <= e.maxZ && Math.abs(ly) < 0.02, round([lx, ly, lz]));
      const expected = boardRadiusForTable(Math.min(plane.size[0], plane.size[1]));
      check('radius = boardRadiusForTable(min side)', Math.abs(b.radius - expected) < 1e-4, { radius: round(b.radius), expected: round(expected) });
    }
    // Both hands in view for the screenshot.
    xr('set-transform', { device: 'hand-left', position: { x: TABLE_HEAD.x - 0.18, y: TABLE_HEAD.y - 0.25, z: TABLE_HEAD.z - 0.2 } });
    xr('set-transform', { device: 'hand-right', position: { x: TABLE_HEAD.x + 0.15, y: TABLE_HEAD.y - 0.2, z: TABLE_HEAD.z - 0.15 } });
    // A seated player looks down at the table (placement is already done).
    xr('look-at', { device: 'headset', target: vec(b.center) });
    await sleep(500);
    screenshot('iwer-table.png');
  },

  // 4. Hand ray: grab planet 1 and drag it to the level-1 solution.
  async 'hand-solve'() {
    const b = ctx.table;
    await game('loadLevel', 0);
    const level = ctx.levels[0];
    const movable = snapshot().bodies.find((x) => x.movable);
    const solution = level.solution[movable.id];
    xr('look-at', { device: 'headset', target: vec(b.center) });
    let drag = await rayDrag('hand-right', movable.id, solution);
    summary.data.handDrag = drag;
    if (!(drag.colliderHover && drag.heldAfterSelect)) {
      // One correction: repeat with the controller ray (iwsdk-ray skill path).
      console.log('hand path did not hover/select; retrying with controller-right');
      await game('loadLevel', 0);
      drag = await rayDrag('controller-right', movable.id, solution);
      summary.data.controllerDrag = drag;
      xr('set-input-mode', { mode: 'hand' });
    }
    summary.data.dragDevice = drag.device;
    check(`${drag.device} ray hovers the invisible collider (C5)`, drag.colliderHover, { rayMissBoard: drag.rayMissBoard });
    check(`${drag.device} select grabs planet 1`, drag.heldAfterSelect && drag.heldWhileMoving);
    check('planet within 0.03 of the level-1 solution while held', drag.error <= 0.03, { reached: drag.reached, solution, error: drag.error });
    check('release over the board launches and solves level 1', drag.solved, { outcome: drag.lastOutcome, afterMs: drag.solvedAfterMs });
    xr('look-at', { device: 'headset', target: vec(b.center) });
    await sleep(500);
    screenshot('iwer-hand-solved.png');
  },

  // 5. Poke the HUD Launch/Replay button with the right index finger.
  async poke() {
    xr('look-at', { device: 'headset', target: vec(ctx.table.center) });
    await sleep(300);
    const targets = xr('list-targets').targets.map((t) => t.name);
    check("'launch-button' is a run-sequence target", targets.includes('launch-button'), targets);
    game('resetRenderStats');
    const attempts = game('watchLaunch.start').value.base;
    const press = xr('run-sequence', {
      device: 'hand-right',
      steps: [{ label: 'poke launch', target: 'launch-button', press: { hold: 0.05, retract: 0.05 } }],
    }, { timeoutMs: 60_000 });
    const poked = snapshot();
    ctx.poked = poked;
    const watch = game('watchLaunch.read').value;
    // press.steps[].startPerf and the watcher both use the page clock.
    const contactPerf = press.steps[0].startPerf + (press.presses[0]?.contactMs ?? 0);
    // A UIKit click fires when the fingertip lets go (pointer up), so the launch
    // lands during the retract, after the contact and before the step ends.
    const launchAfterContactMs = watch?.launchedAt != null ? Math.round(watch.launchedAt - contactPerf) : null;
    const launchAfterPressEndMs = watch?.launchedAt != null ? Math.round(watch.launchedAt - press.steps[0].endPerf) : null;
    summary.data.poke = {
      phase: poked.phase,
      attempts: poked.attempts,
      flightTime: round(poked.flightTime, 3),
      launchAfterContactMs,
      launchAfterPressEndMs,
      pressEndAfterContactMs: Math.round(press.steps[0].endPerf - contactPerf),
      events: press.events,
      presses: press.presses,
    };
    check('poke on Launch starts a flight', poked.attempts === attempts + 1 && ['flying', 'solved'].includes(poked.phase), { phase: poked.phase, attempts: poked.attempts });
    check(
      'flight starts within 1 s of the poke (after contact, by press end + 1 s)',
      launchAfterContactMs !== null && launchAfterContactMs >= 0 && launchAfterPressEndMs <= 1000,
      { launchAfterContactMs, launchAfterPressEndMs },
    );
  },

  // 6. Render stats during a flight (the poke's, or one started here).
  async render() {
    if (!ctx.poked) {
      game('resetRenderStats');
      game('launch');
      await sleep(1500);
    }
    const flight = ctx.poked ?? snapshot();
    const stats = game('renderStats').value;
    const statsFile = path.join(RESULTS, 'render-stats-iwer.json');
    writeFileSync(statsFile, JSON.stringify({ level: flight.level.id, phase: flight.phase, stats, snapshotRenderer: flight.renderer, budget: BUDGET }, null, 2));
    summary.data.renderStats = { file: statsFile, ...stats };
    check('XR render stats sampled', stats.frames > 0, { frames: stats.frames });
    check('XR draw calls within budget', stats.max.calls <= BUDGET.calls, stats.max.calls);
    check('XR triangles within budget', stats.max.triangles <= BUDGET.triangles, stats.max.triangles);
  },

  // 7. Real-object spike: features, meshes, viewer hit-test aimed at the cup.
  async spike() {
    xr('set-transform', { device: 'headset', position: TABLE_HEAD });
    xr('look-at', { device: 'headset', target: { x: CUP.x, y: CUP.y + 0.04, z: CUP.z } });
    await sleep(500);
    const features = game('spike.enabledFeatures').value;
    const meshes = game('spike.meshes').value;
    const planes = game('spike.planes').value;
    const hitTest = game('spike.hitTestFromViewer', 10).value;
    const firstHit = hitTest.hits[0] ?? null;
    const cupHit = Boolean(
      firstHit &&
        Math.hypot(firstHit[0] - CUP.x, firstHit[2] - CUP.z) <= CUP.radius + 0.01 &&
        firstHit[1] >= CUP.y - CUP.height / 2 - 0.01 &&
        firstHit[1] <= CUP.y + CUP.height / 2 + 0.01,
    );
    const spike = {
      room: 'sunlit_living_room',
      head: TABLE_HEAD,
      aim: { x: CUP.x, y: CUP.y + 0.04, z: CUP.z },
      enabledFeatures: features,
      meshes,
      meshLabels: [...new Set(meshes.map((m) => m.semanticLabel || '(global mesh)'))],
      planeLabels: [...new Set(planes.map((p) => p.label))],
      hitTest,
      cupHit,
      cupHeightAboveBoardM: cupHit ? round(hitTest.boardHeights[0]) : null,
      board: snapshot().board,
    };
    const spikeFile = path.join(RESULTS, 'spike-iwer.json');
    writeFileSync(spikeFile, JSON.stringify(spike, null, 2));
    summary.data.spike = { file: spikeFile, features, meshLabels: spike.meshLabels, hits: hitTest.hits.length, firstHit: firstHit && round(firstHit), cupHit, cupHeightAboveBoardM: spike.cupHeightAboveBoardM };
    check("spike: 'hit-test' granted and a viewer hit-test source created", features.includes('hit-test') && hitTest.sourceCreated);
    check('spike: viewer hit-test returned hits', hitTest.hits.length > 0, hitTest.hits.length);
    console.log(`spike: cup hit ${cupHit}, height above board ${spike.cupHeightAboveBoardM} m`);
  },

  // 8. Release gate: a hand release off the board snaps back without a launch.
  async gate() {
    await seat();
    const off = await offBoardRelease();
    summary.data.offBoardRelease = off;
    check('off-board: hand ray grabbed planet 1', off.held && off.heldWhileOff, off.hovered);
    check('off-board: held planet clamped to the 0.92 disc', off.clampedRadiusWhileHeld <= 0.9201, off.clampedRadiusWhileHeld);
    check(
      'off-board: release snaps back with no launch',
      off.attemptsAfter === off.attemptsBefore && off.phase === 'placing' && off.placementsUnchanged && off.snapBackError < 1e-4,
      { attempts: [off.attemptsBefore, off.attemptsAfter], phase: off.phase, snapBackError: off.snapBackError },
    );
  },

  // 9. Near pinch: the ray origin inside the invisible collider, the ray beside the visible sphere.
  async 'near-pinch'() {
    await seat();
    const near = await nearPinch();
    summary.data.nearPinch = near;
    const g = near.geometry;
    check(
      'near pinch: hand 3.6 cm from the planet, ray outside the visible sphere, inside the collider',
      g.handToCenterM < g.colliderRadiusM && g.rayMissM > g.visibleRadiusM,
      g,
    );
    check('near pinch: planet hovered and grabbed', near.hovered.includes('Body p1') && near.held && near.heldWhileCarried, near.hovered);
    check(
      'near pinch: carried 8 cm and launched on release',
      near.movedBoardUnits > 0.2 && near.attemptsAfter === near.attemptsBefore + 1,
      { movedBoardUnits: near.movedBoardUnits, attempts: [near.attemptsBefore, near.attemptsAfter], committed: near.committed },
    );
  },

  // 10. Hand tracking lost mid-hold (IWER: the hand input source disconnects).
  // IWER ends the hold in the same frame the source disappears; the gate sees
  // the holder hand missing on the release frame and snaps back (D1).
  async tracking() {
    await seat();
    const lost = await trackingLoss();
    summary.data.trackingLoss = lost;
    check(
      'tracking loss mid-hold snaps back without a launch (D1)',
      lost.held &&
        lost.heldWhileDisconnected === false &&
        lost.attemptsAfterLetGo === lost.attemptsBefore &&
        lost.attemptsWhileDisconnected === lost.attemptsBefore &&
        lost.placementsUnchanged &&
        lost.phase === 'placing' &&
        lost.snapBackError < 1e-4,
      lost,
    );
  },

  // 11. Levels 2 and 3 by hand ray.
  async levels() {
    await seat();
    const byHand = await solveLevelsByHand(ctx.levels);
    summary.data.levelsByHand = byHand;
    for (const result of byHand) {
      const worst = Math.max(...result.drags.map((d) => d.error ?? Infinity));
      check(`${result.level} solved by hand-ray drags`, result.solved && result.drags.every((d) => d.colliderHover && d.heldAfterSelect), {
        attempts: result.attempts,
        worstError: worst,
        solvedAfterMs: result.drags.at(-1).solvedAfterMs,
      });
    }
    xr('look-at', { device: 'headset', target: vec(snapshot().board.center) });
    await sleep(500);
    screenshot('iwer-l3-hand-solved.png');
  },

  // 11b. Levels 4-6 (black hole, white star, both) by hand ray, with a
  // screenshot about 40% into each solving flight.
  async 'levels-4-6'() {
    await seat();
    const byHand = await solveLevels456ByHand(ctx.levels, (name) => screenshot(name));
    summary.data.levels456 = byHand;
    for (const result of byHand) {
      const worst = Math.max(...result.drags.map((d) => d.error ?? Infinity));
      check(`${result.level} solved by hand-ray drags`, result.solved && result.drags.every((d) => d.colliderHover && d.heldAfterSelect), {
        attempts: result.attempts,
        stars: result.stars,
        worstError: worst,
        wallMs: result.wallMs,
      });
      const mid = result.mid;
      const fraction = mid?.heldAt != null && mid.flightDuration ? mid.heldAt / mid.flightDuration : null;
      check(
        `${result.level} mid-flight screenshot about 40% into the solving flight`,
        Boolean(mid?.held && mid.shot) && fraction >= 0.38 && fraction <= 0.55 && mid.released?.paused === false,
        { fraction: fraction === null ? null : round(fraction, 3), pauseReason: mid?.pauseReason, shot: mid?.shot },
      );
    }
  },

  // 12. The board handle: grab with the hand ray and move the board 10 cm right.
  async handle() {
    await seat();
    const handle = await handleDrag();
    summary.data.handleDrag = handle;
    check('handle: hand ray hovers and grabs the board handle', handle.hovered?.includes('BoardHandle') && handle.held && handle.heldWhileMoving, handle.hovered);
    check(
      'handle: board follows ~10 cm to the right, keeps its height and size',
      handle.releasedAfter && Math.abs(handle.delta[0] - 0.1) < 0.03 && Math.abs(handle.delta[1]) < 0.01 && Math.abs(handle.delta[2]) < 0.03 && handle.radiusUnchanged,
      { delta: handle.delta },
    );
  },

  // 13. The near-rim Launch/Replay button (D2) at the seated table pose.
  async rim() {
    await seat();
    const r = await rimButton(() => screenshot('iwer-rim-button.png'));
    summary.data.rim = r;
    check('rim: button within 0.55 m of the head at the table pose', r.rim.ready && r.reachM < 0.55, { reachM: r.reachM, position: r.rim.position, size: r.rim.size });
    check("rim: 'rim-launch-button' is a run-sequence target", r.listed);
    check(
      'rim: fingertip poke starts a flight within 1 s of the press end',
      r.poke.attemptsAfter === r.poke.attemptsBefore + 1 &&
        r.poke.launchAfterContactMs !== null &&
        r.poke.launchAfterContactMs >= 0 &&
        r.poke.launchAfterPressEndMs <= 1000,
      { attempts: [r.poke.attemptsBefore, r.poke.attemptsAfter], launchAfterPressEndMs: r.poke.launchAfterPressEndMs, label: r.poke.labelAfter },
    );
    check('rim: the poke grabs nothing (no Grabbed, handle free)', r.poke.grabbedAfter.length === 0 && r.poke.handleHeldAfter === false, r.poke.grabbedAfter);
    const h = r.whileHeld;
    check(
      'rim: a poke while the other hand holds planet 1 does not launch',
      r.heldBy.leftGrabbed && h && h.heldDuringPoke && h.attemptsDuringPoke === h.attemptsHeld && h.launchAfterPressEndMs === null,
      { heldBy: r.heldBy, whileHeld: h },
    );
    check(
      'rim: then letting go off the board snaps back without a launch',
      h && h.attemptsAfterLetGo === h.attemptsHeld && h.phaseAfterLetGo === 'placing' && h.snapBackError < 1e-4,
      h,
    );
    const p = r.rayPinch;
    check(
      'rim: a hand-ray pinch aimed at the button launches',
      p.hovered.includes('rim-button') && p.attemptsAfter === p.attemptsBefore + 1,
      { attempts: [p.attemptsBefore, p.attemptsAfter], hovered: p.hovered },
    );
    check(
      'rim: the ray pinch grabs nothing (no Grabbed, handle free)',
      p.grabbedWhilePinched.length === 0 && p.grabbedAfter.length === 0 && p.handleHeldAfter === false,
      { whilePinched: p.grabbedWhilePinched, after: p.grabbedAfter },
    );
  },

  // 13b. Onboarding (F3): the ghost hand on a fresh save, then the level
  // select opened by poke, a level loaded by poke, Mute and a level by ray.
  async onboarding() {
    await seat();
    const o = await onboardingAndLevelSelect((name) => screenshot(name));
    summary.data.onboarding = o;
    check(
      'onboarding: fresh save shows the ghost hand on level 1 (attract loop on)',
      o.ghost.levelIndex === 0 && o.ghost.phase === 'placing' && o.ghost.done === false && o.ghost.visible && o.ghost.attract,
      o.ghost,
    );
    check('onboarding: ghost hand screenshot mid-carry', o.ghost.held && Boolean(o.ghost.shot), { heldAt: o.ghost.heldAt, shot: o.ghost.shot });
    check(
      "onboarding: a fingertip poke on the HUD 'levels-button' opens the level select",
      o.opened.listed && o.opened.open && o.opened.attractAfter === false,
      { contactMs: o.opened.contactMs, open: o.opened.open },
    );
    check('onboarding: level select within 0.55 m of the head while open', o.opened.reachM !== null && o.opened.reachM <= 0.55, { reachM: o.opened.reachM, size: o.opened.size });
    check('onboarding: a poke on level-2 loads c1-l2 and closes the panel', o.poked.listed && o.poked.levelId === 'c1-l2' && o.poked.open === false, o.poked);
    check(
      'onboarding: hand-ray clicks open Settings, toggle mute-button muted and back, and return to the levels',
      o.ray.reopened &&
        o.ray.pages[0] === 'settings' &&
        o.ray.pages[1] === 'levels' &&
        o.ray.muted[0] === false &&
        o.ray.muted[1] === true &&
        o.ray.muted[2] === false,
      { reopened: o.ray.reopened, reopenHovered: o.ray.reopenHovered, pages: o.ray.pages, muted: o.ray.muted, hovered: o.ray.muteHovered },
    );
    check('onboarding: a hand-ray click on level-3 loads c1-l3 and closes the panel', o.ray.levelId === 'c1-l3' && o.ray.open === false, { levelId: o.ray.levelId, hovered: o.ray.levelHovered });
  },

  // 14. Audio in XR: the shared context runs after the session started, and a
  // hand-ray solve of level 1 rings p1 and closes on the chord. The context
  // state is read only through the debug API.
  async audio() {
    await seat();
    const state = game('audio.state').value;
    summary.data.audio = { state };
    check('audio: AudioContext running in the XR session', state.contextState === 'running' && state.unlocked, state);
    await game('loadLevel', 0);
    xr('look-at', { device: 'headset', target: vec(snapshot().board.center) });
    const level = ctx.levels[0];
    const movable = snapshot().bodies.find((x) => x.movable);
    const drag = await rayDrag('hand-right', movable.id, level.solution[movable.id]);
    const expected = game('audio.expectedNotes').value;
    const flightId = expected[0]?.flightId ?? null;
    const events = await waitFor('the solve chord in the audio log', () => {
      const all = game('audio.events').value.filter((e) => e.flightId === flightId);
      return all.some((e) => e.kind === 'chord') ? all : null;
    }, 10_000).catch(() => game('audio.events').value.filter((e) => e.flightId === flightId));
    summary.data.audio = { state, solved: drag.solved, expected, events };
    check('audio: hand-ray solve of level 1', drag.solved, { outcome: drag.lastOutcome, error: drag.error });
    check(
      'audio: a flyby note for p1 rang during the flight',
      events.some((e) => e.kind === 'flyby' && e.bodyId === movable.id),
      events.filter((e) => e.kind === 'flyby').map((e) => ({ bodyId: e.bodyId, flightTime: round(e.flightTime, 3) })),
    );
    const chordIndex = events.findIndex((e) => e.kind === 'chord');
    check(
      'audio: the solve phrase then one chord',
      chordIndex >= 0 && events.filter((e) => e.kind === 'chord').length === 1 && events.slice(0, chordIndex).some((e) => e.kind === 'phrase'),
      events.map((e) => e.kind),
    );
  },

  // 15. XR visibility (F4): visible-blurred pauses the flight and the audio,
  // nothing launches while blurred, and 'visible' plays the flight to its end.
  async visibility() {
    await seat();
    const v = await visibilityPause();
    summary.data.visibility = v;
    check('visibility: level-1 solve by hand ray, then a replay', v.solved && v.blur.launched && v.blur.phase === 'flying', { solved: v.solved, blur: v.blur });
    check(
      "visibility: visible-blurred pauses with reason 'xr-blurred'",
      v.paused.paused && v.paused.reason === 'xr-blurred' && v.paused.visibility === 'visible-blurred',
      v.paused,
    );
    check(
      'visibility: flight time frozen for 1 s while blurred',
      v.paused.phase === 'flying' && v.later.phase === 'flying' && v.later.flightTime === v.paused.flightTime,
      { paused: v.paused.flightTime, later: v.later.flightTime },
    );
    check('visibility: audio context suspended while blurred', v.audio.before === 'running' && v.audio.blurred === 'suspended', v.audio);
    check(
      'visibility: no launch while blurred (input stops, or the release snaps back)',
      v.input.attemptsAfter === v.input.attemptsBefore &&
        v.input.phaseAfter === 'flying' &&
        v.input.flightTimeAfter === v.paused.flightTime &&
        v.input.placementsUnchanged &&
        (v.input.inputStopped || v.input.held),
      v.input,
    );
    check(
      "visibility: 'visible' resumes the flight to its end",
      !v.resumed.paused &&
        v.resumed.reason === 'none' &&
        v.end.phase === 'solved' &&
        v.end.attempts === v.blur.attempts &&
        Math.abs(v.end.flightTime - v.end.flightDuration) < 1e-6,
      { resumed: v.resumed, end: v.end },
    );
    check('visibility: audio context running again after the resume', v.audio.after === 'running', v.audio);
  },

  // 15b. Your Table (F5): a hand-ray pinch on the cup makes a 'real-object'
  // well, the puck fallback, clear, and story levels stay untouched.
  async 'real-object'() {
    const r = await realObjectWells({ cup: CUP, tableHead: TABLE_HEAD, expectedMass: wellMassForHeight, takeShot: (name) => screenshot(name) });
    summary.data.realObject = r;
    check(
      "real-object: the level select's Your Table button (ray) opens the sandbox, Next target loads table-2",
      r.entered.opened && r.entered.mode === 'sandbox' && r.entered.panelShown && r.target.levelId === 'table-2',
      { entered: r.entered, target: r.target },
    );
    const w = r.cupWell.well;
    check(
      'real-object: Make well arms the right hand and the reticle sees the cup as an object',
      r.cupWell.armed.armed && r.cupWell.armed.armHand === 'right' && r.cupWell.reticle?.hit === 'object',
      { armed: r.cupWell.armed, reticle: r.cupWell.reticle },
    );
    check(
      "real-object: a pinch on the cup places one 'real-object' well on the cup's axis",
      r.cupWell.wells === 1 && w?.kind === 'object' && w.source === 'real-object' && r.cupWell.axisDistanceM <= CUP.radius + 0.02 && !r.cupWell.armedAfter,
      { well: w, axisDistanceM: r.cupWell.axisDistanceM },
    );
    check(
      'real-object: well height >= 0.10 m and mass = wellMassForHeight(height)',
      Boolean(w) && w.measuredHeightM >= 0.1 && Math.abs(w.mass - r.cupWell.expectedMass) < 1e-9,
      { measuredHeightM: w?.measuredHeightM, heightM: w?.heightM, mass: w?.mass, expected: r.cupWell.expectedMass },
    );
    check('real-object: the cup well changes the comet path', r.withCup.pathHash && r.withCup.pathHash !== r.plain.pathHash, { plain: r.plain, withCup: r.withCup.pathHash });
    console.log(`real-object: well flybys ${JSON.stringify(r.withCup.wellFlybys)} (influence radius ${WELL_INFLUENCE_RADIUS})`);
    check(
      'real-object: a flyby note rang for the well whenever the flight passed it',
      r.withCup.expectedWellNotes.length === 0 || r.withCup.wellFlybys.length > 0,
      { expected: r.withCup.expectedWellNotes.length, rang: r.withCup.wellFlybys },
    );
    const f = r.fallback;
    check('real-object: a pinch on bare table inside the board spawns a puck', f.puck?.kind === 'puck' && f.reticle?.hit === 'too-low', { reticle: f.reticle, puck: f.puck });
    check('real-object: the puck moves about 0.3 board units by hand ray', Boolean(f.drag?.held) && f.drag.movedBoard >= 0.2, f.drag);
    check(
      'real-object: two height-up ray clicks raise the puck 2 cm',
      f.heights[0] !== null && f.heights[1] !== null && Math.abs(f.heights[1] - f.heights[0] - 0.02) < 1e-6,
      { heights: f.heights, hovered: f.upHovered },
    );
    check('real-object: the puck changes the path again', r.withPuck.pathHash && r.withPuck.pathHash !== r.withCup.pathHash, { withCup: r.withCup.pathHash, withPuck: r.withPuck.pathHash });
    check(
      'real-object: with wells still set, the c1-l1 stored solution solves with the same pathHash as before',
      r.story.wellsBeforeExit >= 2 && r.story.after.mode === 'story' && r.story.after.activeWells === 0 && r.story.after.outcome === 'solved' && r.story.after.pathHash === r.story.before.pathHash,
      r.story,
    );
    check('real-object: Clear wells (ray) removes every well and puck', r.cleared.wells === 0 && r.cleared.pucks === 0 && r.cleared.activeWells === 0, r.cleared);
    check(
      'real-object: armed, a pinch with the ray on the planet grabs nothing and launches nothing (it places a well or puck)',
      r.armedPinch.grabbed.length === 0 && r.armedPinch.movedBoard < 1e-4 && r.armedPinch.attempts[0] === r.armedPinch.attempts[1] && r.armedPinch.wells.length === 1 && !r.armedPinch.armedAfter,
      r.armedPinch,
    );
    check(
      'real-object: after that confirm the hand ray grabs and moves the same planet and the board handle again',
      r.regrab.planet.held &&
        r.regrab.planet.grabbed.includes(`Body ${r.regrab.planet.body}`) &&
        r.regrab.planet.movedBoard >= 0.1 &&
        r.regrab.handle.held &&
        r.regrab.handle.grabbed.includes('BoardHandle') &&
        r.regrab.handle.movedM >= 0.03,
      r.regrab,
    );
    check(
      'real-object: armed, a ray pinch on Height + only presses it (no new well, height +1 cm, still armed)',
      r.panelPinch.wells[0] === r.panelPinch.wells[1] &&
        r.panelPinch.heights[0] !== null &&
        Math.abs(r.panelPinch.heights[1] - r.panelPinch.heights[0] - 0.01) < 1e-6 &&
        r.panelPinch.armedAfter,
      r.panelPinch,
    );
    check(
      "real-object: armed, the hand 25 cm above the board and the HUD behind the cup, a pinch at the cup's top places the well",
      r.behindPanel.hovered.includes('hud-panel') &&
        r.behindPanel.reticle?.hit === 'object' &&
        r.behindPanel.wells === 1 &&
        r.behindPanel.well?.kind === 'object' &&
        r.behindPanel.axisDistanceM <= CUP.radius + 0.02 &&
        !r.behindPanel.armedAfter,
      r.behindPanel,
    );
    check(
      'real-object: that pinch does not also press the HUD Launch behind the cup (no launch), and the next ray click on Launch launches',
      r.behindPanel.attempts[0] === r.behindPanel.attempts[1] &&
        r.behindPanel.phase !== 'flying' &&
        !r.behindPanel.confirmPinchAfter.right &&
        r.behindPanel.nextClick.hovered.includes('hud-panel') &&
        r.behindPanel.nextClick.attempts === r.behindPanel.attempts[1] + 1,
      { attempts: r.behindPanel.attempts, phase: r.behindPanel.phase, confirmPinchAfter: r.behindPanel.confirmPinchAfter, nextClick: r.behindPanel.nextClick },
    );
    check(
      "real-object: armed, with the Your Table panel's Clear wells behind the cup, a pinch at the cup's top places the well and does not clear it",
      r.behindSandboxPanel.reticle?.hit === 'object' &&
        r.behindSandboxPanel.hovered.includes('sandbox-panel') &&
        r.behindSandboxPanel.wells.length === 1 &&
        r.behindSandboxPanel.wells[0] === 'object' &&
        r.behindSandboxPanel.status === 'Well placed: launch to hear it' &&
        !r.behindSandboxPanel.armedAfter &&
        !r.behindSandboxPanel.confirmPinchAfter.right,
      r.behindSandboxPanel,
    );
    check(
      'real-object: a fingertip poke on Make well with the left hand arms the left hand (the right hand pinched last)',
      r.pokeArm.armed && r.pokeArm.armHand === 'left',
      r.pokeArm,
    );
    check(
      "real-object: a late miss (hits while armed, none at the pinch) gives a centered puck and 'Nothing in reach'",
      r.lateMiss.firstHit === 'object' &&
        r.lateMiss.reticleVisible === false &&
        r.lateMiss.wells.length === 1 &&
        r.lateMiss.wells[0].kind === 'puck' &&
        Math.hypot(r.lateMiss.wells[0].position[0], r.lateMiss.wells[0].position[2]) < 1e-6 &&
        r.lateMiss.status === 'Nothing in reach: aim at an object on the board' &&
        !r.lateMiss.armedAfter,
      r.lateMiss,
    );
  },

  // 15c. Depth occlusion: registered, feature-detected, its cost on and off.
  async occlusion() {
    await seat();
    const o = await occlusionCost({ cup: CUP, tableHead: TABLE_HEAD, takeShot: (name) => screenshot(name) });
    const file = path.join(RESULTS, 'render-stats-occlusion.json');
    const fpsDrop = o.on.fps && o.off.fps ? round((o.off.fps - o.on.fps) / o.off.fps, 3) : null;
    writeFileSync(file, JSON.stringify({ room: 'sunlit_living_room', head: TABLE_HEAD, budget: BUDGET, status: o.status, on: o.on, off: o.off, fpsDrop, shaderErrors: o.shaderErrors, shaderWarnings: o.shaderWarnings }, null, 2));
    summary.data.occlusion = { file, ...o, fpsDrop };
    check('occlusion: DepthSensingSystem registered and depth-sensing granted', o.status.systemRegistered && o.status.featureEnabled, o.status);
    check('occlusion: occludable board entities', o.status.occludableEntities >= 4, o.status.occludableEntities);
    console.log(`occlusion: depth frames on ${o.on.depthFrames}, off ${o.off.depthFrames}; uniforms bound ${o.on.status.uniformsBound}`);
    if (o.on.depthFrames > 0) {
      check('occlusion: the shared uniforms get occlusionEnabled and a depth texture', o.on.status.uniformsBound, o.on.status);
      check('occlusion: setOcclusion(false) clears occlusionEnabled', o.off.status.enabled === false && o.off.status.occlusionEnabledUniform === false, o.off.status);
      check('occlusion: screenshots on and off', Boolean(o.shotOn && o.shotOff), { on: o.shotOn, off: o.shotOff });
    }
    check('occlusion: no shader compile or link errors in the console', o.shaderErrors.length === 0, { errors: o.shaderErrors.slice(0, 5), warnings: o.shaderWarnings.length });
    check('occlusion: XR calls and triangles within budget with occlusion on', o.on.max.calls <= BUDGET.calls && o.on.max.triangles <= BUDGET.triangles, o.on.max);
    check('occlusion: frame rate drop with occlusion on at most 30%', fpsDrop === null || fpsDrop <= 0.3, { on: o.on.fps, off: o.off.fps, fpsDrop });
  },

  // 16. Hand models from our own origin (D3) in an immersive-ar hands session.
  async 'hands-cdn'() {
    const r = await handsCdn();
    summary.data.handsCdn = r;
    check('hands-cdn: immersive-ar hands session', r.sessionMode === 'immersive-ar', r.sessionMode);
    check('hands-cdn: local generic-hand right.glb requested', r.localRight.length > 0, r.localRight);
    check('hands-cdn: no jsDelivr requests', r.jsdelivr.length === 0, r.jsdelivr);
    check('hands-cdn: no cross-origin resource requests', r.crossOrigin.length === 0, { origin: r.origin, crossOrigin: r.crossOrigin });
    check('hands-cdn: right hand visual loaded', r.handVisuals?.right === true, r.handVisuals);
  },

  // 17. The immersive-vr fallback: opaque session with the starfield, then
  // VR from a fresh desktop page (R5).
  async vr() {
    const vr = await vrStarfield(() => screenshot('iwer-vr-starfield.png'));
    summary.data.vr = vr;
    check('immersive-vr session starts (the HUD fallback when AR is missing)', vr.sessionMode === 'immersive-vr' && vr.appMode === 'immersive-vr', vr.sessionMode);
    check('immersive-vr: opaque blend and the starfield is drawn', vr.blendMode === 'opaque' && vr.starfieldVisible, { blendMode: vr.blendMode, starfieldVisible: vr.starfieldVisible });
    check('immersive-vr: draw calls and triangles within budget', vr.renderer.calls <= BUDGET.calls && vr.renderer.triangles <= BUDGET.triangles, vr.renderer);

    const fresh = await vrFromFreshPage();
    summary.data.vrFreshPage = fresh;
    check(
      'immersive-vr from a fresh desktop page places the board ahead of the head',
      fresh.sessionMode === 'immersive-vr' &&
        fresh.appMode === 'immersive-vr' &&
        ['fallback', 'table-plane', 'horizontal-plane'].includes(fresh.boardSource) &&
        fresh.aheadM >= 0.2,
      fresh,
    );
  },

  // 18. The ?debug=1 tester overlay (F6): DOM on desktop, panel in XR.
  async 'debug-overlay'() {
    const d = await debugOverlay({ cup: CUP, tableHead: TABLE_HEAD, takeShot: (name) => screenshot(name) });
    summary.data.debugOverlay = d;
    check('debug-overlay: the page URL carries ?debug=1', d.search === '?debug=1', d.search);
    check('debug-overlay: desktop DOM overlay shows fps', /fps \d+\.\d avg/.test(d.desktop?.text ?? ''), d.desktop);
    check('debug-overlay: ecs find finds the overlay panel entity', d.entityIndex !== null && d.entityIndex !== undefined, d.entity);
    check('debug-overlay: XR panel shows fps and the 1% low', /fps \d+\.\d avg \| 1% low \d+\.\d/.test(d.fpsText), d.fpsText.slice(0, 300));
    check('debug-overlay: XR panel shows calls and triangles', /calls \d+ \| tris \d+k/.test(d.renderText), d.renderText.slice(0, 300));
    check('debug-overlay: DOM overlay hidden in XR', d.domInXr?.display === 'none', d.domInXr);
    check(
      'debug-overlay: armed in Your Table the hit line shows the height and jitter',
      /hit \d+\.\d cm above board \| jitter \d+\.\d mm \(\d+ frames\)/.test(d.hitText),
      { hitText: d.hitText.slice(0, 300), hitLog: d.hitLog, reticle: d.reticle?.hit },
    );
    check('debug-overlay: screenshot saved', Boolean(d.shot), d.shot);
    const samples = [...d.budget.sandboxArmed, ...d.budget.level6Flight];
    writeFileSync(path.join(RESULTS, 'render-stats-debug-overlay.json'), JSON.stringify({ room: 'sunlit_living_room', head: TABLE_HEAD, budget: BUDGET, ...d.budget }, null, 2));
    check(
      'debug-overlay: XR calls and triangles within budget with the overlay shown, occlusion on and off (Your Table armed, level 6 flight)',
      samples.length === 4 && samples.every((s) => s.frames > 0 && s.max.calls > 0 && s.max.calls <= BUDGET.calls && s.max.triangles <= BUDGET.triangles),
      samples.map((s) => ({ occlusion: s.occlusion, level: s.level ?? 'sandbox', max: s.max, frames: s.frames })),
    );
    check('debug-overlay: without ?debug=1 there is no overlay', d.plain === null && !String(d.searchAfter).includes('debug'), { search: d.searchAfter, plain: d.plain });
  },

  // 19. XR draw calls with the level select open over the busiest views,
  // plain and with ?debug=1 (the URL testers use).
  async 'level-select-budget'() {
    const runs = [];
    for (const search of ['', '?debug=1']) {
      if (xr('status').sessionActive) await exitXR();
      if (game('page.search').value !== search) await navigateSearch(search);
      const shotName = search ? 'iwer-level-select-chapter-debug.png' : 'iwer-level-select-chapter.png';
      const r = await levelSelectBudget({ tableHead: TABLE_HEAD, takeShot: (name) => screenshot(name), shotName });
      runs.push({ search: game('page.search').value, ...r });
    }
    if (game('page.search').value !== '') await navigateSearch('');
    summary.data.levelSelectBudget = runs;
    writeFileSync(path.join(RESULTS, 'render-stats-level-select.json'), JSON.stringify({ room: 'sunlit_living_room', head: TABLE_HEAD, budget: BUDGET, runs }, null, 2));
    const views = runs.flatMap((r) => r.views.map((v) => ({ search: r.search, ...v })));
    const intended = {
      'level 1, ghost hand': (v) => v.level === 'c1-l1' && v.mode === 'story' && v.ghostHand,
      'level 6 placing': (v) => v.level === 'c1-l6' && v.mode === 'story' && !v.chapter,
      'chapter complete': (v) => v.chapter,
      'Your Table armed': (v) => v.mode === 'sandbox' && v.armed,
    };
    const brief = views.map((v) => ({ search: v.search, view: v.view, open: v.open, state: { level: v.level, mode: v.mode, ghostHand: v.ghostHand, chapter: v.chapter, armed: v.armed }, on: v.on.max, off: v.off.max, frames: [v.on.frames, v.off.frames] }));
    check(
      'level-select-budget: the level select opens over level 1 with the ghost hand, level 6, the chapter moment and Your Table armed (plain and ?debug=1)',
      runs.length === 2 && runs[1].search === '?debug=1' && views.length === 8 && views.every((v) => v.open && intended[v.view]?.(v)),
      brief,
    );
    check(
      `level-select-budget: XR calls <= ${BUDGET.calls} and triangles <= ${BUDGET.triangles} in each of those views, occlusion on and off`,
      views.length === 8 &&
        views.every((v) => [v.on, v.off].every((s) => s.frames > 0 && s.max.calls > 0 && s.max.calls <= BUDGET.calls && s.max.triangles <= BUDGET.triangles)),
      brief,
    );
  },

  // 20. Accessibility settings (Phase 3): the Settings page by ray and
  // poke, then each mode alone with its screenshot. Last, because the save
  // keeps the settings (the scenario restores the defaults).
  async accessibility() {
    if (game('page.search').value !== '') await navigateSearch('');
    const r = await accessibilitySettings({ tableHead: TABLE_HEAD, takeShot: (name) => screenshot(name) });
    summary.data.accessibility = r;
    const c = r.clicked;
    check(
      "accessibility: a hand-ray click on the HUD 'levels-button' opens the level select and a fingertip poke on 'settings-button' opens the Settings page",
      c.page === 'settings' && Boolean(r.shots.panelShot),
      { page: c.page, contactMs: c.settingsContactMs, hovered: c.openHovered, shot: r.shots.panelShot },
    );
    check(
      'accessibility: the Settings page fits the level-select size (46 x 28 cm)',
      Array.isArray(r.panel.size) && r.panel.size[0] <= 0.461 && r.panel.size[1] <= 0.28,
      { size: r.panel.size && round(r.panel.size), position: r.panel.position && round(r.panel.position) },
    );
    check(
      "accessibility: a fingertip poke on 'left-handed-button' turns left-handed on and mirrors the ghost hand",
      c.settings.leftHanded === true && c.ghostHandLeft === true,
      { contactMs: c.leftContactMs, leftHanded: c.settings.leftHanded, ghostHandLeft: c.ghostHandLeft },
    );
    check(
      'accessibility: hand-ray clicks turn high contrast and reduced motion on, set the board to large, mute and raise the volume',
      c.settings.highContrast === true &&
        c.settings.reducedMotion === true &&
        c.settings.boardSize === 'large' &&
        c.settings.muted === true &&
        Math.abs(c.settings.volume - 0.9) < 1e-9 &&
        c.muted === true &&
        c.highContrast === 1 &&
        c.outlinesVisible === true &&
        c.trailFade === 1e9 &&
        c.radius[1] > c.radius[0],
      c,
    );
    check('accessibility: Back returns to the levels page and Close closes the panel', r.backPage === 'levels' && r.closed, { backPage: r.backPage, closed: r.closed });
    check(
      'accessibility: left-handed alone: the ghost hand mid-carry is the mirrored left hand (screenshot)',
      r.left.held && r.left.visible && r.left.ghostHandLeft && Boolean(r.shots.leftShot),
      { ...r.left, shot: r.shots.leftShot },
    );
    const k = r.contrast;
    check(
      `accessibility: high contrast alone shows the body outlines and the target outline; XR calls <= ${BUDGET.calls} and triangles <= ${BUDGET.triangles} off and on (screenshots)`,
      k.highContrast === 1 &&
        k.outlinesVisible &&
        k.targetOutlineVisible &&
        [k.off, k.on].every((m) => m && m.calls > 0 && m.calls <= BUDGET.calls && m.triangles <= BUDGET.triangles) &&
        Boolean(r.shots.contrastShot && r.shots.contrastOffShot),
      { ...k, shots: [r.shots.contrastOffShot, r.shots.contrastShot] },
    );
    const plane = (summary.data.planes ?? []).find((p) => p.id === ctx.table?.planeId);
    const cap = plane ? BOARD.tableCapFill * Math.min(plane.size[0], plane.size[1]) : null;
    const [small, medium, large] = r.sizes;
    check(
      'accessibility: board small < medium < large on the table plane, about its center, large within the table-size cap (screenshots)',
      r.sizes.length === 3 &&
        r.sizes.every((x) => x.source === 'table-plane' && Boolean(x.shot) && dist(x.center, medium.center) < 1e-3) &&
        Math.abs(small.radius - medium.radius * BOARD_SIZE_SCALE.small) < 1e-3 &&
        large.radius > medium.radius &&
        cap !== null &&
        large.radius <= cap + 1e-3 &&
        Math.abs(large.radius - Math.min(cap, medium.radius * BOARD_SIZE_SCALE.large)) < 1e-3,
      { sizes: r.sizes.map((x) => ({ size: x.size, radius: x.radius, source: x.source })), cap: cap && round(cap), planeSize: plane?.size },
    );
    const m = r.motion;
    check(
      'accessibility: reduced motion alone: the decorative clock, the target star and the bodies stand still, the trail is static and the chapter moment has no burst (screenshots)',
      m.still.motionTime[0] === m.still.motionTime[1] &&
        m.still.targetStarYaw[0] === m.still.targetStarYaw[1] &&
        m.still.bodyYaw[0] === m.still.bodyYaw[1] &&
        m.trailFade === 1e9 &&
        m.chapter.every((x) => x.shown && Math.abs(x.starHeight - 0.5) < 1e-3 && x.starSpin === 0) &&
        Boolean(r.shots.trailShot && r.shots.chapterShot),
      { ...m, shots: [r.shots.trailShot, r.shots.chapterShot] },
    );
    check(
      'accessibility: settings back to the defaults afterwards (medium board, nothing on)',
      JSON.stringify(r.restored.settings) === JSON.stringify(DEFAULT_TEST_SETTINGS) && !r.restored.chapter,
      r.restored,
    );
  },

  // The surrounding cosmos: the AR fade-in, the Room view modes, Your
  // Table, reduced motion and VR.
  async cosmos() {
    if (game('page.search').value !== '') await navigateSearch('');
    const r = await cosmosModes({ tableHead: TABLE_HEAD, takeShot: (name) => screenshot(name) });
    summary.data.cosmos = r;
    const f = r.fade;
    check(
      'cosmos: an AR session fades the cosmos in over the room (fade below 0.5 about 0.5 s after the start, 1 from 3 s on)',
      f.first !== null && f.first < 0.5 && f.atHalfSecond >= 0 && f.atHalfSecond < 0.5 && f.atThreeSeconds === 1 && f.after3s.length > 0 && f.after3s.every((x) => x === 1),
      { ...f, after3s: f.after3s.length },
    );
    const m = r.mixed;
    check(
      'cosmos: Mixed (the default) at the table pose: drawn, opacity 1, the island mask, and the table area clear (boardMask 0)',
      m.board === 'table-plane' && m.roomView === 'mixed' && m.visible && m.opacity === 1 && m.mask === 'island' && m.boardMask === 0 && Boolean(m.shot && r.mixedAhead),
      m,
    );
    check(
      'cosmos: Mixed: the room shows only through the window over the board and table (eye level 70° beside the board and the floor beside the table are space: sideMask 1, floorMask 1)',
      m.sideMask === 1 && m.floorMask === 1 && m.island && m.island.clearM > 0 && m.island.fullM > m.island.clearM,
      { sideMask: m.sideMask, floorMask: m.floorMask, island: m.island },
    );
    check('cosmos: Space: no mask (the room fills with space)', r.space.roomView === 'space' && r.space.visible && r.space.mask === 'none' && r.space.opacity === 1, r.space);
    check(
      'cosmos: Room: the cosmos is not drawn and costs no draw calls',
      r.room.roomView === 'room' && !r.room.visible && r.room.maxCalls < m.maxCalls,
      { room: r.room.maxCalls, mixed: m.maxCalls, visible: r.room.visible },
    );
    check(
      'cosmos: Your Table over passthrough: opacity at most 0.45 with the island mask and a wider window than Mixed',
      r.yourTable.mode === 'sandbox' && r.yourTable.visible && r.yourTable.opacity <= 0.45 && r.yourTable.mask === 'island' && r.yourTable.island.clearM > m.island.clearM,
      r.yourTable,
    );
    const d = r.reduced;
    check(
      'cosmos: reduced motion: the orbiting planets and the belt stand still and no shooting star flies; they move again after',
      JSON.stringify(d.motion[0]) === JSON.stringify(d.motion[1]) && d.shootingStars.every((n) => n === 0) && JSON.stringify(d.movingAfter) !== JSON.stringify(d.motion[1]),
      d,
    );
    check(
      'cosmos: immersive-vr: the cosmos is drawn fully opaque with no mask',
      r.vr.session === 'immersive-vr' && r.vr.blendMode === 'opaque' && r.vr.visible && r.vr.opacity === 1 && r.vr.mask === 'none',
      r.vr,
    );
    const textures = await waitFor('the space textures settled', () => {
      const t = snapshot().textures;
      return t && t.requested.length > 0 && t.loaded.length + t.failed.length === t.requested.length ? t : null;
    }, 30_000, 500).catch(() => snapshot().textures);
    summary.data.textures = textures;
    check(
      'cosmos: the vendored space textures: every requested id loaded (same origin), none failed',
      textures.requested.length === 4 && textures.failed.length === 0 && textures.requested.every((id) => textures.loaded.includes(id)),
      textures,
    );
  },

  // 21. Render numbers of the busiest views with ?debug=1, in AR at the
  // table pose and in VR (the before/after budget table in the notes).
  async 'budget-views'() {
    const r = await budgetViews({ tableHead: TABLE_HEAD, takeShot: (name) => screenshot(name) });
    summary.data.budgetViews = r;
    writeFileSync(path.join(RESULTS, 'render-stats-cosmos.json'), JSON.stringify({ room: 'sunlit_living_room', head: TABLE_HEAD, budget: BUDGET, ...r }, null, 2));
    const views = r.passes.flatMap((p) => p.views.map((v) => ({ session: p.session, ...v })));
    const brief = views.map((v) => ({ session: v.session, view: v.view, max: { calls: v.max.calls, triangles: v.max.triangles }, fps: v.fps, frames: v.frames }));
    const intended = {
      'level 6 mid-flight': (v) => v.level === 'c1-l6' && v.mode === 'story',
      'chapter complete': (v) => v.chapter,
      'Your Table, 3 wells': (v) => v.mode === 'sandbox' && v.wells === 3,
      'level select open': (v) => v.levelSelectOpen,
    };
    check(
      'budget-views: with ?debug=1, level 6 mid-flight, the chapter moment, Your Table with 3 wells and the level select open, in immersive-ar then immersive-vr',
      r.search === '?debug=1' && r.passes.length === 2 && r.passes[0].appMode === 'immersive-ar' && r.passes[1].appMode === 'immersive-vr' &&
        views.length === 8 && views.every((v) => intended[v.view]?.(v)),
      views.map((v) => ({ session: v.session, view: v.view, level: v.level, mode: v.mode, phase: v.phase, chapter: v.chapter, open: v.levelSelectOpen, wells: v.wells })),
    );
    check(
      `budget-views: XR calls <= ${BUDGET.calls} and triangles <= ${BUDGET.triangles} in each of those views`,
      views.length === 8 && views.every((v) => v.frames > 0 && v.max.calls > 0 && v.max.calls <= BUDGET.calls && v.max.triangles <= BUDGET.triangles),
      brief,
    );
  },

  // 22. Meta VR Glasses (iwsdk-glasses-test): the metaVRGlasses emulator
  // profile, every surface inside its view (37° left/right, 25° up, 43°
  // down) at the fallback and table poses, level 1 and every in-XR button
  // by gaze plus pinch, and field-of-view-masked screenshots.
  async glasses() {
    if (game('page.search').value !== '') await navigateSearch('');
    const r = await glassesFit({ tableHead: TABLE_HEAD, fallbackHead: FALLBACK_HEAD, takeShot: (name) => screenshot(name) });
    summary.data.glasses = r;
    const d = r.device;
    check(
      "glasses: the emulator runs 'Meta VR Glasses' with an immersive-ar session, 'gaze-tracking' granted and a connected gaze source",
      d.deviceName === 'Meta VR Glasses' && d.sessionActive && d.sessionMode === 'immersive-ar' && d.gazeGranted && d.gazeConnected,
      { deviceName: d.deviceName, before: d.before, sessionMode: d.sessionMode, gazeGranted: d.gazeGranted, gazeConnected: d.gazeConnected, restartMs: d.restartMs },
    );
    const fit = (label) => r.fits.find((f) => f.label === label);
    const brief = (f) => f && { boardSource: f.boardSource, head: f.head, ...Object.fromEntries(Object.entries(f.surfaces).map(([k, s]) => [k, { h: s.h, v: s.v, marginDeg: s.marginDeg }])) };
    const allFit = (labels, required) =>
      labels.every((label) => {
        const f = fit(label);
        return f && required[label].every((name) => f.surfaces[name]?.fits);
      });
    const FALLBACK = {
      'fallback: level 1': ['board', 'hud', 'rimButton'],
      'fallback: level select': ['board', 'hud', 'rimButton', 'levelSelect'],
      'fallback: Settings page': ['settings'],
      'fallback: Your Table': ['board', 'hud', 'rimButton', 'yourTable'],
    };
    const TABLE = {
      'table: level 1': ['board', 'hud', 'rimButton'],
      'table: level select': ['levelSelect'],
      'table: Settings page': ['settings'],
      'table: Your Table': ['board', 'hud', 'rimButton', 'yourTable'],
    };
    check(
      `glasses: at the fallback pose (head 1.2 m up, level gaze) the board, HUD, near-rim button, level select, Settings page and Your Table panel fit the view (every corner ${GLASSES_VIEW.marginDeg}° inside)`,
      fit('fallback: level 1')?.boardSource === 'fallback' && allFit(Object.keys(FALLBACK), FALLBACK),
      Object.keys(FALLBACK).map((label) => ({ label, ...brief(fit(label)) })),
    );
    check(
      `glasses: seated at the coffee table looking at the board, the same six surfaces fit the view (every corner ${GLASSES_VIEW.marginDeg}° inside)`,
      fit('table: level 1')?.boardSource === 'table-plane' && allFit(Object.keys(TABLE), TABLE),
      Object.keys(TABLE).map((label) => ({ label, ...brief(fit(label)) })),
    );
    const l = r.level1;
    check(
      'glasses: level 1 by gaze plus pinch: the gaze hovers planet 1, a right-hand pinch grabs it, the hand carries it to the solution and the release solves the level',
      l.hoverPlanet.includes(`Body ${l.body}`) && l.heldAfterPinch && l.heldWhileMoving && l.error <= 0.03 && l.attempts[1] === l.attempts[0] + 1 && l.solved,
      l,
    );
    const PANELS = {
      hud: ['launch-button', 'next-button', 'levels-button', 'play-again-button'],
      'rim-button': ['rim-launch-button'],
      'level-select': ['level-1', 'level-2', 'level-3', 'level-4', 'level-5', 'level-6', 'sandbox-button', 'settings-button', 'close-levels'],
      settings: ['left-handed-button', 'contrast-button', 'motion-button', 'board-size-button', 'mute-button', 'volume-down', 'volume-up', 'quiet-button', 'settings-back'],
      'sandbox-panel': ['make-well', 'add-puck', 'height-down', 'height-up', 'clear-wells', 'next-target', 'exit-sandbox'],
    };
    const entityOf = { hud: 'hud-panel', 'rim-button': 'rim-button', 'level-select': 'level-select', settings: 'level-select', 'sandbox-panel': 'sandbox-panel' };
    for (const [panel, ids] of Object.entries(PANELS)) {
      const records = ids.map((id) => ({ id, presses: r.presses.filter((p) => p.id === id) }));
      check(
        `glasses: gaze plus pinch presses every ${panel} button (gaze hovers '${entityOf[panel]}', the pinch clicks, the state changes)`,
        records.every((x) => x.presses.length > 0 && x.presses.every((p) => p.ok && p.hovered.includes(entityOf[panel]))),
        records.map((x) => ({ id: x.id, ok: x.presses.map((p) => p.ok), hand: [...new Set(x.presses.map((p) => p.hand))], hovered: x.presses[0]?.hovered })),
      );
    }
    check(
      'glasses: Make well armed by gaze plus pinch; the next pinch places a well or puck and disarms',
      r.confirm.wells[1] === r.confirm.wells[0] + 1 && !r.confirm.armedAfter,
      r.confirm,
    );
    const left = r.presses.filter((p) => p.hand === 'hand-left');
    check('glasses: a left-hand pinch also clicks the gazed button (Close)', left.length > 0 && left.every((p) => p.ok), left);
    const f = r.fallback;
    check(
      'glasses: with gaze disconnected the hand ray clicks Levels; reconnected, gaze targets again and Close closes the panel',
      f.gazeConnected[0] === false && f.gazeConnected[1] === true && f.handHovered.includes('hud-panel') && f.openedByHand && f.closeByGaze.ok && f.closeByGaze.hovered.includes('level-select'),
      f,
    );
    check(
      "glasses: the console shows 'gaze-tracking' granted and the gaze source, and no errors",
      r.gazeLines.some((x) => x.includes('granted')) && r.gazeLines.some((x) => x.includes('XRInputSource appeared')) && (r.errors === null || r.errors.length === 0),
      { gazeLines: r.gazeLines, errors: r.errors },
    );
    check('glasses: field-of-view-masked screenshots saved', Object.values(r.shots).length === 7 && Object.values(r.shots).every(Boolean), r.shots);
    check(
      'glasses: settings back to the defaults and the emulator back to the Quest 3 profile',
      JSON.stringify(r.restoredSettings) === JSON.stringify(DEFAULT_TEST_SETTINGS) && r.restored?.deviceName === 'Meta Quest 3',
      { settings: r.restoredSettings, restored: r.restored },
    );
  },
};

/**
 * After the glasses group's in-place Vite restarts (it edits
 * iwsdk.config.json), `dev down` reports the runtime stopped but leaves the
 * first Vite process running with no listener, and its npm wrapper waiting
 * on it. Stops this workspace's Vite processes (the wrapper then exits) and
 * returns their ids. Windows only, like the rest of this runner's setup.
 */
function stopOrphanVite() {
  if (process.platform !== 'win32') return [];
  const script = [
    `$root = '${root.replaceAll("'", "''").toLowerCase()}'`,
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" |",
    "  Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains($root) -and $_.CommandLine -match 'vite[\\\\/]bin[\\\\/]vite\\.js' } |",
    '  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }',
  ].join('\n');
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 60_000 });
    return out.split(/\s+/).filter(Boolean).map(Number);
  } catch (error) {
    return [`failed: ${String(error?.message ?? error).slice(0, 200)}`];
  }
}

async function main() {
  const selected = selectedGroups(process.argv.slice(2));
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(RESULTS, { recursive: true });

  // 1. Setup: a clean managed runtime (stop a leftover one first).
  if (call(['dev', 'status']).state?.running) call(['dev', 'down'], { timeoutMs: 60_000 });
  const up = () => call(['dev', 'up', '--ai-mode', 'agent', '--allow-browser-automation'], { timeoutMs: 180_000 });
  for (let attempt = 1; ; attempt++) {
    try {
      up();
      break;
    } catch (error) {
      // Right after a previous `dev down` (or under memory pressure) the owner
      // probe can time out although the runtime did start.
      const state = run(['dev', 'status']).data?.state;
      if (state?.running || state?.starting) {
        console.log('dev up reported an error but the runtime is running; continuing');
        break;
      }
      if (attempt >= 3) throw error;
      console.log(`dev up failed (attempt ${attempt}), retrying in 10 s: ${String(error.message).slice(0, 200)}`);
      await sleep(10_000);
    }
  }
  await waitFor('browserCommandReady', () => call(['dev', 'status']).state?.browserCommandReady, 120_000, 1000);
  await waitFor('window.__game ready', () => snapshot().levelBuilt, 60_000, 1000);

  for (const name of GROUPS) {
    if (!selected.has(name)) continue;
    console.log(`--- group ${name}`);
    summary.groups.push(name);
    if (ALWAYS.has(name)) {
      await GROUP_RUNNERS[name]();
      continue;
    }
    try {
      await GROUP_RUNNERS[name]();
    } catch (error) {
      check(`${name}: group ran to completion`, false, String(error?.message ?? error).slice(0, 500));
      // Leave no pinch held for the next group.
      for (const device of ['hand-left', 'hand-right']) await letGo(device).catch(() => null);
    }
  }

  summary.ok = summary.checks.every((c) => c.pass);
}

let exitCode = 1;
try {
  await main();
  exitCode = summary.ok ? 0 : 1;
} catch (error) {
  summary.error = String(error?.stack ?? error);
  console.error(error);
} finally {
  // The glasses group restores iwsdk.config.json itself; this covers a crash.
  if (restoreEmulatorDevice()) console.log('restored dev.emulator.device in iwsdk.config.json');
  try {
    run(['xr', 'exit'], { input: {} });
  } catch {
    // no session or no runtime
  }
  let stillRunning = true;
  for (let attempt = 1; attempt <= 2 && stillRunning; attempt++) {
    try {
      run(['dev', 'down'], { timeoutMs: 60_000 });
    } catch (error) {
      console.error(`dev down failed (attempt ${attempt})`, error);
    }
    try {
      stillRunning = Boolean(run(['dev', 'status']).data?.state?.running);
    } catch {
      stillRunning = true;
    }
    if (stillRunning && attempt < 2) await sleep(5000);
  }
  summary.runtimeStopped = !stillRunning;
  if (stillRunning) exitCode = 1;
  else if (summary.groups.includes('glasses')) summary.orphanViteStopped = stopOrphanVite();
  writeFileSync(path.join(RESULTS, 'verify-iwer-summary.json'), JSON.stringify(summary, null, 2));
  const { planes: _planes, ...printed } = summary.data; // full list stays in the summary file
  console.log(JSON.stringify({ ok: summary.ok && exitCode === 0, groups: summary.groups, checks: summary.checks.length, failed: summary.checks.filter((c) => !c.pass).map((c) => c.name), runtimeStopped: summary.runtimeStopped, error: summary.error }, null, 2));
  console.log(JSON.stringify(printed));
  process.exit(exitCode);
}
