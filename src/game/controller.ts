import { PREVIEW_FRACTION } from '../config.js';
import type { SimOutcome } from '../sim/bodies.js';
import { SIM_DT } from '../sim/constants.js';
import { startPlacements, type LevelDef } from '../sim/level.js';
import {
  bodyPositionAt,
  createSimBodies,
  fullSampleCount,
  maxSampleCount,
  simulate,
  type SimBodies,
  type SimResult,
} from '../sim/simulate.js';
import { isFiniteVec, type Vec2 } from '../sim/vec.js';
import type { ExternalWell } from '../sim/wells.js';
import type { GameState } from './state.js';

export type GamePhase = 'placing' | 'flying' | 'solved' | 'failed';

/**
 * The first PREVIEW_FRACTION of a flight: xyz samples, read the first
 * `count`. The samples live in a buffer the controller reuses, so read them
 * before the next preview() call.
 */
export interface PreviewPath {
  readonly samples: Float32Array;
  readonly count: number;
  /**
   * For each teleport jump among the recorded samples, the index of the
   * first sample at or past its exit: no line may join a sample before it to
   * one at or after it (see segmentCrossesBreak). Read the first
   * `breakCount` entries; the array is reused like `samples`.
   */
  readonly breaks: Int32Array;
  readonly breakCount: number;
}

/** Teleport breaks a preview records at most. */
const MAX_PREVIEW_BREAKS = 8;

/** Writable xyz target for position queries (no allocation). */
export type XYZ = { [index: number]: number };

/**
 * Pure game flow for one board: level selection, committed planet placements,
 * launches and wall-clock playback of the precomputed flight. Frame rate never
 * touches the physics: launch() simulates the whole flight, tick() only
 * advances playback time.
 */
export class GameController {
  readonly levels: readonly LevelDef[];
  levelIndex = 0;
  phase: GamePhase = 'placing';
  /** Committed placements of the movable bodies. */
  placements: Record<string, Vec2> = {};
  /** Launches on the current level. */
  attempts = 0;
  lastResult: SimResult | null = null;
  lastOutcome: SimOutcome | null = null;
  /** Seconds of the current flight played back so far. */
  flightTime = 0;
  readonly solvedLevelIds = new Set<string>();
  /** Increments on every level load, so systems know to rebuild. */
  levelRevision = 0;
  /** Increments on every launch. */
  flightId = 0;
  /** Increments when the previewed placements (draft, committed or wells) change. */
  placementRevision = 0;

  /** Uncommitted drag placements; its tuples are owned here and written in place. */
  private draft: Record<string, [number, number]> | null = null;
  private wells: readonly ExternalWell[] = [];
  private simBodies!: SimBodies;
  private bodyIndex = new Map<string, number>();
  private previewRevision = -1;
  private previewValue: PreviewPath | null = null;
  private previewBuffer = new Float32Array(0);
  private readonly previewBreaks = new Int32Array(MAX_PREVIEW_BREAKS);
  private readonly scratch = new Float64Array(3);

  constructor(levels: readonly LevelDef[]) {
    if (levels.length === 0) throw new Error('GameController needs at least one level');
    this.levels = levels;
    this.loadLevel(0);
  }

  get level(): LevelDef {
    return this.levels[this.levelIndex];
  }

  get solved(): boolean {
    return this.phase === 'solved';
  }

  loadLevel(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.levels.length) {
      throw new RangeError(`No level at index ${index}`);
    }
    const level = this.levels[index];
    const placements = startPlacements(level);
    // Built before any state changes, so a throw leaves the old level loaded.
    const simBodies = createSimBodies(level, placements, this.wells);
    this.levelIndex = index;
    this.placements = placements;
    this.simBodies = simBodies;
    this.bodyIndex = new Map(level.bodies.map((b, i) => [b.id, i]));
    this.phase = 'placing';
    this.attempts = 0;
    this.lastResult = null;
    this.lastOutcome = null;
    this.flightTime = 0;
    this.draft = null;
    this.placementRevision++;
    this.levelRevision++;
  }

  /** Loads the next level, wrapping to the first after the last. */
  nextLevel(): void {
    this.loadLevel((this.levelIndex + 1) % this.levels.length);
  }

  /** Commits a movable body's board position; cancels a running flight. */
  setPlacement(id: string, p: Vec2): void {
    this.requireMovable(id, p);
    if (this.phase !== 'placing') this.cancelFlight();
    this.placements = { ...this.placements, [id]: [p[0], p[1]] };
    this.draft = null;
    this.rebuildBodies();
  }

  /** Shows an uncommitted drag position in the preview (allocates only on a drag's first call). */
  setDraft(id: string, p: Vec2): void {
    this.requireMovable(id, p);
    let draft = this.draft;
    if (!draft) {
      draft = {};
      for (const key of Object.keys(this.placements)) {
        const q = this.placements[key];
        draft[key] = [q[0], q[1]];
      }
      this.draft = draft;
    }
    const d = draft[id];
    d[0] = p[0];
    d[1] = p[1];
    this.placementRevision++;
  }

  clearDraft(): void {
    if (!this.draft) return;
    this.draft = null;
    this.placementRevision++;
  }

  /**
   * Real-object seam: extra gravity wells for every later flight, on every
   * level. Throws, changing nothing, when a well is invalid or its id is
   * used by a body of any level, so a later loadLevel cannot fail on it.
   */
  setExternalWells(wells: readonly ExternalWell[]): void {
    const copy = [...wells];
    for (const level of this.levels) createSimBodies(level, {}, copy); // validates
    this.wells = copy;
    this.rebuildBodies();
  }

  get externalWells(): readonly ExternalWell[] {
    return this.wells;
  }

  /**
   * The start of the flight for the drag draft, else the committed
   * placements. Memoized until placementRevision changes. The whole flight
   * still runs (its length sets how much is shown), but only the shown
   * samples are recorded, into a buffer reused across calls.
   */
  preview(): PreviewPath {
    if (this.previewValue && this.previewRevision === this.placementRevision) return this.previewValue;
    const level = this.level;
    const capacity = Math.max(2, Math.ceil(maxSampleCount(level) * PREVIEW_FRACTION));
    if (this.previewBuffer.length < capacity * 3) this.previewBuffer = new Float32Array(capacity * 3);
    const result = simulate(level, this.draft ?? this.placements, {
      externalWells: this.wells,
      maxSamples: capacity,
      sampleBuffer: this.previewBuffer,
    });
    // As many samples as PREVIEW_FRACTION of the complete recording holds.
    const full = fullSampleCount(result.steps, result.sampleEvery);
    const count = Math.min(result.sampleCount, Math.max(2, Math.ceil(full * PREVIEW_FRACTION)));
    // Sample i was taken at step i * sampleEvery; the first one at or past a
    // jump's step lies beyond its exit.
    let breakCount = 0;
    for (let j = 0; j < result.teleports.length && breakCount < MAX_PREVIEW_BREAKS; j++) {
      const index = Math.ceil(result.teleports[j].step / result.sampleEvery);
      if (index < result.sampleCount) this.previewBreaks[breakCount++] = index;
    }
    this.previewRevision = this.placementRevision;
    this.previewValue = { samples: this.previewBuffer, count, breaks: this.previewBreaks, breakCount };
    return this.previewValue;
  }

  /** Simulates the committed placements and starts playback. */
  launch(): SimResult {
    const result = simulate(this.level, this.placements, { externalWells: this.wells });
    this.attempts++;
    this.lastResult = result;
    this.phase = 'flying';
    this.flightTime = 0;
    this.clearDraft();
    this.flightId++;
    return result;
  }

  /** Stops playback (or clears a finished flight) and returns to placing. */
  cancelFlight(): void {
    this.phase = 'placing';
    this.flightTime = 0;
  }

  /** Advances playback; ends the flight when its simulated time is reached. */
  tick(dtSec: number): void {
    const result = this.lastResult;
    if (this.phase !== 'flying' || !result) return;
    this.flightTime += Math.max(0, dtSec);
    if (this.flightTime < result.time) return;
    this.flightTime = result.time;
    this.lastOutcome = result.outcome;
    if (result.outcome === 'solved') {
      this.phase = 'solved';
      this.solvedLevelIds.add(this.level.id);
    } else {
      this.phase = 'failed';
    }
  }

  /** Writes the comet's board position: its start while placing, else playback. */
  cometBoardPosition<T extends XYZ>(out: T): T {
    const result = this.lastResult;
    if (this.phase === 'placing' || !result) {
      const comet = this.level.comet;
      out[0] = comet.position[0];
      out[1] = comet.height ?? 0;
      out[2] = comet.position[1];
      return out;
    }
    const s = result.samples;
    const stepF = this.flightTime / SIM_DT;
    const i0 = Math.floor(stepF / result.sampleEvery);
    if (i0 >= result.sampleCount - 1) {
      const k = (result.sampleCount - 1) * 3;
      out[0] = s[k];
      out[1] = s[k + 1];
      out[2] = s[k + 2];
      return out;
    }
    const k = i0 * 3;
    let fromStep = i0 * result.sampleEvery;
    let toStep = Math.min(fromStep + result.sampleEvery, result.steps);
    let ax = s[k];
    let ay = s[k + 1];
    let az = s[k + 2];
    let bx = s[k + 3];
    let by = s[k + 4];
    let bz = s[k + 5];
    // A teleport between the two samples splits the interval: before the jump
    // the comet moves toward the entry point, after it away from the exit.
    const teleports = result.teleports;
    for (let j = 0; j < teleports.length; j++) {
      const tp = teleports[j];
      if (tp.step <= fromStep || tp.step > toStep) continue;
      if (stepF < tp.step) {
        bx = tp.entry[0];
        by = tp.entry[1];
        bz = tp.entry[2];
        toStep = tp.step;
      } else {
        ax = tp.exit[0];
        ay = tp.exit[1];
        az = tp.exit[2];
        fromStep = tp.step;
      }
    }
    const a = toStep > fromStep ? Math.min(1, Math.max(0, (stepF - fromStep) / (toStep - fromStep))) : 0;
    out[0] = ax + (bx - ax) * a;
    out[1] = ay + (by - ay) * a;
    out[2] = az + (bz - az) * a;
    return out;
  }

  /** Teleport jumps the playback has passed in the current flight (0 while placing). */
  get teleportsPassed(): number {
    const result = this.lastResult;
    if (this.phase === 'placing' || !result) return 0;
    const stepF = this.flightTime / SIM_DT;
    let passed = 0;
    for (let j = 0; j < result.teleports.length; j++) {
      if (result.teleports[j].step <= stepF) passed++;
    }
    return passed;
  }

  /**
   * Writes a level body's board position: committed placement for movable
   * bodies; orbiting moons at the flight time while flying, else at t = 0.
   * Returns false for an unknown id.
   */
  bodyBoardPosition(id: string, out: XYZ): boolean {
    const index = this.bodyIndex.get(id);
    if (index === undefined) return false;
    const t = this.phase === 'flying' ? this.flightTime : 0;
    bodyPositionAt(this.simBodies, index, t, this.scratch);
    out[0] = this.scratch[0];
    out[1] = this.scratch[1];
    out[2] = this.scratch[2];
    return true;
  }

  toState(): GameState {
    return {
      version: 1,
      levelId: this.level.id,
      placements: Object.fromEntries(
        Object.entries(this.placements).map(([id, p]) => [id, [p[0], p[1]] as Vec2]),
      ),
      attempts: this.attempts,
      solvedLevelIds: [...this.solvedLevelIds],
      lastOutcome: this.lastOutcome,
    };
  }

  /** Restores a saved state; throws on an unknown level or invalid placement. */
  fromState(state: GameState): void {
    const index = this.levels.findIndex((l) => l.id === state.levelId);
    if (index < 0) throw new Error(`Unknown level in game state: ${state.levelId}`);
    this.loadLevel(index);
    for (const [id, p] of Object.entries(state.placements)) this.setPlacement(id, p);
    this.attempts = state.attempts;
    this.solvedLevelIds.clear();
    for (const id of state.solvedLevelIds) this.solvedLevelIds.add(id);
    this.lastOutcome = state.lastOutcome;
  }

  private requireMovable(id: string, p: Vec2): void {
    const index = this.bodyIndex.get(id);
    if (index === undefined || !this.level.bodies[index].movable) {
      throw new Error(`${this.level.id}: ${id} is not a movable body`);
    }
    if (!Array.isArray(p) || p.length !== 2 || !isFiniteVec(p)) {
      throw new Error(`${this.level.id}: placement for ${id} must be a finite [x, z]`);
    }
  }

  private rebuildBodies(): void {
    this.simBodies = createSimBodies(this.level, this.placements, this.wells);
    this.placementRevision++;
  }
}
