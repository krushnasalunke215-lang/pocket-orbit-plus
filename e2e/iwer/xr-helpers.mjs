// Shared helpers for driving the IWER managed runtime: XR device calls,
// whitelisted window.__game calls, polling, and hand-ray grab/drag steps.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tsImport } from 'tsx/esm/api';
import { call, root, run, sleep } from './cli.mjs';

const { boardToWorld } = await tsImport('../../src/game/board-math.ts', import.meta.url);

export const SHOTS = path.join(root, '.agents', 'tasks', 'screenshots', 'phase3');
export const RESULTS = path.join(root, 'test-results');
const REQUEST = path.join(root, 'e2e', 'iwer', '.request.json');

export const xr = (action, input = {}, options) => call(['xr', action], { input, ...options }).result;
export const vec = (p) => ({ x: p[0], y: p[1], z: p[2] });
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const round = (v, n = 4) => (Array.isArray(v) ? v.map((x) => round(x, n)) : Number(v.toFixed(n)));
/** Board-normalized point → world meters with the board pose from a snapshot. */
export const toWorld = (board, p) => boardToWorld(board, p);

/** One whitelisted window.__game call through `browser run`; returns { value, perfNow }. */
export function game(method, ...args) {
  writeFileSync(REQUEST, JSON.stringify({ method, args }));
  const result = call(['browser', 'run', 'e2e/iwer/read-game.mjs', '--timeout', '30000']).result;
  if (result?.error) throw new Error(`__game.${method}: ${result.error}`);
  return result;
}
export const snapshot = () => game('snapshot').value;
export const bodyOf = (snap, id) => snap.bodies.find((b) => b.id === id);

export async function waitFor(label, fn, timeoutMs, intervalMs = 500) {
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

export function screenshot(name, summary) {
  const file = path.join(SHOTS, name);
  call(['browser', 'screenshot', '--output-file', file]);
  if (summary) summary.data.screenshots = [...(summary.data.screenshots ?? []), file];
  return file;
}

export async function enterXR() {
  xr('enter');
  const status = await waitFor('an active XR session', () => {
    const s = xr('status');
    return s.sessionActive ? s : null;
  }, 20_000);
  xr('set-input-mode', { mode: 'hand' });
  await sleep(4000);
  return status;
}

/**
 * Reloads the managed page and waits for a fresh desktop board and an XR
 * runtime that offers a session. The reload command itself can time out
 * while the page is still loading (outcome unknown), so its reply is not
 * trusted; the wait is.
 */
export async function reloadPage() {
  const before = Date.now();
  const reply = run(['browser', 'reload'], { input: {}, timeoutMs: 90_000 });
  if (!reply.ok) console.log(`browser reload replied ${reply.error?.code ?? 'not ok'}; waiting for the page`);
  await sleep(2000);
  const fresh = await waitFor('a fresh desktop page', () => {
    const s = snapshot();
    return s.levelBuilt && s.board.source === 'desktop' ? s : null;
  }, 120_000, 1000);
  await waitFor('the XR runtime after reload', () => xr('status').sessionOffered, 60_000, 1000);
  return { snapshot: fresh, reloadMs: Date.now() - before };
}

/**
 * Navigates the managed app page to the same URL with `search` (for
 * example '?debug=1', or '' for none) and waits like reloadPage. The CLI has
 * no navigate action, so the page itself assigns location.search.
 */
export async function navigateSearch(search) {
  const before = Date.now();
  game('page.setSearch', search);
  await sleep(2000);
  const fresh = await waitFor('a fresh desktop page', () => {
    const s = snapshot();
    return s.levelBuilt && s.board.source === 'desktop' ? s : null;
  }, 120_000, 1000);
  await waitFor('the XR runtime after navigation', () => xr('status').sessionOffered, 60_000, 1000);
  return { snapshot: fresh, search: game('page.search').value, navigateMs: Date.now() - before };
}

const CONFIG = path.join(root, 'iwsdk.config.json');
let configBefore = null;

/**
 * Selects the IWER emulator device (`dev.emulator.device` in
 * iwsdk.config.json; the CLI has no flag for it). Vite restarts in place and
 * the managed page reloads, which ends any XR session. The original file is
 * kept byte for byte for restoreEmulatorDevice. Returns the device before.
 */
export function setEmulatorDevice(device) {
  const text = readFileSync(CONFIG, 'utf8');
  const config = JSON.parse(text);
  const before = config.dev?.emulator?.device ?? null;
  if (before === device) return before;
  const next = text.replace(/("device"\s*:\s*)"[^"]*"/, `$1"${device}"`);
  if (JSON.parse(next).dev?.emulator?.device !== device) throw new Error(`could not set dev.emulator.device in ${CONFIG}`);
  configBefore ??= text;
  writeFileSync(CONFIG, next);
  return before;
}

/** Writes iwsdk.config.json back as it was before setEmulatorDevice; true when it changed it. */
export function restoreEmulatorDevice() {
  if (configBefore === null) return false;
  writeFileSync(CONFIG, configBefore);
  configBefore = null;
  return true;
}

/** Waits for the restarted runtime: the command bridge, a built desktop page and XR offered by `deviceName`. */
export async function waitForEmulatorDevice(deviceName, timeoutMs = 240_000) {
  await sleep(3000);
  await waitFor('browserCommandReady after the restart', () => call(['dev', 'status']).state?.browserCommandReady, timeoutMs, 1000);
  await waitFor('a fresh desktop page', () => {
    const s = snapshot();
    return s.levelBuilt && s.board.source === 'desktop' ? s : null;
  }, timeoutMs, 1000);
  return waitFor(`the XR runtime as ${deviceName}`, () => {
    const s = xr('status');
    return s.sessionOffered && s.deviceName === deviceName ? s : null;
  }, timeoutMs, 1000);
}

export async function exitXR() {
  xr('exit');
  await waitFor('session end', () => !xr('status').sessionActive, 10_000);
}

export const hoveredNames = () => call(['ecs', 'find'], { input: { withComponents: ['Hovered'] } }).result.entities.map((e) => e.name);
export const grabbedNames = () => call(['ecs', 'find'], { input: { withComponents: ['Grabbed'] } }).result.entities.map((e) => e.name);

/** Puts the hand's ray origin in front of the chest, between the head and the board. */
export function handAtChest(device) {
  const head = xr('get-transform', { device: 'headset' }).position;
  const hand = [head.x + 0.15, head.y - 0.2, head.z - 0.15];
  xr('set-transform', { device, position: vec(hand) });
  return hand;
}

/**
 * Aims `device`'s ray from the chest at `target` (world), records what is
 * hovered, then selects (pinch). Returns the ray length to the target and
 * whether `isHeld(snapshot)` became true.
 */
export async function rayGrab(device, target, isHeld) {
  const hand = handAtChest(device);
  xr('look-at', { device, target: vec(target) });
  await sleep(500);
  const hovered = hoveredNames();
  xr('set-select-value', { device, value: 1 });
  await sleep(600);
  return { hand, distance: dist(target, hand), hovered, held: Boolean(isHeld(snapshot())) };
}

/** Swings the held ray so its end (at `distance`) lies toward `target` (world). */
export async function rayMoveTo(device, target, distance) {
  xr('look-at', { device, target: vec(target), moveToDistance: distance });
  await sleep(800);
}

export async function letGo(device) {
  xr('set-select-value', { device, value: 0 });
  await sleep(600);
}

export const waitNotFlying = (timeoutMs = 20_000) =>
  waitFor('flight end', () => {
    const s = snapshot();
    return s.phase !== 'flying' ? s : null;
  }, timeoutMs);

/**
 * Hovers planet `body` with `device`, grabs it, moves the ray end to
 * `solution` (board [x, z]) and releases. With `expectSolve`, waits up to
 * 20 s for the solved state; otherwise waits for the flight to end.
 * `afterRelease` (async) runs right after the release, before that wait
 * (for example a mid-flight screenshot); its result is returned as `after`
 * and its duration is left out of solvedAfterMs.
 */
export async function rayDrag(device, body, solution, { expectSolve = true, afterRelease = null } = {}) {
  const began = Date.now();
  const isHand = device.startsWith('hand');
  xr('set-input-mode', { mode: isHand ? 'hand' : 'controller' });
  let snap = snapshot();
  const board = snap.board;
  const planet = bodyOf(snap, body).world;
  const hand = handAtChest(device);

  // Aim beside the visible sphere (0.12 board units off the center,
  // perpendicular to the ray): only the invisible collider can be hit there.
  const toPlanet = [planet[0] - hand[0], planet[1] - hand[1], planet[2] - hand[2]];
  const len = Math.hypot(...toPlanet);
  const side = [-toPlanet[2] / len, 0, toPlanet[0] / len];
  const sideLen = Math.hypot(side[0], side[2]);
  const offset = 0.12 * board.radius;
  const beside = [planet[0] + (side[0] / sideLen) * offset, planet[1], planet[2] + (side[2] / sideLen) * offset];
  xr('look-at', { device, target: vec(beside) });
  await sleep(600);
  const hovered = hoveredNames();
  const colliderHover = hovered.includes(`Body ${body}`);
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
  const heldAfterSelect = Boolean(bodyOf(snap, body)?.held);
  if (!heldAfterSelect) {
    xr('set-select-value', { device, value: 0 });
    return { device, body, colliderHover, rayMissBoard, heldAfterSelect, hovered };
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
    const b = bodyOf(snap, body);
    heldWhileMoving = b.held;
    reached = b.board;
    const ex = goal[0] - reached[0];
    const ez = goal[2] - reached[2];
    if (Math.hypot(ex, ez) <= 0.005) break;
    correction[0] += ex;
    correction[2] += ez;
  }
  const error = Math.hypot(goal[0] - reached[0], goal[2] - reached[2]);
  const attemptsBefore = snap.attempts;
  xr('set-select-value', { device, value: 0 });
  const releasedAt = Date.now();
  let released = releasedAt;
  let after = null;
  if (afterRelease) {
    const started = Date.now();
    after = await afterRelease();
    released += Date.now() - started;
  }
  let solvedSnap = null;
  let endSnap;
  if (expectSolve) {
    solvedSnap = await waitFor('solved', () => {
      const s = snapshot();
      return s.solved ? s : null;
    }, 20_000).catch(() => null);
    endSnap = solvedSnap ?? snapshot();
  } else {
    await sleep(600);
    endSnap = await waitNotFlying().catch(() => snapshot());
  }
  return {
    device,
    body,
    colliderHover,
    rayMissBoard: round(rayMissBoard),
    heldAfterSelect,
    heldWhileMoving,
    rayDistance: round(d),
    reached: round(reached),
    error: round(error),
    launched: endSnap.attempts > attemptsBefore,
    solved: Boolean(solvedSnap),
    solvedAfterMs: solvedSnap ? Date.now() - released : null,
    /** Wall time of the whole scripted drag (aim, grab, move, release, flight), minus afterRelease. */
    totalMs: Date.now() - began - (released - releasedAt),
    lastOutcome: endSnap.lastOutcome,
    after,
  };
}
