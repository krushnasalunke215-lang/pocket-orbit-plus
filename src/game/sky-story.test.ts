import { describe, expect, it } from 'vitest';
import { BODY_KINDS } from '../sim/bodies.js';
import { ALL_LEVELS } from '../sim/levels/index.js';
import { chimeTimes, COSMOS_PLANET, CONSTELLATION, constellationState, echoPlanet } from './sky-story.js';

const chapter1 = ALL_LEVELS.filter((l) => l.chapter === 1);

describe('constellationState', () => {
  it('lights nothing for 0 solved levels, and everything with all links for 6', () => {
    const none = constellationState(ALL_LEVELS, [], 1);
    expect(none.lit).toEqual([false, false, false, false, false, false]);
    expect(none.links).toEqual([]);
    expect(none.complete).toBe(false);
    const all = constellationState(ALL_LEVELS, chapter1.map((l) => l.id), 1);
    expect(all.lit.every(Boolean)).toBe(true);
    expect(all.links).toEqual([[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]]);
    expect(all.complete).toBe(true);
  });

  it('links only consecutive solved levels (3 solved: 1, 2 and 4)', () => {
    const s = constellationState(ALL_LEVELS, [chapter1[0].id, chapter1[1].id, chapter1[3].id, 'unknown'], 1);
    expect(s.lit).toEqual([true, true, false, true, false, false]);
    expect(s.links).toEqual([[0, 1]]);
    expect(s.complete).toBe(false);
  });

  it('has one star per chapter-1 level, 35-50 degrees up and about 8 m out', () => {
    const stars = CONSTELLATION[1];
    expect(stars.length).toBe(chapter1.length);
    for (const [x, y, z] of stars) {
      const d = Math.hypot(x, y, z);
      const elevation = (Math.asin(y / d) * 180) / Math.PI;
      expect(d).toBeGreaterThan(7);
      expect(d).toBeLessThan(9);
      expect(elevation).toBeGreaterThanOrEqual(35);
      expect(elevation).toBeLessThanOrEqual(50);
      expect(z).toBeLessThan(0);
    }
  });
});

describe('echoPlanet', () => {
  it('maps every body kind to a cosmos planet', () => {
    for (const kind of BODY_KINDS) {
      for (const movable of [false, true]) {
        const index = echoPlanet(kind, movable);
        expect(Object.values(COSMOS_PLANET)).toContain(index);
      }
    }
    expect(echoPlanet('planet', true)).toBe(COSMOS_PLANET.skyBlue);
    expect(echoPlanet('planet', false)).toBe(COSMOS_PLANET.green);
    expect(echoPlanet('moon', false)).toBe(COSMOS_PLANET.moon);
    expect(echoPlanet('black-hole', false)).toBe(COSMOS_PLANET.giant);
    expect(echoPlanet('repulsor', true)).toBe(COSMOS_PLANET.giant);
  });
});

describe('chimeTimes', () => {
  it('follows the arpeggio: the notes one step apart after the delay, then the chord', () => {
    expect(chimeTimes(3, 0.25, 0.2).map((t) => Number(t.toFixed(6)))).toEqual([0.25, 0.45, 0.65, 1.05]);
    expect(chimeTimes(0, 0.25, 0.2)).toEqual([0.45]);
  });
});
