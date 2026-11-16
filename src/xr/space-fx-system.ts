import { createSystem, DepthOccludable, OcclusionShadersMode } from '@iwsdk/core';
import { VISUAL_LIFT } from '../config.js';
import type { GamePhase } from '../game/controller.js';
import { echoPlanet } from '../game/sky-story.js';
import { createSpaceFx, type SpaceFx } from '../render/space-fx.js';
import { SHARED_TIME } from '../render/shaders/common.js';
import { getBoard, getCosmos, getGame, getPause, getSettings, getVisuals, setSpaceFx } from './runtime.js';

/** Supernova colour at a solve (warm white; the shell's fringe adds the blue and orange). */
const BURST_COLOR = 0xffe2b0;

/**
 * Light feedback on the board (src/render/space-fx.ts and the grid's
 * ripples), driven by the game state only (independent of the audio
 * unlock). As the flight reaches each flyby note, the passed body flashes,
 * the spacetime grid ripples out from it (stronger off the white star) and
 * the matching cosmos planet pulses (echoPlanet). A black hole that swallows
 * the comet flashes its lens and the grid ripples inward to it; a solve
 * sets off a supernova-like burst at the target (flash, shock shell, rays)
 * and a strong ripple. Nothing at the launch. Under reduced motion the
 * ripples and the expanding effects are skipped (the flashes stay).
 * Nothing advances while the game is paused.
 */
export class SpaceFxSystem extends createSystem({}) {
  private fx!: SpaceFx;
  private lastFlightId = -1;
  private lastLevelRevision = -1;
  private lastPhase: GamePhase | null = null;
  private cursor = 0;
  private readonly pos = [0, 0, 0];
  private readonly comet = [0, 0, 0];

  init(): void {
    const board = getBoard(this.world);
    const game = getGame(this.world);
    if (!board || !game) throw new Error('SpaceFxSystem needs BoardPlacementSystem and GameSystem first');
    this.fx = createSpaceFx();
    const entity = this.world.createTransformEntity(this.fx.mesh, { parent: board.entity });
    entity.addComponent(DepthOccludable, { mode: OcclusionShadersMode.HardOcclusion });
    this.lastFlightId = game.flightId;
    this.lastLevelRevision = game.levelRevision;
    this.lastPhase = game.phase;
    setSpaceFx(this.world, this.fx);
  }

  update(delta: number): void {
    const game = getGame(this.world);
    if (!game) return;
    const paused = getPause(this.world).paused;
    this.fx.update(paused ? 0 : delta, getSettings(this.world).reducedMotion);
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
    }
    if (game.phase !== 'placing') this.ringFlybys();

    const phase = game.phase;
    if (phase !== this.lastPhase) {
      if (phase === 'solved') this.solveBurst();
      else if (phase === 'failed' && game.lastOutcome === 'swallowed') this.captureFlash();
      this.lastPhase = phase;
    }
  }

  /** Grid ripples off the board (none with reduced motion). */
  private ripple(x: number, z: number, strength: number): void {
    if (getSettings(this.world).reducedMotion) return;
    getBoard(this.world)?.visual.ripple(x, z, strength, SHARED_TIME.value);
  }

  /** One flash and ripple per flyby note whose time the flight has reached. */
  private ringFlybys(): void {
    const game = getGame(this.world)!;
    const notes = game.lastNotes;
    const t = game.flightTime;
    while (this.cursor < notes.length && notes[this.cursor].time <= t) {
      const note = notes[this.cursor++];
      const def = game.level.bodies.find((b) => b.id === note.bodyId);
      if (def && game.bodyBoardPosition(note.bodyId, this.pos)) {
        const push = def.kind === 'repulsor';
        this.fx.note(push ? 'push' : 'flyby');
        getVisuals(this.world)?.bodies.get(def.id)?.flash(1);
        // The white star pushes a stronger ring outward.
        this.ripple(this.pos[0], this.pos[2], push ? 1.5 : 1);
        // The matching distant planet answers in the sky.
        getCosmos(this.world)?.visual.pulse(echoPlanet(def.kind, Boolean(def.movable)), 1);
      } else {
        // A Your Table well: the grid ripples where the comet is.
        this.fx.note('flyby');
        game.cometBoardPosition(this.comet);
        this.ripple(this.comet[0], this.comet[2], 1);
      }
    }
  }

  /** The swallowing black hole (nearest the comet) flashes its lens; the grid ripples inward to it. */
  private captureFlash(): void {
    const game = getGame(this.world)!;
    game.cometBoardPosition(this.comet);
    let best = Infinity;
    let id: string | null = null;
    let bx = this.comet[0];
    let bz = this.comet[2];
    for (const body of game.level.bodies) {
      if (body.kind !== 'black-hole' || !game.bodyBoardPosition(body.id, this.pos)) continue;
      const d = Math.hypot(this.pos[0] - this.comet[0], this.pos[2] - this.comet[2]);
      if (d < best) {
        best = d;
        id = body.id;
        bx = this.pos[0];
        bz = this.pos[2];
      }
    }
    this.fx.note('capture');
    if (id !== null) getVisuals(this.world)?.bodies.get(id)?.flash(1.5);
    this.ripple(bx, bz, -1.5);
  }

  /** The supernova at the target star and a strong ripple. */
  private solveBurst(): void {
    const game = getGame(this.world)!;
    const target = getVisuals(this.world)?.target;
    if (target) {
      target.starPose(this.pos);
    } else {
      const t = game.level.target;
      this.pos[0] = t.position[0];
      this.pos[1] = (t.height ?? 0) + VISUAL_LIFT;
      this.pos[2] = t.position[1];
    }
    this.fx.note('solve');
    this.fx.burst(this.pos[0], this.pos[1], this.pos[2], BURST_COLOR);
    this.ripple(this.pos[0], this.pos[2], 1.5);
  }
}
