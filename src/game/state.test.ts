import { describe, expect, it } from 'vitest';
import { getLevel } from '../sim/levels/index.js';
import type { LevelDef } from '../sim/level.js';
import { simulate } from '../sim/simulate.js';
import { deserializeGameState, serializeGameState, type GameState } from './state.js';

const STATE: GameState = {
  version: 1,
  levelId: 'c1-l2',
  placements: { p2: [0.25, -0.125], p1: [-0.5, 0.75] },
  attempts: 3,
  solvedLevelIds: ['c1-l1'],
  lastOutcome: 'collision',
};

describe('GameState serialization', () => {
  it('round-trips and serializes with a deterministic key order', () => {
    const json = serializeGameState(STATE);
    expect(deserializeGameState(json)).toEqual(STATE);

    const reordered: GameState = {
      lastOutcome: STATE.lastOutcome,
      solvedLevelIds: STATE.solvedLevelIds,
      attempts: STATE.attempts,
      placements: { p1: [-0.5, 0.75], p2: [0.25, -0.125] },
      levelId: STATE.levelId,
      version: 1,
    };
    expect(serializeGameState(reordered)).toBe(json);
  });

  it('re-simulates deserialized placements to the same pathHash', () => {
    const level = getLevel('c1-l1') as LevelDef;
    const state: GameState = {
      version: 1,
      levelId: level.id,
      placements: level.solution,
      attempts: 1,
      solvedLevelIds: [],
      lastOutcome: null,
    };
    const restored = deserializeGameState(serializeGameState(state));
    expect(simulate(level, restored.placements).pathHash).toBe(simulate(level, level.solution).pathHash);
  });

  it('throws on malformed JSON, an unknown version and a NaN coordinate', () => {
    expect(() => deserializeGameState('{"version":1,')).toThrow(Error);
    expect(() => deserializeGameState(serializeGameState({ ...STATE, version: 2 as 1 }))).toThrow(Error);
    expect(() =>
      deserializeGameState(serializeGameState({ ...STATE, placements: { p1: [Number.NaN, 0] } })),
    ).toThrow(Error);
  });
});
