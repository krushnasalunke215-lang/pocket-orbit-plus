import type { LevelDef } from '../sim/level.js';
import { LEVEL_SOURCE, type FlybyEvent } from '../sim/simulate.js';

/*
 * "The solution is a song": every level body rings a note of its chapter's
 * pentatonic scale when the comet flies past it. A solve plays the rung
 * notes back as a phrase and closes on a chord; ringing the level's melody
 * earns 3 stars. Pure: no clocks, randomness or audio objects; the audio
 * layer turns these numbers into sound.
 */

export interface ChapterScale {
  readonly name: string;
  /** MIDI note of scale degree 0. */
  readonly root: number;
  /** Semitones above the root of each degree within one octave. */
  readonly steps: readonly number[];
  /** Degrees of the closing chord: root, third, fifth and octave. */
  readonly chord: readonly number[];
}

const C_MAJOR_PENTATONIC: ChapterScale = {
  name: 'C major pentatonic',
  root: 72,
  steps: [0, 2, 4, 7, 9],
  chord: [0, 2, 3, 5],
};

/**
 * Scale per chapter. Chapter 0 is the sandbox. Chapters 2 and 3 are
 * placeholders for Phase 3.
 */
export const CHAPTER_SCALES: Readonly<Record<number, ChapterScale>> = {
  0: C_MAJOR_PENTATONIC,
  1: C_MAJOR_PENTATONIC,
  2: { name: 'A minor pentatonic', root: 69, steps: [0, 3, 5, 7, 10], chord: [0, 1, 3, 5] },
  3: { name: 'D major pentatonic', root: 74, steps: [0, 2, 4, 7, 9], chord: [0, 2, 3, 5] },
};

/** The chapter's scale; unknown chapters use chapter 1's. */
export function chapterScale(chapter: number): ChapterScale {
  return CHAPTER_SCALES[chapter] ?? C_MAJOR_PENTATONIC;
}

/** Deep note of external wells (flybys whose source is not 'level'). */
export const WELL_NOTE_MIDI = C_MAJOR_PENTATONIC.root - 24;

/** Attempts within which a solve earns 2 stars when a level sets no par. */
export const DEFAULT_PAR = 3;

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** MIDI note of an integer scale degree; degrees outside 0..n-1 wrap octaves. */
export function noteMidi(chapter: number, degree: number): number {
  if (!Number.isInteger(degree)) throw new RangeError(`Scale degree ${degree} is not an integer`);
  const scale = chapterScale(chapter);
  const n = scale.steps.length;
  const octave = Math.floor(degree / n);
  return scale.root + 12 * octave + scale.steps[degree - octave * n];
}

/**
 * MIDI note of a level body: its explicit `note`, else degree = its index in
 * level.bodies. Black holes default to an octave below the root, repulsors
 * to an octave above.
 */
export function bodyNoteMidi(level: LevelDef, bodyId: string): number {
  const index = level.bodies.findIndex((b) => b.id === bodyId);
  if (index < 0) throw new Error(`${level.id} has no body ${bodyId}`);
  const body = level.bodies[index];
  const n = chapterScale(level.chapter).steps.length;
  let degree = index;
  if (body.note !== undefined) degree = body.note;
  else if (body.kind === 'black-hole') degree = -n;
  else if (body.kind === 'repulsor') degree = n;
  return noteMidi(level.chapter, degree);
}

export interface FlightNote {
  readonly bodyId: string;
  readonly source: FlybyEvent['source'];
  /** Flight time of the flyby in seconds. */
  readonly time: number;
  readonly midi: number;
}

/** One note per flyby, in flyby order. */
export function flightNotes(level: LevelDef, flybys: readonly FlybyEvent[]): FlightNote[] {
  return flybys.map((f) => ({
    bodyId: f.bodyId,
    source: f.source,
    time: f.time,
    midi: f.source === LEVEL_SOURCE ? bodyNoteMidi(level, f.bodyId) : WELL_NOTE_MIDI,
  }));
}

/** Level-body ids of the flight's flybys in order, consecutive repeats collapsed. */
export function rungSequence(level: LevelDef, flybys: readonly FlybyEvent[]): string[] {
  const out: string[] = [];
  for (const f of flybys) {
    if (f.source !== LEVEL_SOURCE) continue;
    if (out[out.length - 1] !== f.bodyId) out.push(f.bodyId);
  }
  return out;
}

/** True when the flight rings exactly the level's melody (false without one). */
export function matchesMelody(level: LevelDef, flybys: readonly FlybyEvent[]): boolean {
  const melody = level.melody;
  if (!melody) return false;
  const rung = rungSequence(level, flybys);
  return rung.length === melody.length && rung.every((id, i) => id === melody[i]);
}

export interface StarInput {
  readonly solved: boolean;
  /** Launches so far on this level, including the solving one. */
  readonly attempts: number;
  /** Default DEFAULT_PAR. */
  readonly par?: number;
  readonly melodyMatched: boolean;
}

/** 0 unsolved; 3 when the melody rang; else 2 within par; else 1. */
export function starRating({ solved, attempts, par = DEFAULT_PAR, melodyMatched }: StarInput): 0 | 1 | 2 | 3 {
  if (!solved) return 0;
  if (melodyMatched) return 3;
  return attempts <= par ? 2 : 1;
}

export interface PhraseOptions {
  /** Chapter whose scale builds the chord (default 1). */
  readonly chapter?: number;
  /** Seconds between phrase notes (default 0.22). */
  readonly spacing?: number;
  /** Seconds from the last note to the chord (default 0.3). */
  readonly chordGap?: number;
}

export interface PhraseSchedule {
  /** Times in seconds relative to the phrase start. */
  readonly notes: { readonly at: number; readonly midi: number }[];
  readonly chord: { readonly at: number; readonly midis: number[] };
}

/** The solve phrase: the notes in order, evenly spaced, then the chapter chord. */
export function phraseSchedule(
  notes: readonly { readonly midi: number }[],
  { chapter = 1, spacing = 0.22, chordGap = 0.3 }: PhraseOptions = {},
): PhraseSchedule {
  const scheduled = notes.map((n, i) => ({ at: i * spacing, midi: n.midi }));
  const last = scheduled.length > 0 ? scheduled[scheduled.length - 1].at : 0;
  return {
    notes: scheduled,
    chord: {
      at: scheduled.length > 0 ? last + chordGap : 0,
      midis: chapterScale(chapter).chord.map((d) => noteMidi(chapter, d)),
    },
  };
}
