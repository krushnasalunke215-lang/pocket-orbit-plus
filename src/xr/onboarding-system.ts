import { createSystem, Grabbed, Hovered } from '@iwsdk/core';
import { VISUAL_LIFT } from '../config.js';
import { attractFrame, type AttractFrame } from '../game/attract.js';
import type { GameController } from '../game/controller.js';
import { createGhostHandVisual } from '../render/ghost-hand-visual.js';
import type { GhostHandVisual } from '../render/visual-types.js';
import { simulate, type SimResult } from '../sim/simulate.js';
import { BoardBody } from './components.js';
import {
  getBoard,
  getCometOverride,
  getGame,
  getOnboarding,
  getOnboardingSession,
  getPause,
  getSettings,
  getSettingsRevision,
  markInteracted,
  setOnboarding,
} from './runtime.js';

/**
 * The first minutes, without text.
 *
 * Attract loop: until the first interaction of this page session (a body
 * hover or grab, a HUD, rim or level-select click, or a launch), while the
 * game is placing, the comet visual flies the current placements' flight
 * (untouched planets always miss), fades out and relaunches (see
 * src/game/attract.ts). It writes the visual-only CometOverride; the game's
 * phase, attempts and flight time never change, and it is silent because
 * the audio follows the game phase.
 *
 * Ghost hand: on level 1 while placing, until the player first grabs a body
 * (the onboarding flag ghostHandDone, saved by SaveSystem), a translucent
 * hand demonstrates pinch, drag and release on a copy of the planet (the
 * left hand, mirrored, in left-handed mode). It keeps moving under reduced
 * motion: it is the only tutorial, so its motion is essential.
 *
 * Runs after SaveSystem (the save decides ghostHandDone) and before
 * RenderSyncSystem (which draws the comet from the override). Both clocks
 * stop while the game is paused.
 */
export class OnboardingSystem extends createSystem({
  hovered: { required: [BoardBody, Hovered] },
  grabbed: { required: [BoardBody, Grabbed] },
}) {
  private game!: GameController;
  private ghost!: GhostHandVisual;
  private lastFlightId = 0;
  private attractResult: SimResult | null = null;
  private attractLevelRevision = -1;
  private attractPlacements: object | null = null;
  private attractTime = 0;
  private ghostTime = 0;
  private lastSettingsRevision = -1;
  private readonly frame: AttractFrame = { position: [0, 0, 0], alpha: 1 };
  private readonly from = [0, 0];
  private readonly to = [0, 0];

  init(): void {
    const game = getGame(this.world);
    const board = getBoard(this.world);
    if (!game || !board) throw new Error('OnboardingSystem needs GameSystem and BoardPlacementSystem first');
    this.game = game;
    this.lastFlightId = game.flightId;
    this.ghost = createGhostHandVisual();
    // At the floating planets' height.
    this.ghost.root.position.y = VISUAL_LIFT;
    this.world.createTransformEntity(this.ghost.root, { parent: board.entity });
    this.cleanupFuncs.push(
      this.queries.hovered.subscribe('qualify', () => markInteracted(this.world)),
      this.queries.grabbed.subscribe('qualify', () => this.onGrab()),
    );
  }

  /** The first grab ends both the attract loop and the ghost hand (for good: it is saved). */
  private onGrab(): void {
    markInteracted(this.world);
    if (!getOnboarding(this.world).ghostHandDone) setOnboarding(this.world, { ghostHandDone: true });
    this.ghost.setVisible(false);
    getOnboardingSession(this.world).ghostHandVisible = false;
  }

  update(delta: number): void {
    const game = this.game;
    const session = getOnboardingSession(this.world);
    const override = getCometOverride(this.world);
    // A launch (from any source) is an interaction.
    if (game.flightId !== this.lastFlightId) {
      session.interacted = true;
      this.lastFlightId = game.flightId;
    }
    const dt = getPause(this.world).paused ? 0 : delta;

    const attract = !session.interacted && game.phase === 'placing';
    if (attract) {
      if (
        !this.attractResult ||
        game.levelRevision !== this.attractLevelRevision ||
        game.placements !== this.attractPlacements
      ) {
        // An event, not per frame: a level load or a committed placement.
        this.attractResult = simulate(game.level, game.placements, { externalWells: game.activeWells });
        this.attractLevelRevision = game.levelRevision;
        this.attractPlacements = game.placements;
        this.attractTime = 0;
      }
      this.attractTime += dt;
      attractFrame(this.attractResult, this.attractTime, this.frame);
      const p = this.frame.position;
      override.position[0] = p[0];
      override.position[1] = p[1];
      override.position[2] = p[2];
      override.alpha = this.frame.alpha;
    } else if (this.attractResult) {
      this.attractResult = null;
    }
    override.active = attract;
    session.attract = attract;

    // Left-handed mode: the ghost hand demonstrates with the left hand.
    const settingsRevision = getSettingsRevision(this.world);
    if (settingsRevision !== this.lastSettingsRevision) {
      this.ghost.setLeftHanded(getSettings(this.world).leftHanded);
      this.lastSettingsRevision = settingsRevision;
    }

    const show = game.mode === 'story' && game.levelIndex === 0 && game.phase === 'placing' && !getOnboarding(this.world).ghostHandDone;
    if (show && this.ghostTargets()) {
      this.ghostTime += dt;
      this.ghost.update(this.ghostTime, this.from, this.to);
      this.ghost.setVisible(true);
      session.ghostHandVisible = true;
    } else {
      this.ghostTime = 0;
      this.ghost.setVisible(false);
      session.ghostHandVisible = false;
    }
    session.ghostHandTime = this.ghostTime;
  }

  /** The first movable body's start and its stored solution (false if the level has none). */
  private ghostTargets(): boolean {
    const level = this.game.level;
    for (let i = 0; i < level.bodies.length; i++) {
      const body = level.bodies[i];
      if (!body.movable) continue;
      const solution = level.solution[body.id];
      if (!solution) return false;
      this.from[0] = body.position[0];
      this.from[1] = body.position[1];
      this.to[0] = solution[0];
      this.to[1] = solution[1];
      return true;
    }
    return false;
  }
}
