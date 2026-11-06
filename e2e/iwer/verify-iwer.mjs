// IWER (emulated Quest 3) verification through the IWSDK CLI managed runtime:
// fallback placement, table-plane placement in the sunlit_living_room SEM room,
// a hand-ray grab of planet 1 to the level-1 solution, a poke on Launch, XR
// render stats and the real-object spike probes. Always stops the runtime.
// Usage: npm run verify:iwer
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tsImport } from 'tsx/esm/api';
import { call, root, run, sleep } from './cli.mjs';

const { boardToWorld } = await tsImport('../../src/game/board-math.ts', import.meta.url);
const { boardRadiusForTable } = await tsImport('../../src/game/placement.ts', import.meta.url);
const { BOARD, RENDER_BUDGET } = await tsImport('../../src/config.ts', import.meta.url);

const SHOTS = path.join(root, '.agents', 'tasks', 'screenshots', 'phase1');
const RESULTS = path.join(root, 'test-results');
const REQUEST = path.join(root, 'e2e', 'iwer', '.request.json');
const TABLE_HEAD = { x: 0, y: 1.15, z: -1.2 };
// The cup on the sunlit_living_room coffee table: group at z = -1.95, cup at
// local [0.08, 0.512, 0.17], a 0.15 m tall cylinder (radius 0.035-0.045).
const CUP = { x: 0.08, y: 0.512, z: -1.78, height: 0.15, radius: 0.045 };
const BUDGET = { calls: RENDER_BUDGET.maxDrawCalls, triangles: RENDER_BUDGET.maxTriangles };

const summary = { ok: false, checks: [], data: {} };
const check = (name, pass, detail) => {
  summary.checks.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
  return Boolean(pass);
};
const require_ = (name, pass, detail) => {
  if (!check(name, pass, detail)) throw new Error(`required check failed: ${name}`);
};

const xr = (action, input = {}, options) => call(['xr', action], { input, ...options }).result;
const vec = (p) => ({ x: p[0], y: p[1], z: p[2] });
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const round = (v, n = 4) => (Array.isArray(v) ? v.map((x) => round(x, n)) : Number(v.toFixed(n)));

/** One whitelisted window.__game call through `browser run`; returns { value, perfNow }. */
function game(method, ...args) {
  writeFileSync(REQUEST, JSON.stringify({ method, args }));
  const result = call(['browser', 'run', 'e2e/iwer/read-game.mjs', '--timeout', '30000']).result;
  if (result?.error) throw new Error(`__game.${method}: ${result.error}`);
  return result;
}
const snapshot = () => game('snapshot').value;

async function waitFor(label, fn, timeoutMs, intervalMs = 500) {
  const started = Date.now();
  let last;
  for (;;) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}: ${String(last?.message ?? last)}`);
    await sleep(intervalMs);
  }
}

function screenshot(name) {
  const file = path.join(SHOTS, name);
  call(['browser', 'screenshot', '--output-file', file]);
  summary.data.screenshots = [...(summary.data.screenshots ?? []), file];
}

async function enterXR() {
  xr('enter');
  const status = await waitFor('an active XR session', () => {
    const s = xr('status');
    return s.sessionActive ? s : null;
  }, 20_000);
  xr('set-input-mode', { mode: 'hand' });
  await sleep(4000);
  return status;
}

/** Board-normalized point → world meters with the board pose from a snapshot. */
const toWorld = (board, p) => boardToWorld(board, p);

/**
 * Hover planet `body` with `device`, grab it, move the ray end to `solution`
 * (board [x, z]) and release. Returns the measured result.
 */
async function rayDrag(device, body, solution) {
  const isHand = device.startsWith('hand');
  xr('set-input-mode', { mode: isHand ? 'hand' : 'controller' });
  let snap = snapshot();
  const board = snap.board;
  const planet = snap.bodies.find((b) => b.id === body).world;
  // Hold the hand in front of the chest, between the head and the board.
  const head = xr('get-transform', { device: 'headset' }).position;
  const hand = [head.x + 0.15, head.y - 0.2, head.z - 0.15];
  xr('set-transform', { device, position: vec(hand) });

  // C5: aim beside the visible sphere (0.12 board units off the center,
  // perpendicular to the ray): only the invisible collider can be hit there.
  const toPlanet = [planet[0] - hand[0], planet[1] - hand[1], planet[2] - hand[2]];
  const len = Math.hypot(...toPlanet);
  const side = [-toPlanet[2] / len, 0, toPlanet[0] / len];
  const sideLen = Math.hypot(side[0], side[2]);
  const offset = 0.12 * board.radius;
  const beside = [planet[0] + (side[0] / sideLen) * offset, planet[1], planet[2] + (side[2] / sideLen) * offset];
  xr('look-at', { device, target: vec(beside) });
  await sleep(600);
  const hovered = call(['ecs', 'find'], { input: { withComponents: ['Hovered'] } }).result.entities;
  const colliderHover = hovered.some((e) => e.name === `Body ${body}`);
  // Distance from the ray line to the planet center, in board units.
  const u = [beside[0] - hand[0], beside[1] - hand[1], beside[2] - hand[2]];
  const ul = Math.hypot(...u);
  const cx = toPlanet[1] * u[2] - toPlanet[2] * u[1];
  const cy = toPlanet[2] * u[0] - toPlanet[0] * u[2];
  const cz = toPlanet[0] * u[1] - toPlanet[1] * u[0];
  const rayMissBoard = Math.hypot(cx, cy, cz) / ul / board.radius;

  // Grab at the center so the planet lands where the ray end goes.
  xr('look-at', { device, target: vec(planet) });
  await sleep(400);
  xr('set-select-value', { device, value: 1 });
  await sleep(600);
  snap = snapshot();
  const heldAfterSelect = Boolean(snap.bodies.find((b) => b.id === body)?.held);
  if (!heldAfterSelect) {
    xr('set-select-value', { device, value: 0 });
    return { device, colliderHover, rayMissBoard, heldAfterSelect, hovered: hovered.map((e) => e.name) };
  }

  // MoveFromTarget keeps the ray length to the hit point on the collider
  // surface, so the first move lands a few mm short; correct like a person
  // watching the planet would (at most 4 times).
  const d = dist(planet, hand);
  const goal = [solution[0], 0, solution[1]];
  const correction = [0, 0, 0];
  let reached = null;
  let heldWhileMoving = false;
  for (let i = 0; i < 5; i++) {
    const target = toWorld(board, [goal[0] + correction[0], 0, goal[2] + correction[2]]);
    xr('look-at', { device, target: vec(target), moveToDistance: d });
    await sleep(800);
    snap = snapshot();
    const b = snap.bodies.find((x) => x.id === body);
    heldWhileMoving = b.held;
    reached = b.board;
    const ex = goal[0] - reached[0];
    const ez = goal[2] - reached[2];
    if (Math.hypot(ex, ez) <= 0.005) break;
    correction[0] += ex;
    correction[2] += ez;
  }
  const error = Math.hypot(goal[0] - reached[0], goal[2] - reached[2]);
  xr('set-select-value', { device, value: 0 });
  const released = Date.now();
  const solvedSnap = await waitFor('solved', () => {
    const s = snapshot();
    return s.solved ? s : null;
  }, 20_000).catch(() => null);
  return {
    device,
    colliderHover,
    rayMissBoard: round(rayMissBoard),
    heldAfterSelect,
    heldWhileMoving,
    rayDistance: round(d),
    reached: round(reached),
    error: round(error),
    solved: Boolean(solvedSnap),
    solvedAfterMs: solvedSnap ? Date.now() - released : null,
    lastOutcome: (solvedSnap ?? snapshot()).lastOutcome,
  };
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(RESULTS, { recursive: true });

  // 1. A clean managed runtime (stop a leftover one first).
  if (call(['dev', 'status']).state?.running) call(['dev', 'down'], { timeoutMs: 60_000 });
  const up = () => call(['dev', 'up', '--ai-mode', 'agent', '--allow-browser-automation'], { timeoutMs: 180_000 });
  try {
    up();
  } catch (error) {
    // Right after a previous `dev down` the owner probe can time out once.
    console.log(`dev up failed once, retrying in 5 s: ${String(error.message).slice(0, 200)}`);
    await sleep(5000);
    up();
  }
  await waitFor('browserCommandReady', () => call(['dev', 'status']).state?.browserCommandReady, 120_000, 1000);
  await waitFor('window.__game ready', () => snapshot().levelBuilt, 60_000, 1000);

  // 2. Default pose (room origin, facing -Z): the coffee table is out of reach → fallback.
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

  // 3. Seated at the coffee table → the board lands on the 'table' plane.
  xr('set-transform', { device: 'headset', position: TABLE_HEAD, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  xr('exit');
  await waitFor('session end', () => !xr('status').sessionActive, 10_000);
  await enterXR();
  snap = snapshot();
  const planes = game('spike.planes').value;
  summary.data.planes = planes.map((p) => ({ id: p.id, label: p.label, orientation: p.orientation, size: round(p.size, 3), center: round(p.center, 3) }));
  const b = snap.board;
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

  // 4. Hand ray: grab planet 1 and drag it to the level-1 solution.
  const level = game('levels').value[0];
  const movable = snap.bodies.find((x) => x.movable);
  const solution = level.solution[movable.id];
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

  // 5. Poke the Launch/Replay button with the right index finger.
  const targets = xr('list-targets').targets.map((t) => t.name);
  check("'launch-button' is a run-sequence target", targets.includes('launch-button'), targets);
  game('resetRenderStats');
  const attempts = game('watchLaunch.start').value.base;
  const press = xr('run-sequence', {
    device: 'hand-right',
    steps: [{ label: 'poke launch', target: 'launch-button', press: { hold: 0.05, retract: 0.05 } }],
  }, { timeoutMs: 60_000 });
  const poked = snapshot();
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

  // 6. Render stats during that flight.
  const stats = game('renderStats').value;
  const statsFile = path.join(RESULTS, 'render-stats-iwer.json');
  writeFileSync(statsFile, JSON.stringify({ level: poked.level.id, phase: poked.phase, stats, snapshotRenderer: poked.renderer, budget: BUDGET }, null, 2));
  summary.data.renderStats = { file: statsFile, ...stats };
  check('XR render stats sampled', stats.frames > 0, { frames: stats.frames });
  check('XR draw calls within budget', stats.max.calls <= BUDGET.calls, stats.max.calls);
  check('XR triangles within budget', stats.max.triangles <= BUDGET.triangles, stats.max.triangles);

  // 7. Real-object spike: features, meshes, viewer hit-test aimed at the cup.
  xr('set-transform', { device: 'headset', position: TABLE_HEAD });
  xr('look-at', { device: 'headset', target: { x: CUP.x, y: CUP.y + 0.04, z: CUP.z } });
  await sleep(500);
  const features = game('spike.enabledFeatures').value;
  const meshes = game('spike.meshes').value;
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
  try {
    run(['dev', 'down'], { timeoutMs: 60_000 });
  } catch (error) {
    console.error('dev down failed', error);
    exitCode = 1;
  }
  const stillRunning = run(['dev', 'status']).data?.state?.running;
  summary.runtimeStopped = !stillRunning;
  if (stillRunning) exitCode = 1;
  writeFileSync(path.join(RESULTS, 'verify-iwer-summary.json'), JSON.stringify(summary, null, 2));
  const { planes: _planes, ...printed } = summary.data; // full list stays in the summary file
  console.log(JSON.stringify({ ok: summary.ok && exitCode === 0, failed: summary.checks.filter((c) => !c.pass).map((c) => c.name), data: printed, runtimeStopped: summary.runtimeStopped, error: summary.error }, null, 2));
  process.exit(exitCode);
}
