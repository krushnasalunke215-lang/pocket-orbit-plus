import { describe, expect, it } from 'vitest';
import { getLevel } from '../sim/levels/index.js';
import type { LevelDef } from '../sim/level.js';
import { simulate } from '../sim/simulate.js';
import {
  DEFAULT_ONBOARDING,
  DEFAULT_SETTINGS,
  deserializeGameState,
  serializeGameState,
  type GameState,
} from './state.js';

const STATE: GameState = {
  version: 2,
  levelId: 'c1-l2',
  placements: { p2: [0.25, -0.125], p1: [-0.5, 0.75] },
  attempts: 3,
  solvedLevelIds: ['c1-l1'],
  stars: { 'c1-l1': 3 },
  lastOutcome: 'collision',
  settings: { muted: true, volume: 0.35, quiet: false, leftHanded: true, highContrast: true, reducedMotion: false, boardSize: 'large' },
  onboarding: { ghostHandDone: true },
};

describe('GameState serialization', () => {
  it('round-trips version 2 and serializes with a deterministic key order', () => {
    const json = serializeGameState(STATE);
    expect(deserializeGameState(json)).toEqual(STATE);

    const reordered: GameState = {
      onboarding: { ghostHandDone: true },
      settings: { boardSize: 'large', reducedMotion: false, highContrast: true, leftHanded: true, quiet: false, volume: 0.35, muted: true },
      lastOutcome: STATE.lastOutcome,
      stars: { 'c1-l1': 3 },
      solvedLevelIds: STATE.solvedLevelIds,
      attempts: STATE.attempts,
      placements: { p1: [-0.5, 0.75], p2: [0.25, -0.125] },
      levelId: STATE.levelId,
      version: 2,
    };
    expect(serializeGameState(reordered)).toBe(json);
  });

  it('migrates version 1: no stars, default settings, onboarding not done', () => {
    const v1 = {
      version: 1,
      levelId: 'c1-l2',
      placements: { p1: [-0.5, 0.75] },
      attempts: 2,
      solvedLevelIds: ['c1-l1'],
      lastOutcome: null,
    };
    expect(deserializeGameState(JSON.stringify(v1))).toEqual({
      ...v1,
      version: 2,
      stars: {},
      settings: { ...DEFAULT_SETTINGS },
      onboarding: { ...DEFAULT_ONBOARDING },
    });
  });

  it('re-simulates deserialized placements to the same pathHash', () => {
    const level = getLevel('c1-l1') as LevelDef;
    const state: GameState = {
      ...STATE,
      levelId: level.id,
      placements: level.solution,
      attempts: 1,
      solvedLevelIds: [],
      stars: {},
      lastOutcome: null,
    };
    const restored = deserializeGameState(serializeGameState(state));
    expect(simulate(level, restored.placements).pathHash).toBe(simulate(level, level.solution).pathHash);
  });

  it('throws on malformed JSON, an unknown version and a NaN coordinate', () => {
    expect(() => deserializeGameState('{"version":2,')).toThrow(Error);
    expect(() => deserializeGameState(serializeGameState({ ...STATE, version: 3 as 2 }))).toThrow(/version/);
    expect(() => deserializeGameState(serializeGameState({ ...STATE, version: 0 as 2 }))).toThrow(/version/);
    expect(() =>
      deserializeGameState(serializeGameState({ ...STATE, placements: { p1: [Number.NaN, 0] } })),
    ).toThrow(Error);
  });

  it('rejects bad stars', () => {
    for (const stars of [{ 'c1-l1': 0 }, { 'c1-l1': 4 }, { 'c1-l1': 2.5 }, { 'c1-l1': '3' }, { '': 1 }, [3], null]) {
      const json = serializeGameState({ ...STATE, stars: stars as unknown as GameState['stars'] });
      expect(() => deserializeGameState(json), JSON.stringify(stars)).toThrow(/stars/);
    }
    const missing = JSON.parse(serializeGameState(STATE));
    delete missing.stars;
    expect(() => deserializeGameState(JSON.stringify(missing))).toThrow(/stars/);
  });

  it('rejects bad settings and onboarding', () => {
    for (const volume of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY, '0.5']) {
      const json = serializeGameState({ ...STATE, settings: { ...STATE.settings, volume: volume as number } });
      expect(() => deserializeGameState(json), String(volume)).toThrow(/volume/);
    }
    for (const volume of [0, 1]) {
      const json = serializeGameState({ ...STATE, settings: { ...STATE.settings, volume } });
      expect(deserializeGameState(json).settings.volume).toBe(volume);
    }
    const muted = serializeGameState({ ...STATE, settings: { ...STATE.settings, muted: 1 as unknown as boolean } });
    expect(() => deserializeGameState(muted)).toThrow(/muted/);
    const ghost = serializeGameState({ ...STATE, onboarding: {} as GameState['onboarding'] });
    expect(() => deserializeGameState(ghost)).toThrow(/ghostHandDone/);
  });

  it('loads a version 2 save from before the accessibility settings with their defaults', () => {
    const old = JSON.parse(serializeGameState(STATE));
    old.settings = { muted: true, volume: 0.35, quiet: true };
    const restored = deserializeGameState(JSON.stringify(old));
    expect(restored.version).toBe(2);
    expect(restored.settings).toEqual({
      ...DEFAULT_SETTINGS,
      muted: true,
      volume: 0.35,
      quiet: true,
    });
    expect(DEFAULT_SETTINGS).toMatchObject({ leftHanded: false, highContrast: false, reducedMotion: false, boardSize: 'medium' });
  });

  it('rejects bad accessibility settings (the save then counts as corrupt)', () => {
    for (const key of ['leftHanded', 'highContrast', 'reducedMotion'] as const) {
      for (const bad of [1, 'true', null]) {
        const json = serializeGameState({ ...STATE, settings: { ...STATE.settings, [key]: bad as unknown as boolean } });
        expect(() => deserializeGameState(json), `${key} ${String(bad)}`).toThrow(new RegExp(key));
      }
    }
    for (const bad of ['huge', '', 2, null]) {
      const json = serializeGameState({ ...STATE, settings: { ...STATE.settings, boardSize: bad as unknown as 'small' } });
      expect(() => deserializeGameState(json), String(bad)).toThrow(/boardSize/);
    }
    for (const size of ['small', 'medium', 'large'] as const) {
      const json = serializeGameState({ ...STATE, settings: { ...STATE.settings, boardSize: size } });
      expect(deserializeGameState(json).settings.boardSize).toBe(size);
    }
  });
});
