import { AudioContext as ThreeAudioContext, createSystem, Grabbed, Vector3, type Entity } from '@iwsdk/core';
import { AudioEngine } from '../audio/engine.js';
import type { GameController, GamePhase } from '../game/controller.js';
import { phraseSchedule, type FlightNote } from '../game/song.js';
import { LEVEL_SOURCE } from '../sim/simulate.js';
import { BoardBody } from './components.js';
import {
  getBoard,
  getGame,
  getPause,
  getSettings,
  getSettingsRevision,
  getVisuals,
  onPauseChange,
  setAudio,
  type BoardRuntime,
} from './runtime.js';

/** Seconds from the solving frame to the first phrase note. */
const PHRASE_DELAY = 0.35;
/** Seconds from the failing frame to the miss glide. */
const MISS_DELAY = 0.05;
/** Comet speeds above this (m/s) are teleport jumps, not motion. */
const MAX_COMET_SPEED = 3;
/** Speed smoothing rate (1/s). */
const SPEED_SMOOTHING = 8;

/**
 * "Every solution is a song": plays the AudioEngine from game state. While a
 * flight plays back, each flyby rings its body's note once its time has
 * passed (at most a frame late), from the body's current world position,
 * and the whoosh follows the comet. A solve replays the rung notes as a
 * phrase and closes on the chord; a failure plays the miss glide; picking up
 * and dropping a body ticks. Audio unlocks on the first pointerdown or
 * keydown, or when an XR session starts, and the context is suspended while
 * the game is paused (see LifecycleSystem). Named GameAudioSystem so it does
 * not clash with IWSDK's built-in AudioSystem, which owns the listener on
 * the head. Every sound is recorded in the engine's event log.
 */
export class GameAudioSystem extends createSystem({
  held: { required: [BoardBody, Grabbed] },
}) {
  private engine!: AudioEngine;
  private cursor = 0;
  private lastFlightId = -1;
  private lastLevelRevision = -1;
  private lastPhase: GamePhase | null = null;
  private lastSettingsRevision = -1;
  private speed = 0;
  private hasLastComet = false;
  private readonly comet = [0, 0, 0];
  private readonly lastComet = [0, 0, 0];
  private readonly pos = new Vector3();

  init(): void {
    // three's typings name its own class as the return type; at runtime it is
    // the shared native context that AudioSystem's head listener uses.
    const engine = new AudioEngine(ThreeAudioContext.getContext() as unknown as AudioContext);
    this.engine = engine;
    setAudio(this.world, engine);

    const onGesture = () => {
      engine.unlock();
      removeGestureListeners();
    };
    const removeGestureListeners = () => {
      window.removeEventListener('pointerdown', onGesture, true);
      window.removeEventListener('keydown', onGesture, true);
    };
    window.addEventListener('pointerdown', onGesture, true);
    window.addEventListener('keydown', onGesture, true);
    const onSessionStart = () => engine.unlock();
    const xr = this.renderer.xr;
    xr.addEventListener('sessionstart', onSessionStart);
    this.cleanupFuncs.push(
      removeGestureListeners,
      () => xr.removeEventListener('sessionstart', onSessionStart),
      // Pause (XR blurred or hidden, page hidden): suspend the context and
      // silence the whoosh; resume only if audio was ever unlocked.
      onPauseChange(this.world, (pause) => (pause.paused ? engine.suspend() : engine.resume())),
      this.queries.held.subscribe('qualify', (entity) => this.onHold(entity, true)),
      this.queries.held.subscribe('disqualify', (entity) => this.onHold(entity, false)),
    );
  }

  update(delta: number): void {
    const game = getGame(this.world);
    const board = getBoard(this.world);
    if (!game || !board) return;
    const engine = this.engine;

    const settingsRevision = getSettingsRevision(this.world);
    if (settingsRevision !== this.lastSettingsRevision) {
      engine.applySettings(getSettings(this.world));
      this.lastSettingsRevision = settingsRevision;
    }
    // Paused: playback is frozen and the context suspended; keep the whoosh silent.
    if (getPause(this.world).paused) return;

    if (game.flightId !== this.lastFlightId || game.levelRevision !== this.lastLevelRevision) {
      this.cursor = 0;
      this.hasLastComet = false;
      this.speed = 0;
      this.lastFlightId = game.flightId;
      this.lastLevelRevision = game.levelRevision;
    }

    const phase = game.phase;
    if (phase !== 'placing') this.ringFlybys(game, board);
    if (phase !== this.lastPhase && this.lastPhase === 'flying') {
      if (phase === 'solved') this.playSolve(game);
      else if (phase === 'failed' && engine.unlocked) {
        const at = engine.now + MISS_DELAY;
        engine.playMiss(at);
        engine.log.record('miss', '', '', game.flightId, game.flightTime, at, -1);
      }
    }
    this.updateWhoosh(game, board, phase === 'flying', delta);
    this.lastPhase = phase;
  }

  /** Rings every note of the current flight whose flyby time has passed. */
  private ringFlybys(game: GameController, board: BoardRuntime): void {
    const notes = game.lastNotes;
    const t = game.flightTime;
    while (this.cursor < notes.length && notes[this.cursor].time <= t) {
      const note = notes[this.cursor++];
      if (!this.engine.unlocked) continue;
      this.noteWorldPosition(game, board, note, this.pos);
      const at = this.engine.playNoteAt(note.midi, this.pos.x, this.pos.y, this.pos.z);
      this.engine.log.record('flyby', note.bodyId, note.source, game.flightId, t, at, note.midi);
    }
  }

  /** Where a flyby's body is now: the body entity, or a well under the board root. */
  private noteWorldPosition(game: GameController, board: BoardRuntime, note: FlightNote, out: Vector3): void {
    const root = board.entity.object3D!;
    if (note.source === LEVEL_SOURCE) {
      const visual = getVisuals(this.world)?.bodies.get(note.bodyId);
      if (visual) {
        visual.root.getWorldPosition(out);
        return;
      }
    } else {
      const wells = game.externalWells;
      for (let i = 0; i < wells.length; i++) {
        const p = wells[i].position;
        if (wells[i].id === note.bodyId) {
          root.localToWorld(out.set(p[0], p[1], p[2]));
          return;
        }
      }
    }
    root.getWorldPosition(out);
  }

  /**
   * The solve phrase: the flight's notes in ring order (consecutive repeats
   * collapsed, so a story level plays exactly its rung sequence), then the
   * chapter chord. Non-spatial, like a replay.
   */
  private playSolve(game: GameController): void {
    const engine = this.engine;
    if (!engine.unlocked) return;
    const phrase: FlightNote[] = [];
    for (const note of game.lastNotes) {
      if (phrase.length === 0 || phrase[phrase.length - 1].bodyId !== note.bodyId) phrase.push(note);
    }
    const schedule = phraseSchedule(phrase, { chapter: game.level.chapter });
    const start = engine.now + PHRASE_DELAY;
    for (let i = 0; i < schedule.notes.length; i++) {
      const at = start + schedule.notes[i].at;
      engine.playBell(schedule.notes[i].midi, at);
      engine.log.record('phrase', phrase[i].bodyId, phrase[i].source, game.flightId, game.flightTime, at, phrase[i].midi);
    }
    const chordAt = start + schedule.chord.at;
    engine.playChord(schedule.chord.midis, chordAt);
    engine.log.record('chord', '', '', game.flightId, game.flightTime, chordAt, schedule.chord.midis[0]);
  }

  /** Comet speed (m/s, smoothed) drives the whoosh; its panner follows the comet. */
  private updateWhoosh(game: GameController, board: BoardRuntime, flying: boolean, delta: number): void {
    const engine = this.engine;
    if (!flying) {
      engine.silenceWhoosh();
      this.hasLastComet = false;
      this.speed = 0;
      return;
    }
    const c = game.cometBoardPosition(this.comet);
    if (this.hasLastComet && delta > 0) {
      const d = Math.hypot(c[0] - this.lastComet[0], c[1] - this.lastComet[1], c[2] - this.lastComet[2]);
      const raw = Math.min(MAX_COMET_SPEED, (d * board.pose.radius) / delta);
      this.speed += (raw - this.speed) * Math.min(1, delta * SPEED_SMOOTHING);
    }
    this.lastComet[0] = c[0];
    this.lastComet[1] = c[1];
    this.lastComet[2] = c[2];
    this.hasLastComet = true;
    board.entity.object3D!.localToWorld(this.pos.set(c[0], c[1], c[2]));
    engine.setWhoosh(this.speed, this.pos.x, this.pos.y, this.pos.z);
  }

  private onHold(entity: Entity, up: boolean): void {
    const engine = this.engine;
    if (!engine.unlocked) return;
    const game = getGame(this.world);
    const at = engine.now;
    engine.playTick(up, at);
    // A disposed entity (level change mid-hold) may have lost BoardBody already.
    const bodyId = entity.hasComponent(BoardBody) ? (entity.getValue(BoardBody, 'bodyId') as string) : '';
    engine.log.record(
      up ? 'pickup' : 'drop',
      bodyId,
      '',
      game?.flightId ?? 0,
      game?.flightTime ?? 0,
      at,
      -1,
    );
  }
}
