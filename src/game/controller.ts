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
import { flightPositionAt } from './attract.js';
import { DEFAULT_PAR, flightNotes, matchesMelody, rungSequence, starRating, type FlightNote } from './song.js';
import type { GameState, OnboardingFlags, SavedSettings } from './state.js';

export type GamePhase = 'placing' | 'flying' | 'solved' | 'failed';

/** 'story': the chapter levels (never any external wells); 'sandbox': the Your Table targets. */
export type GameMode = 'story' | 'sandbox';

/** The story level to come back to from the sandbox (and what toState saves meanwhile). */
interface StoryResume {
  readonly index: number;
  readonly placements: Record<string, Vec2>;
  readonly attempts: number;
  readonly lastOutcome: SimOutcome | null;
}

/** Stars a solve earns. */
export type StarCount = 1 | 2 | 3;

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

const NO_WELLS: readonly ExternalWell[] = Object.freeze([]);

/** Writable xyz target for position queries (no allocation). */
export type XYZ = { [index: number]: number };

/**
 * Pure game flow for one board: level selection, committed planet placements,
 * launches and wall-clock playback of the precomputed flight. Frame rate never
 * touches the physics: launch() simulates the whole flight, tick() only
 * advances playback time.
 */
export class GameController {
  /** The story levels. */
  readonly levels: readonly LevelDef[];
  /** The Your Table targets (sandbox mode). */
  readonly sandboxLevels: readonly LevelDef[];
  mode: GameMode = 'story';
  /** Index into `levels` (in sandbox mode: the story level to return to). */
  levelIndex = 0;
  /** Index into `sandboxLevels` while in sandbox mode. */
  sandboxIndex = 0;
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
  /** Stars of the current flight: 0 until it solves. */
  lastStars: 0 | StarCount = 0;
  /** Level-body ids the solving flight rang, consecutive repeats collapsed (empty until a solve). */
  lastRung: string[] = [];
  /** One note per flyby of the last launched flight, in flyby order. */
  lastNotes: FlightNote[] = [];
  /** Best stars per level id (the maximum over every solve). */
  readonly bestStars = new Map<string, StarCount>();
  /** Increments whenever bestStars changes. */
  starsRevision = 0;

  /** Uncommitted drag placements; its tuples are owned here and written in place. */
  private draft: Record<string, [number, number]> | null = null;
  private wells: readonly ExternalWell[] = [];
  private storyResume: StoryResume | null = null;
  private simBodies!: SimBodies;
  private bodyIndex = new Map<string, number>();
  private previewRevision = -1;
  private previewValue: PreviewPath | null = null;
  private previewBuffer = new Float32Array(0);
  private readonly previewBreaks = new Int32Array(MAX_PREVIEW_BREAKS);
  private readonly scratch = new Float64Array(3);

  constructor(levels: readonly LevelDef[], sandboxLevels: readonly LevelDef[] = []) {
    if (levels.length === 0) throw new Error('GameController needs at least one level');
    this.levels = levels;
    this.sandboxLevels = sandboxLevels;
    this.loadLevel(0);
  }

  /** The loaded level: a story level, or a sandbox target in sandbox mode. */
  get level(): LevelDef {
    return this.mode === 'sandbox' ? this.sandboxLevels[this.sandboxIndex] : this.levels[this.levelIndex];
  }

  get solved(): boolean {
    return this.phase === 'solved';
  }

  /** Loads a story level (leaving the sandbox if it was open). */
  loadLevel(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.levels.length) {
      throw new RangeError(`No level at index ${index}`);
    }
    this.load('story', index);
    this.storyResume = null;
  }

  /**
   * Loads a Your Table target. Entering from story mode remembers the story
   * level (placements, attempts, last outcome) for exitSandbox and toState.
   */
  loadSandbox(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.sandboxLevels.length) {
      throw new RangeError(`No sandbox target at index ${index}`);
    }
    const resume: StoryResume | null =
      this.mode === 'story'
        ? { index: this.levelIndex, placements: this.placements, attempts: this.attempts, lastOutcome: this.lastOutcome }
        : this.storyResume;
    this.load('sandbox', index);
    this.storyResume = resume;
  }

  /** Back from the sandbox to the story level it was entered from, as it was left. */
  exitSandbox(): void {
    if (this.mode !== 'sandbox') return;
    const resume = this.storyResume;
    this.loadLevel(resume?.index ?? 0);
    if (!resume) return;
    this.placements = resume.placements;
    this.attempts = resume.attempts;
    this.lastOutcome = resume.lastOutcome;
    this.rebuildBodies();
  }

  private load(mode: GameMode, index: number): void {
    const level = mode === 'sandbox' ? this.sandboxLevels[index] : this.levels[index];
    const placements = startPlacements(level);
    // Built before any state changes, so a throw leaves the old level loaded.
    const simBodies = createSimBodies(level, placements, mode === 'sandbox' ? this.wells : []);
    this.mode = mode;
    if (mode === 'sandbox') this.sandboxIndex = index;
    else this.levelIndex = index;
    this.placements = placements;
    this.simBodies = simBodies;
    this.bodyIndex = new Map(level.bodies.map((b, i) => [b.id, i]));
    this.phase = 'placing';
    this.attempts = 0;
    this.lastResult = null;
    this.lastOutcome = null;
    this.flightTime = 0;
    this.lastStars = 0;
    this.lastRung = [];
    this.lastNotes = [];
    this.draft = null;
    this.placementRevision++;
    this.levelRevision++;
  }

  /** Loads the next level (in sandbox mode the next target), wrapping to the first after the last. */
  nextLevel(): void {
    if (this.mode === 'sandbox') this.loadSandbox((this.sandboxIndex + 1) % this.sandboxLevels.length);
    else this.loadLevel((this.levelIndex + 1) % this.levels.length);
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
   * Real-object seam: extra gravity wells for every later sandbox flight
   * (story flights never use them, so solver verification and stars stay
   * exact). They persist across target changes and mode switches. Throws,
   * changing nothing, when a well is invalid or its id is used by a body of
   * any story level or sandbox target, so a later load cannot fail on it.
   */
  setExternalWells(wells: readonly ExternalWell[]): void {
    const copy = [...wells];
    for (const level of [...this.levels, ...this.sandboxLevels]) createSimBodies(level, {}, copy); // validates
    this.wells = copy;
    this.rebuildBodies();
  }

  /** The wells set by setExternalWells (kept in every mode). */
  get externalWells(): readonly ExternalWell[] {
    return this.wells;
  }

  /** The wells the current level's flights use: the external wells in sandbox mode, none in story mode. */
  get activeWells(): readonly ExternalWell[] {
    return this.mode === 'sandbox' ? this.wells : NO_WELLS;
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
      externalWells: this.activeWells,
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
    const result = simulate(this.level, this.placements, { externalWells: this.activeWells });
    this.attempts++;
    this.lastResult = result;
    this.lastNotes = flightNotes(this.level, result.flybys);
    this.lastStars = 0;
    this.lastRung = [];
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

  /**
   * Advances playback; ends the flight when its simulated time is reached.
   * A story solve rates the flight: 3 stars when it rang the level's melody,
   * else 2 within par attempts, else 1. Sandbox solves earn no stars and
   * never count as solved story levels.
   */
  tick(dtSec: number): void {
    const result = this.lastResult;
    if (this.phase !== 'flying' || !result) return;
    this.flightTime += Math.max(0, dtSec);
    if (this.flightTime < result.time) return;
    this.flightTime = result.time;
    this.lastOutcome = result.outcome;
    if (result.outcome === 'solved' && this.mode === 'sandbox') {
      this.phase = 'solved';
    } else if (result.outcome === 'solved') {
      const level = this.level;
      this.phase = 'solved';
      this.solvedLevelIds.add(level.id);
      this.lastRung = rungSequence(level, result.flybys);
      const stars = starRating({
        solved: true,
        attempts: this.attempts,
        par: level.par ?? DEFAULT_PAR,
        melodyMatched: matchesMelody(level, result.flybys),
      }) as StarCount;
      this.lastStars = stars;
      if (stars > (this.bestStars.get(level.id) ?? 0)) {
        this.bestStars.set(level.id, stars);
        this.starsRevision++;
      }
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
    return flightPositionAt(result, this.flightTime, out);
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

  /**
   * The saveable state; settings and onboarding flags live outside the
   * controller. In sandbox mode it is the story level the sandbox was
   * entered from, so a reload always resumes a story level.
   */
  toState(settings: SavedSettings, onboarding: OnboardingFlags): GameState {
    const story: StoryResume =
      this.mode === 'sandbox' && this.storyResume
        ? this.storyResume
        : { index: this.levelIndex, placements: this.placements, attempts: this.attempts, lastOutcome: this.lastOutcome };
    return {
      version: 2,
      levelId: this.levels[story.index].id,
      placements: Object.fromEntries(
        Object.entries(story.placements).map(([id, p]) => [id, [p[0], p[1]] as Vec2]),
      ),
      attempts: story.attempts,
      solvedLevelIds: [...this.solvedLevelIds],
      stars: Object.fromEntries(this.bestStars),
      lastOutcome: story.lastOutcome,
      settings: { muted: settings.muted, volume: settings.volume, quiet: settings.quiet },
      onboarding: { ghostHandDone: onboarding.ghostHandDone },
    };
  }

  /**
   * Restores a saved state in the placing phase. A level id no longer in the
   * game falls back to the first level (its placements and attempts are
   * dropped; stars and solved ids are kept), and a placement for a body that
   * is not movable in the level is skipped, so an old save never fails to load.
   */
  fromState(state: GameState): void {
    const found = this.levels.findIndex((l) => l.id === state.levelId);
    this.loadLevel(Math.max(0, found));
    if (found >= 0) {
      for (const [id, p] of Object.entries(state.placements)) {
        const index = this.bodyIndex.get(id);
        if (index === undefined || !this.level.bodies[index].movable || !isFiniteVec(p)) continue;
        this.setPlacement(id, p);
      }
      this.attempts = state.attempts;
      this.lastOutcome = state.lastOutcome;
    }
    this.solvedLevelIds.clear();
    for (const id of state.solvedLevelIds) this.solvedLevelIds.add(id);
    this.bestStars.clear();
    for (const [id, stars] of Object.entries(state.stars)) this.bestStars.set(id, stars);
    this.starsRevision++;
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
    this.simBodies = createSimBodies(this.level, this.placements, this.activeWells);
    this.placementRevision++;
  }
}
