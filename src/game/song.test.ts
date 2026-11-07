import { describe, expect, it } from 'vitest';
import type { LevelDef } from '../sim/level.js';
import { getLevel } from '../sim/levels/index.js';
import { simulate, type FlybyEvent } from '../sim/simulate.js';
import {
  CHAPTER_SCALES,
  DEFAULT_PAR,
  WELL_NOTE_MIDI,
  bodyNoteMidi,
  chapterScale,
  flightNotes,
  matchesMelody,
  midiToHz,
  noteMidi,
  phraseSchedule,
  rungSequence,
  starRating,
} from './song.js';

const LEVEL: LevelDef = {
  id: 'song-fixture',
  chapter: 1,
  order: 1,
  title: 'Song fixture',
  comet: { position: [-0.9, 0], velocity: [0.4, 0] },
  target: { position: [0.8, 0], radius: 0.1 },
  bodies: [
    { id: 'a', kind: 'planet', position: [0, 0.5] },
    { id: 'b', kind: 'planet', position: [0, -0.5], movable: true },
    { id: 'bh', kind: 'black-hole', position: [0.5, 0.5] },
    { id: 'w', kind: 'repulsor', position: [0.5, -0.5] },
    { id: 'n', kind: 'moon', position: [-0.5, 0.5], note: -2 },
  ],
  solution: { b: [0, -0.5] },
  melody: ['a', 'b', 'a'],
};

function flyby(bodyId: string, time: number, source = 'level'): FlybyEvent {
  return { bodyId, source, step: Math.round(time * 240), time, closestDistance: 0.1 };
}

describe('scales and notes', () => {
  it('converts MIDI to Hz', () => {
    expect(midiToHz(69)).toBe(440);
    expect(midiToHz(81)).toBeCloseTo(880, 9);
    expect(midiToHz(72)).toBeCloseTo(523.2511, 3);
  });

  it('uses C major pentatonic on C5 for chapter 1 and the sandbox', () => {
    for (const chapter of [0, 1]) {
      expect(CHAPTER_SCALES[chapter].steps).toEqual([0, 2, 4, 7, 9]);
      expect(CHAPTER_SCALES[chapter].root).toBe(72);
    }
    expect([0, 1, 2, 3, 4].map((d) => noteMidi(1, d))).toEqual([72, 74, 76, 79, 81]);
    expect(chapterScale(99)).toBe(CHAPTER_SCALES[1]);
  });

  it('wraps degrees below 0 and from 5 up by octaves', () => {
    expect(noteMidi(1, 5)).toBe(84);
    expect(noteMidi(1, 7)).toBe(88);
    expect(noteMidi(1, -1)).toBe(69);
    expect(noteMidi(1, -5)).toBe(60);
    expect(noteMidi(1, -6)).toBe(57);
    expect(() => noteMidi(1, 0.5)).toThrow();
  });

  it('puts every note of every chapter in its pentatonic set', () => {
    for (const [chapter, scale] of Object.entries(CHAPTER_SCALES)) {
      expect(scale.steps).toHaveLength(5);
      const allowed = new Set(scale.steps);
      for (let d = -12; d <= 12; d++) {
        const offset = (((noteMidi(Number(chapter), d) - scale.root) % 12) + 12) % 12;
        expect(allowed.has(offset), `chapter ${chapter} degree ${d}`).toBe(true);
      }
    }
  });

  it('gives bodies a degree by index, kind defaults and explicit notes', () => {
    expect(bodyNoteMidi(LEVEL, 'a')).toBe(72);
    expect(bodyNoteMidi(LEVEL, 'b')).toBe(74);
    expect(bodyNoteMidi(LEVEL, 'bh')).toBe(60);
    expect(bodyNoteMidi(LEVEL, 'w')).toBe(84);
    expect(bodyNoteMidi(LEVEL, 'n')).toBe(67);
    expect(() => bodyNoteMidi(LEVEL, 'nope')).toThrow();
  });
});

describe('flight notes and melodies', () => {
  it('gives one note per flyby in order, wells on the deep note', () => {
    const notes = flightNotes(LEVEL, [flyby('a', 1), flyby('well-1', 1.5, 'cup'), flyby('a', 2), flyby('w', 3)]);
    expect(notes).toEqual([
      { bodyId: 'a', source: 'level', time: 1, midi: 72 },
      { bodyId: 'well-1', source: 'cup', time: 1.5, midi: WELL_NOTE_MIDI },
      { bodyId: 'a', source: 'level', time: 2, midi: 72 },
      { bodyId: 'w', source: 'level', time: 3, midi: 84 },
    ]);
    expect(WELL_NOTE_MIDI).toBe(48);
  });

  it('is deterministic for the same flight', () => {
    const level = getLevel('c1-l2')!;
    const a = simulate(level, level.solution).flybys;
    const b = simulate(level, level.solution).flybys;
    expect(flightNotes(level, b)).toEqual(flightNotes(level, a));
    expect(rungSequence(level, b)).toEqual(rungSequence(level, a));
    expect(flightNotes(level, a).length).toBe(a.length);
  });

  it('collapses consecutive repeats and skips wells in the rung sequence', () => {
    const flybys = [flyby('a', 1), flyby('a', 1.2), flyby('well-1', 1.3, 'cup'), flyby('a', 1.4), flyby('b', 2), flyby('a', 3)];
    expect(rungSequence(LEVEL, flybys)).toEqual(['a', 'b', 'a']);
    expect(rungSequence(LEVEL, [])).toEqual([]);
  });

  it('matches the melody exactly', () => {
    expect(matchesMelody(LEVEL, [flyby('a', 1), flyby('b', 2), flyby('b', 2.5), flyby('a', 3)])).toBe(true);
    expect(matchesMelody(LEVEL, [flyby('a', 1), flyby('b', 2)])).toBe(false);
    expect(matchesMelody(LEVEL, [flyby('b', 1), flyby('a', 2), flyby('b', 3)])).toBe(false);
    expect(matchesMelody(LEVEL, [flyby('a', 1), flyby('b', 2), flyby('a', 3), flyby('b', 4)])).toBe(false);
    const { melody: _melody, ...noMelody } = LEVEL;
    expect(matchesMelody(noMelody, [flyby('a', 1), flyby('b', 2), flyby('a', 3)])).toBe(false);
  });
});

describe('star rating', () => {
  it('gives 0 when unsolved, even with the melody', () => {
    expect(starRating({ solved: false, attempts: 1, melodyMatched: true })).toBe(0);
  });

  it('gives 3 for the melody at any attempt count', () => {
    expect(starRating({ solved: true, attempts: 1, melodyMatched: true })).toBe(3);
    expect(starRating({ solved: true, attempts: 50, par: 2, melodyMatched: true })).toBe(3);
  });

  it('gives 2 up to par and 1 past it', () => {
    expect(DEFAULT_PAR).toBe(3);
    expect(starRating({ solved: true, attempts: 3, melodyMatched: false })).toBe(2);
    expect(starRating({ solved: true, attempts: 4, melodyMatched: false })).toBe(1);
    expect(starRating({ solved: true, attempts: 1, par: 1, melodyMatched: false })).toBe(2);
    expect(starRating({ solved: true, attempts: 2, par: 1, melodyMatched: false })).toBe(1);
    expect(starRating({ solved: true, attempts: 5, par: 5, melodyMatched: false })).toBe(2);
  });
});

describe('phrase schedule', () => {
  it('spaces the notes in order and closes on the chapter chord', () => {
    const s = phraseSchedule([{ midi: 72 }, { midi: 79 }, { midi: 74 }]);
    expect(s.notes.map((n) => n.midi)).toEqual([72, 79, 74]);
    expect(s.notes[0].at).toBe(0);
    expect(s.notes[1].at).toBeCloseTo(0.22, 12);
    expect(s.notes[2].at).toBeCloseTo(0.44, 12);
    expect(s.chord.at).toBeCloseTo(0.74, 12);
    expect(s.chord.midis).toEqual([72, 76, 79, 84]);
  });

  it('honors custom spacing and chapter, and an empty phrase', () => {
    const s = phraseSchedule([{ midi: 60 }, { midi: 62 }], { spacing: 0.5, chordGap: 1, chapter: 2 });
    expect(s.notes).toEqual([
      { at: 0, midi: 60 },
      { at: 0.5, midi: 62 },
    ]);
    expect(s.chord.at).toBe(1.5);
    expect(s.chord.midis).toEqual([69, 72, 76, 81]);
    expect(phraseSchedule([])).toEqual({ notes: [], chord: { at: 0, midis: [72, 76, 79, 84] } });
  });
});
