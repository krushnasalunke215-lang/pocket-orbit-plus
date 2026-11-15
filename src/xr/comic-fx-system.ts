import { createSystem, DepthOccludable, OcclusionShadersMode } from '@iwsdk/core';
import type { GamePhase } from '../game/controller.js';
import { echoPlanet } from '../game/sky-story.js';
import { createComicWords, type ComicWords } from '../render/comic-words.js';
import { getBoard, getCosmos, getGame, getPause, getSettings, setComicWords } from './runtime.js';

/** Height above a body's center where its word starts (board units). */
const ABOVE = 0.06;

/**
 * Comic onomatopoeia on the board (src/render/comic-words.ts), driven by the
 * game state only (independent of the audio unlock): WHOOSH! when a flight
 * starts, DING! at each body the comet passes (ZAP! off the white star), as
 * the flight reaches each flyby note (and the matching cosmos planet pulses,
 * see echoPlanet); KA-POW! at the target on a solve and
 * BOOM! at the black hole that swallows the comet. Nothing advances while
 * the game is paused.
 */
export class ComicFxSystem extends createSystem({}) {
  private words!: ComicWords;
  private lastFlightId = -1;
  private lastLevelRevision = -1;
  private lastPhase: GamePhase | null = null;
  private cursor = 0;
  private readonly pos = [0, 0, 0];
  private readonly comet = [0, 0, 0];

  init(): void {
    const board = getBoard(this.world);
    const game = getGame(this.world);
    if (!board || !game) throw new Error('ComicFxSystem needs BoardPlacementSystem and GameSystem first');
    this.words = createComicWords();
    const entity = this.world.createTransformEntity(this.words.mesh, { parent: board.entity });
    entity.addComponent(DepthOccludable, { mode: OcclusionShadersMode.HardOcclusion });
    this.lastFlightId = game.flightId;
    this.lastLevelRevision = game.levelRevision;
    this.lastPhase = game.phase;
    setComicWords(this.world, this.words);
  }

  update(delta: number): void {
    const game = getGame(this.world);
    if (!game) return;
    const paused = getPause(this.world).paused;
    this.words.update(paused ? 0 : delta, getSettings(this.world).reducedMotion);
    if (paused) return;

    if (game.levelRevision !== this.lastLevelRevision) {
      this.lastLevelRevision = game.levelRevision;
      this.lastFlightId = game.flightId;
      this.lastPhase = game.phase;
      this.cursor = 0;
      return;
    }
    if (game.flightId !== this.lastFlightId) {
      this.lastFlightId = game.flightId;
      this.cursor = 0;
      const c = game.level.comet;
      this.words.pop('WHOOSH!', c.position[0], (c.height ?? 0) + ABOVE, c.position[1]);
    }
    if (game.phase !== 'placing') this.ringFlybys();

    const phase = game.phase;
    if (phase !== this.lastPhase) {
      if (phase === 'solved') {
        const t = game.level.target;
        this.words.pop('KA-POW!', t.position[0], (t.height ?? 0) + ABOVE, t.position[1]);
      } else if (phase === 'failed' && game.lastOutcome === 'swallowed') {
        this.popAtNearestHole();
      }
      this.lastPhase = phase;
    }
  }

  /** One word per flyby note whose time the flight has reached. */
  private ringFlybys(): void {
    const game = getGame(this.world)!;
    const notes = game.lastNotes;
    const t = game.flightTime;
    while (this.cursor < notes.length && notes[this.cursor].time <= t) {
      const note = notes[this.cursor++];
      const def = game.level.bodies.find((b) => b.id === note.bodyId);
      if (def && game.bodyBoardPosition(note.bodyId, this.pos)) {
        this.words.pop(def.kind === 'repulsor' ? 'ZAP!' : 'DING!', this.pos[0], this.pos[1] + ABOVE, this.pos[2]);
        // The matching distant planet answers in the sky.
        getCosmos(this.world)?.visual.pulse(echoPlanet(def.kind, Boolean(def.movable)), 1);
      } else {
        // A Your Table well: ring where the comet is.
        game.cometBoardPosition(this.comet);
        this.words.pop('DING!', this.comet[0], this.comet[1] + ABOVE, this.comet[2]);
      }
    }
  }

  private popAtNearestHole(): void {
    const game = getGame(this.world)!;
    game.cometBoardPosition(this.comet);
    let best = Infinity;
    let found = false;
    let bx = this.comet[0];
    let by = this.comet[1];
    let bz = this.comet[2];
    for (const body of game.level.bodies) {
      if (body.kind !== 'black-hole' || !game.bodyBoardPosition(body.id, this.pos)) continue;
      const d = Math.hypot(this.pos[0] - this.comet[0], this.pos[2] - this.comet[2]);
      if (d < best) {
        best = d;
        found = true;
        bx = this.pos[0];
        by = this.pos[1];
        bz = this.pos[2];
      }
    }
    this.words.pop('BOOM!', bx, (found ? by : by) + ABOVE, bz);
  }
}
