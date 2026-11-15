import type { BodyKind } from '../sim/bodies.js';
import type { LevelDef } from '../sim/level.js';

/*
 * The surround answers the play (L4), as pure rules: which distant cosmos
 * planet echoes each board body's flyby note, where each chapter level's
 * star sits in the sky, which stars are lit and linked (derived from the
 * saved solved levels, no anchors), and when the big planets chime with the
 * chapter-complete arpeggio. No three, DOM or clocks.
 */

/** Cosmos planet indices (src/render/cosmos/planets.ts). */
export const COSMOS_PLANET = { giant: 0, skyBlue: 1, green: 2, moon: 3 } as const;

/**
 * The cosmos planet that pulses when the comet rings a board body: the
 * movable planet echoes the sky-blue planet, a fixed planet the green one,
 * the moon the moon, and the black hole and the white star the giant.
 */
export function echoPlanet(kind: BodyKind, movable: boolean): number {
  switch (kind) {
    case 'planet':
      return movable ? COSMOS_PLANET.skyBlue : COSMOS_PLANET.green;
    case 'moon':
      return COSMOS_PLANET.moon;
    case 'black-hole':
    case 'repulsor':
      return COSMOS_PLANET.giant;
  }
}

/**
 * Chapter 1's constellation: one star per level, in the cosmos frame
 * (meters from the board center; -Z is ahead of the player, +Y up), about
 * 8 m out and 35-50 degrees up, beyond and above the HUD: a comet shape
 * whose tail curls from the left to the head on the right.
 */
export const CONSTELLATION: Readonly<Record<number, readonly (readonly [number, number, number])[]>> = {
  1: [
    [-3.2, 4.6, -5.6],
    [-1.9, 5.5, -5.3],
    [-0.5, 5.0, -6.0],
    [0.8, 5.9, -5.0],
    [2.1, 5.2, -5.4],
    [3.0, 4.9, -5.8],
  ],
};

export interface ConstellationState {
  /** Per chapter level, in level order: solved (saved). */
  readonly lit: readonly boolean[];
  /** Index pairs of consecutive chapter levels that are both solved. */
  readonly links: readonly (readonly [number, number])[];
  /** Every level of the chapter is solved (the constellation is complete). */
  readonly complete: boolean;
}

/** The chapter's lit stars and links, from the saved solved level ids. */
export function constellationState(levels: readonly LevelDef[], solvedLevelIds: Iterable<string>, chapter: number): ConstellationState {
  const solved = new Set(solvedLevelIds);
  const lit = levels.filter((l) => l.chapter === chapter).map((l) => solved.has(l.id));
  const links: [number, number][] = [];
  for (let i = 0; i + 1 < lit.length; i++) if (lit[i] && lit[i + 1]) links.push([i, i + 1]);
  return { lit, links, complete: lit.length > 0 && lit.every(Boolean) };
}

/**
 * Times (seconds after the chapter-complete moment starts) of the
 * arpeggio's notes and its closing chord, as the audio engine plays them:
 * `delay` (ARPEGGIO_DELAY), then one note every `step` (ARPEGGIO_STEP), then
 * the chord one step after the last note's slot.
 */
export function chimeTimes(noteCount: number, delay: number, step: number): number[] {
  const times: number[] = [];
  for (let i = 0; i < noteCount; i++) times.push(delay + i * step);
  times.push(delay + noteCount * step + step);
  return times;
}
