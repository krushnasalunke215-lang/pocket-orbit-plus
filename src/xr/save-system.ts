import { createSystem, Grabbed } from '@iwsdk/core';
import type { GameController, GamePhase } from '../game/controller.js';
import { clearGame, loadGame, saveGame, type KeyValueStore } from '../game/save.js';
import { BoardBody } from './components.js';
import {
  getGame,
  getOnboarding,
  getOnboardingRevision,
  getSettings,
  getSettingsRevision,
  setOnboarding,
  setSave,
  setSettings,
  type SaveRuntime,
} from './runtime.js';

/** localStorage, or null where reading the property itself throws (blocked storage). */
function browserStore(): KeyValueStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Autosave and resume. init() loads the save (src/game/save.ts) into the
 * GameController, the audio settings and the onboarding flags; a missing,
 * corrupt or unreadable save starts a fresh game and the problem is logged.
 * update() writes only when something persistent changed: the level, the
 * committed placements (the object GameController replaces on every
 * commit; drag drafts never count), a launch, a solve or failure, best
 * stars, settings or onboarding. Nothing is written while a planet is held.
 * Registered right after GameSystem, so the restored state is in place
 * before any other system reads it.
 */
export class SaveSystem extends createSystem({
  held: { required: [BoardBody, Grabbed] },
}) {
  private game!: GameController;
  private store: KeyValueStore | null = null;
  private status!: SaveRuntime;
  private levelRevision = -1;
  private placements: object | null = null;
  private flightId = -1;
  private phase: GamePhase | null = null;
  private starsRevision = -1;
  private settingsRevision = -1;
  private onboardingRevision = -1;

  init(): void {
    const game = getGame(this.world);
    if (!game) throw new Error('SaveSystem needs GameSystem registered first');
    this.game = game;
    this.store = browserStore();
    this.status = {
      lastSavedAt: null,
      problem: null,
      saveNow: () => this.write(),
      clear: () => clearGame(this.store),
    };
    setSave(this.world, this.status);

    const { state, problem } = loadGame(this.store);
    this.status.problem = problem;
    if (state) {
      try {
        game.fromState(state);
        setSettings(this.world, state.settings);
        setOnboarding(this.world, state.onboarding);
      } catch (error) {
        this.status.problem = `could not apply the save: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    if (this.status.problem) console.warn(`[save] starting fresh: ${this.status.problem}`);
    this.remember();
  }

  update(): void {
    const game = this.game;
    if (this.queries.held.entities.size > 0) return;
    const phase = game.phase;
    const finished = phase !== this.phase && (phase === 'solved' || phase === 'failed');
    if (
      finished ||
      game.levelRevision !== this.levelRevision ||
      game.placements !== this.placements ||
      game.flightId !== this.flightId ||
      game.starsRevision !== this.starsRevision ||
      getSettingsRevision(this.world) !== this.settingsRevision ||
      getOnboardingRevision(this.world) !== this.onboardingRevision
    ) {
      this.write();
    } else {
      this.phase = phase;
    }
  }

  /** Writes the current state and records what it covered. */
  private write(): boolean {
    const ok = saveGame(this.store, this.game.toState(getSettings(this.world), getOnboarding(this.world)));
    if (ok) this.status.lastSavedAt = performance.now();
    else this.status.problem = 'could not write the save (storage unavailable or full)';
    this.remember();
    return ok;
  }

  private remember(): void {
    const game = this.game;
    this.levelRevision = game.levelRevision;
    this.placements = game.placements;
    this.flightId = game.flightId;
    this.phase = game.phase;
    this.starsRevision = game.starsRevision;
    this.settingsRevision = getSettingsRevision(this.world);
    this.onboardingRevision = getOnboardingRevision(this.world);
  }
}
