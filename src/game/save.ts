import { deserializeGameState, serializeGameState, type GameState } from './state.js';

/**
 * The storage key of the save. Stable on purpose: it is never derived from
 * APP_NAME, so renaming the app never loses anyone's progress.
 */
export const SAVE_KEY = 'orbit-puzzle.save';
/** Where an unreadable save is copied for bug reports. */
export const CORRUPT_SAVE_KEY = `${SAVE_KEY}.corrupt`;

/** The part of the Web Storage API the save uses (the browser's localStorage, or a test double). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LoadResult {
  /** The saved state, or null for a fresh start. */
  state: GameState | null;
  /** Why the save could not be used (null when there was none or it loaded). */
  problem: string | null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reads the save. A missing save is a fresh start with no problem. Unreadable
 * or invalid text is a fresh start with a problem, and the text is copied to
 * CORRUPT_SAVE_KEY. Storage exceptions (private mode, a blocked or full
 * store) are caught and reported as a problem. Never throws.
 */
export function loadGame(store: KeyValueStore | null): LoadResult {
  if (!store) return { state: null, problem: 'storage unavailable' };
  let text: string | null;
  try {
    text = store.getItem(SAVE_KEY);
  } catch (error) {
    return { state: null, problem: `storage unavailable: ${message(error)}` };
  }
  if (text === null) return { state: null, problem: null };
  try {
    return { state: deserializeGameState(text), problem: null };
  } catch (error) {
    try {
      store.setItem(CORRUPT_SAVE_KEY, text);
    } catch {
      // Keeping a copy is best effort.
    }
    return { state: null, problem: `corrupt save: ${message(error)}` };
  }
}

/** Writes the save; false when the store refused it. Never throws. */
export function saveGame(store: KeyValueStore | null, state: GameState): boolean {
  if (!store) return false;
  try {
    store.setItem(SAVE_KEY, serializeGameState(state));
    return true;
  } catch {
    return false;
  }
}

/** Removes the save (not the corrupt copy); false when the store refused. Never throws. */
export function clearGame(store: KeyValueStore | null): boolean {
  if (!store) return false;
  try {
    store.removeItem(SAVE_KEY);
    return true;
  } catch {
    return false;
  }
}
