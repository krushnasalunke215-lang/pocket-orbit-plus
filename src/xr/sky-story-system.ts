import { createSystem } from '@iwsdk/core';
import { ARPEGGIO_STEP } from '../audio/engine.js';
import type { GameController, GamePhase } from '../game/controller.js';
import { chimeTimes, COSMOS_PLANET, CONSTELLATION, constellationState } from '../game/sky-story.js';
import { phraseSchedule } from '../game/song.js';
import { ARPEGGIO_DELAY } from './game-audio-system.js';
import {
  getChapter,
  getCometOverride,
  getCosmos,
  getGame,
  getPause,
  getSettings,
  onChapterComplete,
  type CosmosRuntime,
} from './runtime.js';

/** Seconds the solved comet takes to rise off the board into the sky. */
const RISE_SECONDS = 1.4;
/** How far it rises (board units above the play layer) before it is gone. */
const RISE_HEIGHT = 5;
/** The chapter whose constellation hangs in the sky. */
const CHAPTER = 1;
/** Which big planet answers each arpeggio note (the chord pulses them all). */
const CHIME_ORDER = [COSMOS_PLANET.giant, COSMOS_PLANET.green, COSMOS_PLANET.skyBlue, COSMOS_PLANET.moon];

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The sky answers the play (L4), all visual and skippable:
 *   a story solve launches the comet up off the board into the sky (the
 *   visual-only CometOverride, 1.4 s, ease-in, fading out at the top), then
 *   that level's star in the chapter constellation lights with a flash; any
 *   phase change, level load or the chapter moment ends it at once. With
 *   reduced motion there is no flight: the star fades in.
 *   The lit stars and their links (consecutive solved levels) are rebuilt
 *   from the saved solved levels, so a reload shows the same constellation.
 *   At chapter complete the links draw in order over 1.2 s (all at once
 *   with reduced motion) and the big cosmos planets pulse in time with the
 *   chapter arpeggio (the arpeggio stays the only sound).
 * Runs after OnboardingSystem (15) and ChapterSystem (16), which write the
 * comet override first, and before RenderSyncSystem (20), which draws it.
 */
export class SkyStorySystem extends createSystem({}) {
  private cosmos: CosmosRuntime | undefined;
  private built = false;
  private dirty = false;
  private lastStarsRevision = -1;
  private lastSolvedCount = -1;
  private lastLevelRevision = -1;
  private lastPhase: GamePhase | null = null;
  private linkKey = '';
  /** Chapter level index of the rising comet's star (-1: no rise). */
  private riseStar = -1;
  private riseTime = 0;
  /** The rise ended: the comet stays hidden until the phase changes. */
  private riseDone = false;
  private readonly from = [0, 0, 0];
  private chimes: number[] = [];
  private chimeClock = 0;
  private chimeNext = 0;

  init(): void {
    this.cosmos = getCosmos(this.world);
    this.cosmos?.visual.constellation.setStars(CONSTELLATION[CHAPTER] ?? []);
    this.cleanupFuncs.push(onChapterComplete(this.world, (chapter) => this.onChapter(chapter)));
  }

  update(delta: number): void {
    const game = getGame(this.world);
    const cosmos = this.cosmos;
    if (!game || !cosmos) return;
    const constellation = cosmos.visual.constellation;
    const dt = getPause(this.world).paused ? 0 : delta;
    const reduced = getSettings(this.world).reducedMotion;
    const chapterShown = getChapter(this.world)?.shown ?? false;

    // A level load, any phase change or the chapter moment ends a rise at once.
    if (game.levelRevision !== this.lastLevelRevision) {
      this.endRise();
      this.chimeNext = this.chimes.length;
      this.lastLevelRevision = game.levelRevision;
    }
    if (game.phase !== this.lastPhase) {
      this.endRise();
      if (game.phase === 'solved' && this.lastPhase === 'flying' && game.mode === 'story' && !chapterShown) {
        this.startRise(game, reduced);
      }
      this.lastPhase = game.phase;
    }
    if (chapterShown) this.endRise();

    // The lit stars and links, from the saved solved levels.
    if (!this.built || this.dirty || game.starsRevision !== this.lastStarsRevision || game.solvedLevelIds.size !== this.lastSolvedCount) {
      this.rebuild(game, !this.built);
      this.built = true;
      this.dirty = false;
      this.lastStarsRevision = game.starsRevision;
      this.lastSolvedCount = game.solvedLevelIds.size;
    }

    if (this.riseStar >= 0) {
      this.riseTime += dt;
      const u = Math.min(1, this.riseTime / RISE_SECONDS);
      const override = getCometOverride(this.world);
      override.active = true;
      override.position[0] = this.from[0];
      override.position[1] = this.from[1] + RISE_HEIGHT * u * u * u;
      override.position[2] = this.from[2];
      override.alpha = 1 - smoothstep(0.65, 1, u);
      if (u >= 1) {
        constellation.setLit(this.riseStar, true, true);
        constellation.flash(this.riseStar);
        this.riseStar = -1;
        this.riseDone = true;
        this.dirty = true;
      }
    } else if (this.riseDone) {
      // The comet became the star: keep it hidden until the phase changes.
      const override = getCometOverride(this.world);
      override.active = true;
      override.alpha = 0;
    }
    cosmos.solveRise = this.riseStar >= 0;

    if (this.chimeNext < this.chimes.length) {
      this.chimeClock += dt;
      while (this.chimeNext < this.chimes.length && this.chimes[this.chimeNext] <= this.chimeClock) {
        const k = this.chimeNext++;
        if (k === this.chimes.length - 1) {
          for (let i = 0; i < CHIME_ORDER.length; i++) cosmos.visual.pulse(CHIME_ORDER[i], 1);
        } else {
          cosmos.visual.pulse(CHIME_ORDER[k % CHIME_ORDER.length], 0.8);
        }
      }
    }
  }

  /** The chapter level index of the current level (-1 when it is not in the constellation's chapter). */
  private starIndex(game: GameController): number {
    if (game.mode !== 'story' || game.level.chapter !== CHAPTER) return -1;
    let index = 0;
    for (const level of game.levels) {
      if (level.chapter !== CHAPTER) continue;
      if (level.id === game.level.id) return index;
      index++;
    }
    return -1;
  }

  private startRise(game: GameController, reduced: boolean): void {
    const index = this.starIndex(game);
    if (index < 0) return;
    if (reduced) {
      // No flight: the star fades in.
      this.cosmos?.visual.constellation.setLit(index, true, false);
      return;
    }
    game.cometBoardPosition(this.from);
    this.riseStar = index;
    this.riseTime = 0;
  }

  /** Ends a rise now; its star lights without the flash (skipped). */
  private endRise(): void {
    if (this.riseStar >= 0) {
      this.cosmos?.visual.constellation.setLit(this.riseStar, true, false);
      this.riseStar = -1;
      this.dirty = true;
    }
    this.riseDone = false;
    if (this.cosmos) this.cosmos.solveRise = false;
  }

  /** Lights the solved levels' stars (instantly on the first build) and links consecutive ones (event-time only). */
  private rebuild(game: GameController, instant: boolean): void {
    const constellation = this.cosmos!.visual.constellation;
    const state = constellationState(game.levels, game.solvedLevelIds, CHAPTER);
    for (let i = 0; i < state.lit.length; i++) {
      if (i === this.riseStar) continue;
      constellation.setLit(i, state.lit[i], instant);
    }
    const links = state.links.filter(([a, b]) => a !== this.riseStar && b !== this.riseStar);
    const key = links.map(([a, b]) => `${a}-${b}`).join(',');
    if (key !== this.linkKey) {
      constellation.setLinks(links, false);
      this.linkKey = key;
    }
  }

  /** Chapter complete: the links draw in order and the big planets chime with the arpeggio. */
  private onChapter(chapter: number): void {
    const game = getGame(this.world);
    const cosmos = this.cosmos;
    if (!game || !cosmos || chapter !== CHAPTER) return;
    this.endRise();
    const reduced = getSettings(this.world).reducedMotion;
    const state = constellationState(game.levels, game.solvedLevelIds, CHAPTER);
    for (let i = 0; i < state.lit.length; i++) cosmos.visual.constellation.setLit(i, state.lit[i], true);
    cosmos.visual.constellation.setLinks(state.links, !reduced);
    this.linkKey = state.links.map(([a, b]) => `${a}-${b}`).join(',');
    const notes = phraseSchedule([], { chapter }).chord.midis.length;
    this.chimes = chimeTimes(notes, ARPEGGIO_DELAY, ARPEGGIO_STEP);
    this.chimeClock = 0;
    this.chimeNext = 0;
  }
}
