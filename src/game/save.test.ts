import { describe, expect, it } from 'vitest';
import { clearGame, CORRUPT_SAVE_KEY, loadGame, SAVE_KEY, saveGame, type KeyValueStore } from './save.js';
import { serializeGameState, type GameState } from './state.js';

class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  writes = 0;
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.writes++;
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

/** A store whose every method throws, like localStorage in locked-down private browsing. */
const THROWING: KeyValueStore = {
  getItem() {
    throw new Error('SecurityError: access denied');
  },
  setItem() {
    throw new Error('QuotaExceededError');
  },
  removeItem() {
    throw new Error('SecurityError: access denied');
  },
};

const STATE: GameState = {
  version: 2,
  levelId: 'c1-l3',
  placements: { p1: [0.068, 0.468] },
  attempts: 0,
  solvedLevelIds: ['c1-l1', 'c1-l2'],
  stars: { 'c1-l1': 3, 'c1-l2': 2 },
  lastOutcome: null,
  settings: { muted: false, volume: 0.6, quiet: true },
  onboarding: { ghostHandDone: true },
};

describe('save', () => {
  it('uses a stable key that is not derived from the app name', () => {
    expect(SAVE_KEY).toBe('orbit-puzzle.save');
    expect(CORRUPT_SAVE_KEY).toBe('orbit-puzzle.save.corrupt');
  });

  it('starts fresh without a save, with no problem', () => {
    const store = new MemoryStore();
    expect(loadGame(store)).toEqual({ state: null, problem: null });
    expect(store.writes).toBe(0);
  });

  it('round-trips a state', () => {
    const store = new MemoryStore();
    expect(saveGame(store, STATE)).toBe(true);
    expect(store.getItem(SAVE_KEY)).toBe(serializeGameState(STATE));
    expect(loadGame(store)).toEqual({ state: STATE, problem: null });
    expect(clearGame(store)).toBe(true);
    expect(loadGame(store)).toEqual({ state: null, problem: null });
  });

  it('starts fresh on corrupt JSON and keeps a copy of the text', () => {
    const store = new MemoryStore();
    store.setItem(SAVE_KEY, '{not json');
    const result = loadGame(store);
    expect(result.state).toBeNull();
    expect(result.problem).toMatch(/corrupt save/);
    expect(store.getItem(CORRUPT_SAVE_KEY)).toBe('{not json');
  });

  it('starts fresh on a wrong version', () => {
    const store = new MemoryStore();
    const text = serializeGameState({ ...STATE, version: 3 as 2 });
    store.setItem(SAVE_KEY, text);
    const result = loadGame(store);
    expect(result.state).toBeNull();
    expect(result.problem).toMatch(/version/);
    expect(store.getItem(CORRUPT_SAVE_KEY)).toBe(text);
  });

  it('starts fresh on truncated text', () => {
    const store = new MemoryStore();
    const text = serializeGameState(STATE);
    for (const cut of [1, Math.floor(text.length / 2), text.length - 1]) {
      store.setItem(SAVE_KEY, text.slice(0, cut));
      const result = loadGame(store);
      expect(result.state, `cut at ${cut}`).toBeNull();
      expect(result.problem).toMatch(/corrupt save/);
      expect(store.getItem(CORRUPT_SAVE_KEY)).toBe(text.slice(0, cut));
    }
  });

  it('never throws on a throwing or missing store', () => {
    const result = loadGame(THROWING);
    expect(result.state).toBeNull();
    expect(result.problem).toMatch(/storage unavailable.*SecurityError/);
    expect(saveGame(THROWING, STATE)).toBe(false);
    expect(clearGame(THROWING)).toBe(false);

    // Readable but corrupt, and the corrupt copy cannot be written.
    const readOnly: KeyValueStore = { ...THROWING, getItem: () => '{' };
    expect(loadGame(readOnly)).toEqual({ state: null, problem: expect.stringMatching(/corrupt save/) });

    expect(loadGame(null).state).toBeNull();
    expect(saveGame(null, STATE)).toBe(false);
  });
});
