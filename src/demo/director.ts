import { Hovered, type World } from '@iwsdk/core';
import type { BodySnapshot, GameDebugApi, GameSnapshot } from '../debug/debug-api.js';
import { boardToWorld } from '../game/board-math.js';
import { CONSTELLATION } from '../game/sky-story.js';
import { GIANT_POSITION } from '../render/cosmos/planets.js';
import { LEVEL_SOURCE, simulate } from '../sim/simulate.js';
import type { Vec2 } from '../sim/vec.js';
import {
  DEFAULT_SETTINGS,
  getChapter,
  getCosmos,
  getGame,
  getLevelSelect,
  markInteracted,
  setOnboarding,
  setSettings,
} from '../xr/runtime.js';
import { GLASSES_DEVICE_NAME, IwerRemote, lookRotation, sleep, waitFor, type HandDevice, type Quat, type Triple } from './iwer.js';

/*
 * Director mode (?demo=1): plays the trailer shots of VIDEO.md in an IWER
 * session in the sunlit_living_room room, seated at the coffee table, with
 * real input only: emulated hands pinch, carry and release the planets,
 * hand rays click the panels, and the glasses shot uses gaze plus pinch.
 * Dev builds only (index.ts); the SaveSystem is off, so every take starts
 * from a fresh game and saves nothing.
 *
 *   ?demo=1&shot=N   one shot (0-7), so it can be retaken
 *   ?demo=1          shots 0-5 and 7 in one session (the Quest 3 device),
 *                    or shot 6 alone on the metaVRGlasses device
 *   &autostart=1     no "click to start" card (automation; audio may stay locked)
 *
 * The page shows a start card after the setup; the click starts the shot
 * and unlocks audio. window.__demo reports progress for the e2e/demo checks.
 */

export interface DemoShotResult {
  id: number;
  name: string;
  /** Target length in the edit (VIDEO.md). */
  targetSeconds: number;
  /** Wall time from the start click to the shot's end. */
  ms: number;
  /** performance.now() of the shot's key frame (mid-flight or the payoff). */
  keyAt: number | null;
}

export interface DemoStatus {
  state: 'loading' | 'waiting' | 'running' | 'done' | 'error';
  device: string | null;
  plan: number[];
  shot: number | null;
  /** The current step, for logs. */
  beat: string;
  keyAt: number | null;
  results: DemoShotResult[];
  warnings: string[];
  error: string | null;
}

declare global {
  interface Window {
    __demo?: DemoStatus;
  }
}

/** The seated pose of the IWER checks: in front of the sunlit_living_room coffee table. */
const TABLE_HEAD: Triple = [0, 1.15, -1.2];
/** The top of the cup on that coffee table (see e2e/iwer/verify-iwer.mjs). */
const CUP_TOP: Triple = [0.08, 0.587, -1.78];
/** The camera of the Quest shots, from the board center: 0.69 m away, 44 degrees down. */
const CLOSE_HEAD: Triple = [0, 0.48, 0.5];
/** It looks a little beyond the center, so the HUD above the far rim stays in frame. */
const CLOSE_LOOK: Triple = [0, 0.04, -0.08];
/** Shot 5 leans right and down during the flight, so the cup occludes the comet. */
const SIDE_HEAD: Triple = [0.3, 1.0, -1.32];
const HANDS: readonly HandDevice[] = ['hand-left', 'hand-right'];
const RIGHT: HandDevice = 'hand-right';
/** A carried planet is let go within this distance of its goal (board units). */
const PLACE_TOLERANCE = 0.004;

interface Shot {
  readonly id: number;
  readonly name: string;
  readonly target: number;
  /** Needs the metaVRGlasses emulator device. */
  readonly glasses?: boolean;
  /** Before the start card: level, placements, settings. */
  setup(d: Director): Promise<void>;
  run(d: Director): Promise<void>;
}

class Director {
  head: Triple = TABLE_HEAD;
  readonly hovered;

  constructor(
    readonly world: World,
    readonly api: GameDebugApi,
    readonly remote: IwerRemote,
    readonly status: DemoStatus,
  ) {
    this.hovered = world.queryManager.registerQuery({ required: [Hovered] });
  }

  snap(): GameSnapshot {
    return this.api.snapshot();
  }

  body(id: string, snap = this.snap()): BodySnapshot {
    const body = snap.bodies.find((b) => b.id === id);
    if (!body) throw new Error(`no body ${id} on ${snap.level.id}`);
    return body;
  }

  beat(label: string): void {
    this.status.beat = label;
  }

  /** Marks this shot's key frame (the first call counts). */
  key(): void {
    this.status.keyAt ??= Math.round(performance.now());
  }

  warn(message: string): void {
    this.status.warnings.push(`shot ${this.status.shot}: ${message}`);
    console.warn(`[demo] ${message}`);
  }

  /** World point of a cosmos-frame point (meters from the board center, in the board's turn). */
  cosmosPoint(p: readonly number[]): Triple {
    const board = this.snap().board;
    const r = board.radius;
    return boardToWorld(board, [p[0] / r, p[1] / r, p[2] / r]) as Triple;
  }

  /** Turns (and if needed moves) the camera smoothly to the close pose over the board (seat() jumps there). */
  async seatSmoothly(seconds: number): Promise<void> {
    const c = this.snap().board.center;
    const head: Triple = [c[0], c[1] + CLOSE_HEAD[1], c[2] + CLOSE_HEAD[2]];
    const look: Triple = [c[0], c[1] + CLOSE_LOOK[1], c[2] + CLOSE_LOOK[2]];
    await this.remote.move('headset', head, lookRotation(head, look), seconds);
    this.head = head;
  }

  /** A stored placement of level `index` (0-based). */
  goal(index: number, key: 'solution' | 'melodySolution', id: string): Vec2 {
    const level = this.api.levels()[index];
    const p = (key === 'melodySolution' ? level.melodySolution : level.solution)?.[id];
    if (!p) throw new Error(`${level.id} has no ${key} for ${id}`);
    return [p[0], p[1]];
  }

  /** Session, seated pose, board on the coffee table, no emulator UI. */
  async prepare(): Promise<void> {
    this.beat('waiting for the game');
    await waitFor('the game', () => this.api.ready && this.snap().levelBuilt, 60_000, 100);
    this.beat('starting the XR session');
    await this.remote.startSession();
    this.cleanFrame();
    await this.remote.place('headset', TABLE_HEAD, lookRotation(TABLE_HEAD, [0, 0.55, -1.95]));
    await this.handsDown();
    await sleep(2500);
    this.beat('placing the board on the table');
    await waitFor(
      'the board on the coffee table',
      () => {
        this.api.placeBoard();
        return this.snap().board.source === 'table-plane';
      },
      20_000,
      1500,
    );
    await sleep(500);
    this.cleanFrame();
  }

  /** Hides IWER's emulator controls (the room itself stays). */
  cleanFrame(): void {
    const devui = this.remote.device.devui;
    if (devui) {
      devui.devUICanvas.style.display = 'none';
      devui.devUIContainer.style.display = 'none';
    }
  }

  /** Back to a plain story game, seated, hands down (between shots). */
  async reset(): Promise<void> {
    const levels = getLevelSelect(this.world);
    if (levels?.open) levels.hide();
    const chapter = getChapter(this.world);
    if (chapter?.shown) chapter.hide();
    if (this.snap().mode === 'sandbox') await this.api.sandbox.exit();
    this.api.sandbox.clear();
    setSettings(this.world, DEFAULT_SETTINGS);
    await this.seat();
    await this.handsDown();
  }

  /**
   * The camera: leaning in over the board (closer than the seated pose the
   * board was placed from, so it fills more of the frame), or with `table`
   * the tested seated pose itself (the glasses fit was measured there).
   */
  async seat(table = false): Promise<void> {
    const c = this.snap().board.center;
    this.head = table ? TABLE_HEAD : [c[0], c[1] + CLOSE_HEAD[1], c[2] + CLOSE_HEAD[2]];
    const look: Triple = table ? [c[0], c[1], c[2]] : [c[0], c[1] + CLOSE_LOOK[1], c[2] + CLOSE_LOOK[2]];
    await this.remote.place('headset', this.head, lookRotation(this.head, look));
  }

  private side(hand: HandDevice): number {
    return hand === 'hand-left' ? -1 : 1;
  }

  /** Low beside and behind the hip, pointing at the floor: out of the picture. */
  rest(hand: HandDevice): { position: Triple; orientation: Quat } {
    const s = this.side(hand);
    const h = this.head;
    const position: Triple = [h[0] + 0.42 * s, h[1] - 0.6, h[2] + 0.12];
    return { position, orientation: lookRotation(position, [position[0] + 0.3 * s, 0, position[2]]) };
  }

  /** In front of the chest, where a seated player aims a hand ray from. */
  chest(hand: HandDevice): Triple {
    const s = this.side(hand);
    const h = this.head;
    return [h[0] + 0.15 * s, h[1] - 0.2, h[2] - 0.15];
  }

  async handDown(hand: HandDevice, seconds = 0.7): Promise<void> {
    const rest = this.rest(hand);
    if (seconds > 0) await this.remote.move(hand, rest.position, rest.orientation, seconds);
    else await this.remote.place(hand, rest.position, rest.orientation);
  }

  async handsDown(seconds = 0): Promise<void> {
    for (const hand of HANDS) await this.handDown(hand, seconds);
  }

  /** A hand-ray click on a panel element; `done` judges the effect (one retry after a slow frame). */
  async rayClick(id: string, done: (s: GameSnapshot) => unknown, hand: HandDevice = RIGHT): Promise<void> {
    this.beat(`ray click ${id}`);
    const point = this.api.uiWorldPoint(id);
    if (!point) throw new Error(`no UI element ${id}`);
    const chest = this.chest(hand);
    await this.remote.move(hand, chest, lookRotation(chest, point), 0.45);
    await sleep(250);
    await this.remote.click(hand, 0.2);
    try {
      await waitFor(`the ${id} click`, () => done(this.snap()), 2500, 100);
    } catch {
      this.warn(`${id} took a second click (hovered: ${this.hoveredNames()})`);
      await this.remote.click(hand, 0.2);
      await this.expect(`the ${id} click`, () => done(this.snap()), 2500);
    }
  }

  /** Names of the entities a ray or gaze hovers now (for failure messages). */
  hoveredNames(): string {
    const names: string[] = [];
    for (const entity of this.hovered.entities) names.push(entity.object3D?.name || `entity ${entity.index}`);
    return names.length > 0 ? names.join(', ') : 'nothing';
  }

  /** waitFor, failing with what is hovered and held. */
  async expect<T>(label: string, test: () => T, timeoutMs: number): Promise<NonNullable<T>> {
    try {
      return await waitFor(label, test, timeoutMs, 50);
    } catch (error) {
      const s = this.snap();
      const held = s.bodies.filter((b) => b.held).map((b) => b.id);
      if (s.board.handleHeld) held.push('board handle');
      throw new Error(`${(error as Error).message} (hovered: ${this.hoveredNames()}; held: ${held.join(', ') || 'nothing'})`);
    }
  }

  /**
   * Reaches for body `id`, pinches it (the hand ray from a few centimeters
   * away hits its grab collider), carries it to board `goal`, settling
   * within PLACE_TOLERANCE like a player watching the planet, and lets go,
   * which launches. Returns the attempts before the release.
   */
  async placeBody(id: string, goal: Vec2, hand: HandDevice = RIGHT, reach = 0.9, carry = 1.1): Promise<number> {
    this.beat(`place ${id}`);
    const snap = this.snap();
    const p = this.body(id, snap).world;
    // From the hand's own side, a little above and toward the head: never
    // from straight in front, where the board handle sits on the near rim.
    const dx = this.head[0] - p[0];
    const dz = this.head[2] - p[2];
    const len = Math.hypot(dx, dz) || 1;
    const [hx, hz] = [dx / len, dz / len];
    const s = this.side(hand);
    const [rx, rz] = [hz * s, -hx * s];
    const origin: Triple = [p[0] + rx * 0.045 + hx * 0.015, p[1] + 0.045, p[2] + rz * 0.045 + hz * 0.015];
    const approach: Triple = [origin[0] + rx * 0.08 + hx * 0.06, origin[1] + 0.06, origin[2] + rz * 0.08 + hz * 0.06];
    const orientation = lookRotation(origin, p);
    await this.remote.move(hand, approach, lookRotation(approach, p), reach * 0.65);
    await this.remote.move(hand, origin, orientation, reach * 0.35);
    await this.expect(`${id} hovered`, () => this.body(id).hovered, 1000);
    await this.remote.pinch(hand, 1);
    await this.expect(`${id} held`, () => this.body(id).held, 1500);

    // The planet floats at its own (lifted) board height.
    const goalWorld = boardToWorld(snap.board, [goal[0], this.body(id, snap).board[1], goal[1]]);
    let at: Triple = origin;
    let w = p;
    let error = Infinity;
    for (let i = 0; i < 5 && error > PLACE_TOLERANCE; i++) {
      at = [at[0] + goalWorld[0] - w[0], at[1], at[2] + goalWorld[2] - w[2]];
      await this.remote.move(hand, at, orientation, i === 0 ? carry : 0.25);
      await sleep(80);
      const b = this.body(id);
      if (!b.held) throw new Error(`${id} was dropped while carried`);
      w = b.world;
      error = Math.hypot(goal[0] - b.board[0], goal[1] - b.board[2]);
    }
    if (error > PLACE_TOLERANCE) this.warn(`${id} let go ${error.toFixed(3)} from its goal`);
    const attempts = this.snap().attempts;
    await this.remote.pinch(hand, 0, 0.1);
    await waitFor(`${id} released`, () => !this.body(id).held, 1500);
    await this.handDown(hand, 0.8);
    return attempts;
  }

  /** Waits for the flight launched after `attemptsBefore` to end. */
  async flightEnd(attemptsBefore: number): Promise<GameSnapshot> {
    this.beat('flight');
    await this.expect('the launch', () => this.snap().attempts > attemptsBefore, 3000);
    try {
      return await waitFor('the flight end', () => {
        const s = this.snap();
        return s.phase !== 'flying' ? s : null;
      }, 20_000, 100);
    } catch (error) {
      const s = this.snap();
      const why = `phase ${s.phase}, ${s.flightTime.toFixed(2)} of ${s.flightDuration.toFixed(2)} s flown, pause ${s.pause.reason}, page ${document.visibilityState}`;
      throw new Error(`${(error as Error).message} (${why})`);
    }
  }

  expectSolved(end: GameSnapshot, stars?: number): void {
    if (!end.solved) throw new Error(`${end.level.id} was not solved (${end.lastOutcome ?? 'no outcome'})`);
    if (stars !== undefined && end.stars.last !== stars) this.warn(`${end.level.id} earned ${end.stars.last} stars, not ${stars}`);
  }

  /** Gaze picks body `id`, the right hand pinches (out of view) and carries it to `goal`, then lets go. */
  async gazeCarry(id: string, goal: Vec2): Promise<number> {
    this.beat(`gaze carry ${id}`);
    const snap = this.snap();
    const p = this.body(id, snap).world;
    await this.remote.lookAt('gaze', p);
    await sleep(800);
    await this.remote.pinch(RIGHT, 1);
    await waitFor(`${id} held by gaze plus pinch`, () => this.body(id).held, 1500);
    const t = await this.remote.transform(RIGHT);
    // The planet floats at its own (lifted) board height.
    const goalWorld = boardToWorld(snap.board, [goal[0], this.body(id, snap).board[1], goal[1]]);
    let at = t.position;
    let w = p;
    let error = Infinity;
    for (let i = 0; i < 6 && error > PLACE_TOLERANCE; i++) {
      at = [at[0] + goalWorld[0] - w[0], at[1], at[2] + goalWorld[2] - w[2]];
      await this.remote.move(RIGHT, at, t.orientation, i === 0 ? 1.2 : 0.3);
      await sleep(100);
      const b = this.body(id);
      if (!b.held) throw new Error(`${id} was dropped while carried`);
      w = b.world;
      error = Math.hypot(goal[0] - b.board[0], goal[1] - b.board[2]);
    }
    if (error > PLACE_TOLERANCE) this.warn(`${id} let go ${error.toFixed(3)} from its goal`);
    const attempts = this.snap().attempts;
    await this.remote.pinch(RIGHT, 0, 0.1);
    await waitFor(`${id} released`, () => !this.body(id).held, 1500);
    return attempts;
  }

  /** Gaze at a panel element, then a right-hand pinch (a click). */
  async gazeClick(id: string, done: (s: GameSnapshot) => unknown): Promise<void> {
    this.beat(`gaze click ${id}`);
    const point = this.api.uiWorldPoint(id);
    if (!point) throw new Error(`no UI element ${id}`);
    await this.remote.lookAt('gaze', point);
    await sleep(600);
    await this.remote.click(RIGHT, 0.2);
    try {
      // Long enough for a slow glasses frame: a second click after a late
      // first one would land on the panel the first one opened.
      await waitFor(`the ${id} gaze click`, () => done(this.snap()), 4000, 100);
    } catch {
      this.warn(`${id} took a second gaze click (hovered: ${this.hoveredNames()})`);
      await this.remote.lookAt('gaze', point);
      await sleep(600);
      await this.remote.click(RIGHT, 0.2);
      await this.expect(`the ${id} gaze click`, () => done(this.snap()), 4000);
    }
  }

  /**
   * Solves levels `indexes` off screen with their stored 3-star placements:
   * the game's own launch and flight, run to the end at once, so the best
   * stars are earned as in play. Ends on no particular level; load one next.
   */
  earnStars(indexes: readonly number[]): void {
    const game = getGame(this.world);
    if (!game) throw new Error('the game is not ready');
    for (const index of indexes) {
      game.loadLevel(index);
      const level = game.level;
      for (const [id, p] of Object.entries(level.melodySolution ?? level.solution)) game.setPlacement(id, p);
      const result = game.launch();
      game.tick(result.time + 0.001);
      if (game.lastStars !== 3) throw new Error(`${level.id}: its 3-star placement earned ${game.lastStars} stars`);
    }
  }

  /**
   * A planet placement for the current Your Table target with the wells now
   * set: one whose flight passes closest to a well and solves, and still
   * solves 0.02 off in each axis; else the flight that passes closest to a
   * well (the comet bends around it and flies on). Where the
   * sunlit_living_room coffee table puts the cup, no target solves with
   * it, so shot 5 shows the bend.
   */
  async wellPlacement(): Promise<Vec2> {
    const game = getGame(this.world);
    if (!game) throw new Error('the game is not ready');
    const level = game.level;
    const wells = game.activeWells;
    const id = level.bodies.find((b) => b.movable)?.id;
    if (!id || wells.length === 0) throw new Error('Your Table needs a movable planet and a well');
    const flight = (x: number, z: number) => simulate(level, { [id]: [x, z] }, { externalWells: wells, recordEvery: 1 << 30 });
    const found: { x: number; z: number; solved: boolean; closest: number }[] = [];
    for (let i = -9; i <= 9; i++) {
      for (let j = -9; j <= 9; j++) {
        const x = i / 10;
        const z = j / 10;
        if (x * x + z * z > 0.85 * 0.85) continue;
        if (wells.some((w) => Math.hypot(w.position[0] - x, w.position[2] - z) < 0.3)) continue;
        const r = flight(x, z);
        const pass = r.flybys.find((f) => f.source !== LEVEL_SOURCE);
        if (pass) found.push({ x, z, solved: r.outcome === 'solved', closest: pass.closestDistance });
      }
      // One row per task, so the search never holds a frame for long.
      await sleep(0);
    }
    found.sort((a, b) => Number(b.solved) - Number(a.solved) || a.closest - b.closest);
    for (const c of found.slice(0, 12)) {
      if (!c.solved) break;
      const nudges: Vec2[] = [[0.02, 0], [-0.02, 0], [0, 0.02], [0, -0.02]];
      if (nudges.every(([nx, nz]) => flight(c.x + nx, c.z + nz).outcome === 'solved')) return [c.x, c.z];
    }
    const best = found[0];
    if (!best) throw new Error('no planet placement brings the comet past the cup well');
    if (best.solved) this.warn('no robust solve with the cup well; using a narrow one');
    this.beat(best.solved ? 'cup well: a solve' : 'cup well: the bend');
    return [best.x, best.z];
  }
}

const SHOTS: readonly Shot[] = [
  {
    id: 0,
    name: 'The room dissolves into space',
    target: 12,
    async setup(d) {
      // Level 1 with the ghost hand done and no attract loop: just the room.
      setOnboarding(d.world, { ghostHandDone: true });
      markInteracted(d.world);
      await d.api.loadLevel(0);
      // The close camera of the Quest shots from the start: the shot turns
      // the head only, so the near-rim button stays placed for this pose.
      await d.seat();
      await d.handsDown();
      // Hold the cosmos back until the click: the real room only.
      getCosmos(d.world)?.holdFade();
    },
    async run(d) {
      d.beat('the room dissolves into space');
      getCosmos(d.world)?.replayFade();
      // The head turns slowly toward the giant planet while the room
      // dissolves (2.5 s), then back down to the table.
      const giant = d.cosmosPoint(GIANT_POSITION);
      await d.remote.move('headset', d.head, lookRotation(d.head, giant), 2.8);
      await sleep(900);
      await d.seatSmoothly(1.8);
      // The hands rest relative to the new pose, as after seat() in the other shots.
      await d.handsDown();
      await sleep(500);
      // The first pinch and launch: the flight, the solve burst, the comet rises.
      const before = await d.placeBody('p1', d.goal(0, 'solution', 'p1'));
      d.key();
      d.expectSolved(await d.flightEnd(before));
      await sleep(2400);
    },
  },
  {
    id: 1,
    name: 'Hook: a pinch, three bells, the star',
    target: 6,
    async setup(d) {
      await d.api.loadLevel(5);
      d.api.setPlacements({ w1: d.goal(5, 'melodySolution', 'w1') });
    },
    async run(d) {
      const before = await d.placeBody('p1', d.goal(5, 'melodySolution', 'p1'), RIGHT, 0.8, 0.9);
      d.key();
      d.expectSolved(await d.flightEnd(before), 3);
      await sleep(1200);
    },
  },
  {
    id: 2,
    name: 'Level 1, start to finish',
    target: 20,
    async setup(d) {
      d.api.resetOnboarding();
      await d.api.loadLevel(0);
    },
    async run(d) {
      // The attract loop and one full ghost-hand demonstration (5.2 s).
      d.beat('ghost hand');
      await sleep(6500);
      // A first try that misses, as a new player's would.
      const miss = await d.flightEnd(await d.placeBody('p1', [0.2, -0.4]));
      if (miss.solved) d.warn('the first try solved');
      await sleep(900);
      const before = await d.placeBody('p1', d.goal(0, 'solution', 'p1'));
      d.key();
      d.expectSolved(await d.flightEnd(before), 3);
      await sleep(4500);
    },
  },
  {
    id: 3,
    name: 'Levels 4-6 mid-flight: black hole and white star',
    target: 26,
    async setup(d) {
      await d.api.loadLevel(3);
    },
    async run(d) {
      const steps: { index: number; id: string; goal: Vec2; key?: boolean }[] = [
        { index: 3, id: 'p1', goal: d.goal(3, 'melodySolution', 'p1') },
        { index: 4, id: 'w1', goal: d.goal(4, 'melodySolution', 'w1') },
        { index: 5, id: 'p1', goal: d.goal(5, 'solution', 'p1'), key: true },
      ];
      for (const step of steps) {
        if (d.snap().level.index !== step.index) {
          await d.api.loadLevel(step.index);
          if (step.index === 5) d.api.setPlacements({ w1: d.goal(5, 'solution', 'w1') });
        }
        await sleep(1600);
        const before = await d.placeBody(step.id, step.goal);
        if (step.key) d.key();
        d.expectSolved(await d.flightEnd(before));
        await sleep(2600);
      }
    },
  },
  {
    id: 4,
    name: 'The 3-star melody and the chapter-complete moment',
    target: 22,
    async setup(d) {
      d.earnStars([0, 1, 2, 3, 4]);
      await d.api.loadLevel(5);
      d.api.setPlacements({ w1: d.goal(5, 'melodySolution', 'w1') });
    },
    async run(d) {
      await sleep(800);
      const before = await d.placeBody('p1', d.goal(5, 'melodySolution', 'p1'));
      d.expectSolved(await d.flightEnd(before), 3);
      // The solve phrase replays the rung notes, then the chord.
      d.beat('melody replay');
      await sleep(3200);
      await d.rayClick('next-button', (s) => s.chapterComplete.shown);
      await d.handDown(RIGHT);
      const chapter = d.snap().chapterComplete;
      if (chapter.stars !== chapter.maxStars) d.warn(`chapter moment shows ${chapter.stars} of ${chapter.maxStars} stars`);
      d.beat('chapter moment');
      await sleep(1800);
      d.key();
      await sleep(1500);
      // Look up: the solved levels' stars form the chapter constellation in the sky.
      d.beat('the constellation');
      const stars = CONSTELLATION[1];
      const mid = [0, 1, 2].map((k) => stars.reduce((sum, p) => sum + p[k], 0) / stars.length);
      await d.remote.move('headset', d.head, lookRotation(d.head, d.cosmosPoint(mid)), 2.4);
      await sleep(4200);
    },
  },
  {
    id: 5,
    name: 'Your Table: a well on the real cup',
    target: 21,
    async setup(d) {
      await d.api.sandbox.enter(1);
    },
    async run(d) {
      await sleep(1500);
      await d.rayClick('make-well', (s) => s.sandbox.armed);
      d.beat('aim at the cup');
      const chest = d.chest(RIGHT);
      await d.remote.move(RIGHT, chest, lookRotation(chest, CUP_TOP), 0.7);
      await waitFor('the reticle on the cup', () => d.snap().sandbox.reticle?.hit === 'object', 5000, 100);
      await sleep(700);
      await d.remote.click(RIGHT, 0.2);
      const wells = await waitFor('the cup well', () => {
        const w = d.snap().sandbox.wells;
        return w.length > 0 ? w : null;
      }, 3000, 100);
      if (wells[0].kind !== 'object') throw new Error(`the pinch made a ${wells[0].kind}, not a well on the cup`);
      await d.handDown(RIGHT);
      await sleep(600);
      const goal = await d.wellPlacement();
      const before = await d.placeBody('p1', goal);
      d.key();
      // Lean right and down while it flies: the cup hides the comet behind it.
      d.beat('lean');
      d.head = SIDE_HEAD;
      await d.remote.move('headset', SIDE_HEAD, lookRotation(SIDE_HEAD, CUP_TOP), 2.6);
      await d.flightEnd(before);
      await sleep(1200);
      // Replay from the side: the comet passes behind the cup once more.
      // The HUD's Replay, so the ray stays high above the planets.
      const replay = d.snap().attempts;
      await d.rayClick('launch-button', (s) => s.attempts > replay);
      await d.handDown(RIGHT);
      await d.flightEnd(replay);
      await sleep(2000);
    },
  },
  {
    id: 6,
    name: 'Meta VR Glasses: gaze plus pinch',
    target: 16,
    glasses: true,
    async setup(d) {
      d.remote.device.visibilityMaskEnabled = true;
      await d.api.loadLevel(0);
      // The seated pose the glasses fit was measured from (item 3).
      await d.seat(true);
      await d.handsDown();
    },
    async run(d) {
      await sleep(2500);
      const before = await d.gazeCarry('p1', d.goal(0, 'solution', 'p1'));
      await d.remote.lookAt('gaze', d.snap().board.center);
      d.key();
      d.expectSolved(await d.flightEnd(before));
      await sleep(1500);
      await d.gazeClick('levels-button', (s) => s.levelSelect.open);
      await sleep(1400);
      await d.gazeClick('level-2', (s) => s.level.index === 1 && !s.levelSelect.open);
      await sleep(4200);
    },
  },
  {
    id: 7,
    name: 'Accessibility settings',
    target: 22,
    async setup(d) {
      d.api.resetOnboarding();
      await d.api.loadLevel(0);
      // The seated pose the accessibility checks click these buttons from;
      // the level select and its Settings page fill the frame there.
      await d.seat(true);
      await d.handsDown();
    },
    async run(d) {
      const settings = () => d.snap().accessibility.settings;
      await sleep(1500);
      await d.rayClick('levels-button', (s) => s.levelSelect.open);
      await sleep(500);
      await d.rayClick('settings-button', (s) => s.levelSelect.page === 'settings');
      await sleep(1000);
      await d.rayClick('contrast-button', () => settings().highContrast);
      d.key();
      await sleep(1500);
      for (const size of ['large', 'small', 'medium']) {
        await d.rayClick('board-size-button', () => settings().boardSize === size);
        await sleep(size === 'medium' ? 900 : 1300);
      }
      await d.rayClick('left-handed-button', () => settings().leftHanded);
      await sleep(900);
      await d.rayClick('motion-button', () => settings().reducedMotion);
      await sleep(900);
      await d.rayClick('settings-back', (s) => s.levelSelect.page === 'levels');
      await sleep(600);
      await d.rayClick('close-levels', (s) => !s.levelSelect.open);
      await d.handDown(RIGHT);
      // The left ghost hand on the high-contrast board, nothing else moving.
      d.beat('left ghost hand');
      await sleep(4000);
    },
  },
];

/** A full-window card over the canvas (the start prompt or an error). */
function showCard(title: string, detail: string, error = false): HTMLDivElement {
  const card = document.createElement('div');
  card.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;' +
    'background:rgba(5,7,13,0.62);color:#fff;font:600 30px system-ui,sans-serif;text-align:center;cursor:pointer';
  const heading = document.createElement('div');
  heading.textContent = title;
  if (error) heading.style.color = '#ff8a80';
  const body = document.createElement('div');
  body.textContent = detail;
  body.style.cssText = 'font-weight:400;font-size:19px;max-width:760px;opacity:0.88';
  card.append(heading, body);
  document.body.append(card);
  return card;
}

/** Shows the start card; resolves on its click (which also unlocks audio). */
function waitForClick(shot: Shot, all: boolean): Promise<void> {
  const what = all ? `Shots ${shot.id}-7` : `Shot ${shot.id}: ${shot.name}`;
  const card = showCard(what, 'Start recording, then click anywhere to play. Keep this window visible until it ends.');
  return new Promise((resolve) => {
    card.addEventListener(
      'pointerdown',
      () => {
        card.remove();
        resolve();
      },
      { once: true },
    );
  });
}

function shotPlan(param: string | null, glasses: boolean, status: DemoStatus): Shot[] {
  if (param !== null) {
    const shot = SHOTS.find((s) => String(s.id) === param);
    if (!shot) throw new Error(`Unknown shot "${param}": use shot=0 to shot=7.`);
    if (shot.glasses && !glasses) {
      throw new Error('Shot 6 needs the Meta VR Glasses emulator: set "device" to "metaVRGlasses" in iwsdk.config.json (VIDEO.md), then reload.');
    }
    if (!shot.glasses && glasses) {
      throw new Error(`Shot ${shot.id} needs the Meta Quest 3 emulator: set "device" back to "metaQuest3" in iwsdk.config.json, then reload.`);
    }
    return [shot];
  }
  const plan = SHOTS.filter((s) => Boolean(s.glasses) === glasses);
  status.warnings.push(glasses ? 'the glasses device plays shot 6 only' : 'shot 6 needs the metaVRGlasses device: record it on its own');
  return plan;
}

async function direct(world: World, api: GameDebugApi, status: DemoStatus): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const device = window.IWER_DEVICE;
  if (!device) throw new Error('IWER is not active on this page. Open the dev server on localhost (VIDEO.md).');
  status.device = device.name;
  const glasses = device.name === GLASSES_DEVICE_NAME;
  const plan = shotPlan(params.get('shot'), glasses, status);
  status.plan = plan.map((s) => s.id);
  const director = new Director(world, api, new IwerRemote(device), status);
  await director.prepare();
  for (let i = 0; i < plan.length; i++) {
    const shot = plan[i];
    status.shot = shot.id;
    status.keyAt = null;
    director.beat('setup');
    await director.reset();
    await shot.setup(director);
    await sleep(400);
    if (i === 0 && params.get('autostart') !== '1') {
      status.state = 'waiting';
      await waitForClick(shot, plan.length > 1);
      await sleep(300);
    }
    status.state = 'running';
    console.info(`[demo] shot ${shot.id}: ${shot.name}`);
    const started = performance.now();
    await shot.run(director);
    const ms = Math.round(performance.now() - started);
    status.results.push({ id: shot.id, name: shot.name, targetSeconds: shot.target, ms, keyAt: status.keyAt });
    console.info(`[demo] shot ${shot.id} done in ${(ms / 1000).toFixed(1)} s`);
    if (i < plan.length - 1) await sleep(1500);
  }
  director.beat('done');
  status.state = 'done';
  document.title = `Done: shot ${plan.map((s) => s.id).join(', ')}`;
}

/** Starts director mode (index.ts calls it only for ?demo=1 in dev builds). */
export function startDirector(world: World, api: GameDebugApi): void {
  const status: DemoStatus = {
    state: 'loading',
    device: null,
    plan: [],
    shot: null,
    beat: 'loading',
    keyAt: null,
    results: [],
    warnings: [],
    error: null,
  };
  window.__demo = status;
  direct(world, api, status).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    status.state = 'error';
    status.error = `${status.beat}: ${message}`;
    console.error(`[demo] stopped at "${status.beat}": ${message}`);
    showCard('Director mode stopped', status.error, true);
  });
}
