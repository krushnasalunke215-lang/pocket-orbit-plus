import { PREVIEW_FRACTION } from '../config.js';
import type { SimOutcome } from '../sim/bodies.js';
import { SIM_DT } from '../sim/constants.js';
import { startPlacements, type LevelDef, type Placements } from '../sim/level.js';
import { bodyPositionAt, createSimBodies, simulate, type SimBodies, type SimResult } from '../sim/simulate.js';
import { isFiniteVec, type Vec2 } from '../sim/vec.js';
import type { ExternalWell } from '../sim/wells.js';
import type { GameState } from './state.js';

export type GamePhase = 'placing' | 'flying' | 'solved' | 'failed';

/** The first PREVIEW_FRACTION of a flight: xyz samples, read the first `count`. */
export interface PreviewPath {
  readonly samples: Float32Array;
  readonly count: number;
}

/** Writable xyz target for position queries (no allocation). */
export type XYZ = { [index: number]: number };

function samePlacements(a: Placements, b: Placements): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    const p = a[key];
    const q = b[key];
    if (!q || p[0] !== q[0] || p[1] !== q[1]) return false;
  }
  return true;
}

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

  private draft: Record<string, Vec2> | null = null;
  private wells: readonly ExternalWell[] = [];
  private simBodies!: SimBodies;
  private bodyIndex = new Map<string, number>();
  private previewFor: Placements | null = null;
  private previewValue: PreviewPath | null = null;
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
    this.levelIndex = index;
    this.placements = startPlacements(this.level);
    this.phase = 'placing';
    this.attempts = 0;
    this.lastResult = null;
    this.lastOutcome = null;
    this.flightTime = 0;
    this.draft = null;
    this.bodyIndex = new Map(this.level.bodies.map((b, i) => [b.id, i]));
    this.rebuildBodies();
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

  /** Shows an uncommitted drag position in the preview. */
  setDraft(id: string, p: Vec2): void {
    this.requireMovable(id, p);
    this.draft = { ...this.placements, [id]: [p[0], p[1]] };
    this.placementRevision++;
  }

  clearDraft(): void {
    if (!this.draft) return;
    this.draft = null;
    this.placementRevision++;
  }

  /** Real-object seam: extra gravity wells for every later flight. */
  setExternalWells(wells: readonly ExternalWell[]): void {
    const copy = [...wells];
    createSimBodies(this.level, this.placements, copy); // validates
    this.wells = copy;
    this.previewFor = null;
    this.rebuildBodies();
  }

  get externalWells(): readonly ExternalWell[] {
    return this.wells;
  }

  /**
   * The start of the flight for the given placements (default: the drag
   * draft, else the committed placements). Memoized on the placements.
   */
  preview(placements?: Placements): PreviewPath {
    const target = placements ?? this.draft ?? this.placements;
    if (this.previewValue && this.previewFor && samePlacements(this.previewFor, target)) {
      return this.previewValue;
    }
    const result = simulate(this.level, target, { externalWells: this.wells });
    const count = Math.min(result.sampleCount, Math.max(2, Math.ceil(result.sampleCount * PREVIEW_FRACTION)));
    this.previewFor = { ...target };
    this.previewValue = { samples: result.samples, count };
    return this.previewValue;
  }

  /** Simulates the committed placements and starts playback. */
  launch(): SimResult {
    const result = simulate(this.level, this.placements, { externalWells: this.wells });
    this.attempts++;
    this.lastResult = result;
    this.phase = 'flying';
    this.flightTime = 0;
    this.draft = null;
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
    const step0 = i0 * result.sampleEvery;
    const step1 = Math.min(step0 + result.sampleEvery, result.steps);
    const a = step1 > step0 ? Math.min(1, Math.max(0, (stepF - step0) / (step1 - step0))) : 0;
    const k = i0 * 3;
    out[0] = s[k] + (s[k + 3] - s[k]) * a;
    out[1] = s[k + 1] + (s[k + 4] - s[k + 1]) * a;
    out[2] = s[k + 2] + (s[k + 5] - s[k + 2]) * a;
    return out;
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
    const body = this.level.bodies.find((b) => b.id === id);
    if (!body || !body.movable) throw new Error(`${this.level.id}: ${id} is not a movable body`);
    if (!Array.isArray(p) || p.length !== 2 || !isFiniteVec(p)) {
      throw new Error(`${this.level.id}: placement for ${id} must be a finite [x, z]`);
    }
  }

  private rebuildBodies(): void {
    this.simBodies = createSimBodies(this.level, this.placements, this.wells);
    this.previewFor = null;
    this.placementRevision++;
  }
}
