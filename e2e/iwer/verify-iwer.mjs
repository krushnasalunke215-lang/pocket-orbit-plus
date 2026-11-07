// IWER (emulated Quest 3) verification through the IWSDK CLI managed runtime,
// in named groups: placement (fallback, then the table plane in the
// sunlit_living_room SEM room), hand-solve (a hand-ray grab of planet 1 to the
// level-1 solution), poke (Launch), render (XR render stats), spike (the
// real-object probes), gate (off-board snap-back), near-pinch, tracking (hand
// lost mid-hold), levels (2-3 by hand), handle (the board handle), rim (the
// near-rim Launch button), audio (context running in XR, flyby and chord
// events after a hand solve), hands-cdn (hand models from our own origin) and
// vr (the immersive-vr fallback, also from a fresh desktop page).
// Setup, placement and the runtime teardown always run; the runtime is always
// stopped.
// Usage: npm run verify:iwer
//        node e2e/iwer/verify-iwer.mjs --only=rim,hands-cdn
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tsImport } from 'tsx/esm/api';
import { call, run, sleep } from './cli.mjs';
import {
  enterXR,
  exitXR,
  game,
  letGo,
  RESULTS,
  rayDrag,
  round,
  screenshot as saveScreenshot,
  SHOTS,
  snapshot,
  vec,
  waitFor,
  xr,
} from './xr-helpers.mjs';
import {
  handleDrag,
  handsCdn,
  nearPinch,
  offBoardRelease,
  rimButton,
  solveLevelsByHand,
  trackingLoss,
  vrFromFreshPage,
  vrStarfield,
} from './xr-scenarios.mjs';

const { boardRadiusForTable } = await tsImport('../../src/game/placement.ts', import.meta.url);
const { BOARD, RENDER_BUDGET } = await tsImport('../../src/config.ts', import.meta.url);

const TABLE_HEAD = { x: 0, y: 1.15, z: -1.2 };
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
  'handle',
  'rim',
  'audio',
  'hands-cdn',
  'vr',
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

  // 15. Hand models from our own origin (D3) in an immersive-ar hands session.
  async 'hands-cdn'() {
    const r = await handsCdn();
    summary.data.handsCdn = r;
    check('hands-cdn: immersive-ar hands session', r.sessionMode === 'immersive-ar', r.sessionMode);
    check('hands-cdn: local generic-hand right.glb requested', r.localRight.length > 0, r.localRight);
    check('hands-cdn: no jsDelivr requests', r.jsdelivr.length === 0, r.jsdelivr);
    check('hands-cdn: no cross-origin resource requests', r.crossOrigin.length === 0, { origin: r.origin, crossOrigin: r.crossOrigin });
    check('hands-cdn: right hand visual loaded', r.handVisuals?.right === true, r.handVisuals);
  },

  // 16. The immersive-vr fallback: opaque session with the starfield, then
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
};

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
  writeFileSync(path.join(RESULTS, 'verify-iwer-summary.json'), JSON.stringify(summary, null, 2));
  const { planes: _planes, ...printed } = summary.data; // full list stays in the summary file
  console.log(JSON.stringify({ ok: summary.ok && exitCode === 0, groups: summary.groups, checks: summary.checks.length, failed: summary.checks.filter((c) => !c.pass).map((c) => c.name), runtimeStopped: summary.runtimeStopped, error: summary.error }, null, 2));
  console.log(JSON.stringify(printed));
  process.exit(exitCode);
}
