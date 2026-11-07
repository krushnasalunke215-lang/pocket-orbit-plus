import { createSystem } from '@iwsdk/core';
import { HALOS } from '../render/halo-sprites.js';
import { ROLE_COLORS } from '../render/palette.js';
import { playChapterArpeggio } from './game-audio-system.js';
import {
  emitChapterComplete,
  getCometOverride,
  getGame,
  getPause,
  setChapter,
  type ChapterRuntime,
} from './runtime.js';

/** Most constellation stars (one per chapter level). */
const MAX_STARS = 6;
/** Ring radius of the constellation and of the comet's loop (board units). */
const RING_RADIUS = 0.55;
const COMET_LOOP_RADIUS = 0.8;
/** Height the stars rise to above the board (board units) and how long it takes (s). */
const TOP_HEIGHT = 0.5;
const RISE_SECONDS = 1.8;
/** The lively part of the moment (s); afterwards it holds, calmer, until a choice. */
const CELEBRATION_SECONDS = 6;
const UNLIT_COLOR = 0x8090a8;

const easeOut = (x: number): number => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;

/**
 * The chapter-complete moment (placeholder art). HudSystem shows it when the
 * player presses Next on a chapter's last level (GameController.nextLevel
 * keeps wrapping; the HUD decides). A ring of one star per chapter level
 * (HALOS sprites) rises above the board, each lit by that level's best
 * stars, while the comet loops slowly around them (the visual-only
 * CometOverride) and the chapter chord plays as an arpeggio. It is lively
 * for about CELEBRATION_SECONDS, then holds until a choice: the HUD shows
 * 'Chapter N complete: S of M stars' with Levels and Play again. Loading any
 * level hides it. ChapterEvents listeners (onChapterComplete in runtime.ts,
 * the Phase 3 sky gallery hook) are told on every show.
 */
export class ChapterSystem extends createSystem({}) {
  private runtime!: ChapterRuntime;
  private readonly slots: number[] = [];
  private readonly best = new Array<number>(MAX_STARS).fill(0);
  private count = 0;
  private time = 0;
  private shownLevelRevision = -1;

  init(): void {
    this.runtime = {
      shown: false,
      chapter: 0,
      stars: 0,
      maxStars: 0,
      revision: 0,
      show: (chapter) => this.show(chapter),
      hide: () => this.hide(),
    };
    setChapter(this.world, this.runtime);
  }

  private show(chapter: number): void {
    const game = getGame(this.world);
    if (!game) return;
    if (this.runtime.shown) this.hide();
    const levels = game.levels.filter((l) => l.chapter === chapter);
    let stars = 0;
    this.count = Math.min(MAX_STARS, levels.length);
    for (let i = 0; i < levels.length; i++) {
      const best = game.bestStars.get(levels[i].id) ?? 0;
      stars += best;
      if (i < MAX_STARS) this.best[i] = best;
    }
    for (let i = 0; i < this.count; i++) {
      const lit = this.best[i] > 0;
      this.slots.push(HALOS.allocate(lit ? ROLE_COLORS.target : UNLIT_COLOR, lit ? 0.45 + 0.15 * this.best[i] : 0.22));
    }
    const runtime = this.runtime;
    runtime.shown = true;
    runtime.chapter = chapter;
    runtime.stars = stars;
    runtime.maxStars = 3 * levels.length;
    runtime.revision++;
    this.time = 0;
    this.shownLevelRevision = game.levelRevision;
    playChapterArpeggio(this.world, chapter);
    emitChapterComplete(this.world, chapter, stars);
  }

  private hide(): void {
    if (!this.runtime.shown) return;
    for (const slot of this.slots) HALOS.release(slot);
    this.slots.length = 0;
    this.runtime.shown = false;
    this.runtime.revision++;
  }

  update(delta: number): void {
    if (!this.runtime.shown) return;
    const game = getGame(this.world);
    if (!game || game.levelRevision !== this.shownLevelRevision) {
      this.hide();
      return;
    }
    if (!getPause(this.world).paused) this.time += delta;
    const t = this.time;
    const rise = easeOut(t / RISE_SECONDS);
    const height = 0.05 + (TOP_HEIGHT - 0.05) * rise;
    const radius = RING_RADIUS * (0.35 + 0.65 * rise);
    const lively = t < CELEBRATION_SECONDS;
    const spin = t * 0.22;
    for (let i = 0; i < this.slots.length; i++) {
      const a = spin + (i / this.count) * Math.PI * 2;
      const best = this.best[i];
      const base = best > 0 ? 0.08 + 0.035 * best : 0.05;
      const twinkle = lively ? 1 + 0.3 * Math.sin(t * 6 + i * 1.7) : 1 + 0.08 * Math.sin(t * 2 + i);
      HALOS.setPosition(this.slots[i], Math.cos(a) * radius, height, Math.sin(a) * radius);
      HALOS.setSize(this.slots[i], base * twinkle * (0.3 + 0.7 * rise));
    }
    // The comet circles the constellation, a little below it.
    const override = getCometOverride(this.world);
    const c = -t * (lively ? 0.9 : 0.5);
    override.active = true;
    override.position[0] = Math.cos(c) * COMET_LOOP_RADIUS;
    override.position[1] = height * 0.7;
    override.position[2] = Math.sin(c) * COMET_LOOP_RADIUS;
    override.alpha = 1;
  }
}
