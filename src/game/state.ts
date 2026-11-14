import { SIM_OUTCOMES, type SimOutcome } from '../sim/bodies.js';
import type { Placements } from '../sim/level.js';
import { isFiniteVec, type Vec2 } from '../sim/vec.js';

/** Current GameState version; version 1 saves are migrated on load. */
export const GAME_STATE_VERSION = 2;

/** Stars a solve can earn (also StarCount in controller.ts). */
export type SavedStars = 1 | 2 | 3;

/** Board size setting; BOARD_SIZE_SCALE in src/config.ts maps it to a radius factor. */
export type BoardSize = 'small' | 'medium' | 'large';

export const BOARD_SIZES: readonly BoardSize[] = ['small', 'medium', 'large'];

/**
 * Room view (comfort) in mixed reality: 'space' fills the room with the
 * cosmos, 'mixed' keeps the table and the space below eye level clear (the
 * table is an island in space), 'room' shows no cosmos. VR and the desktop
 * always show the full cosmos.
 */
export type RoomView = 'space' | 'mixed' | 'room';

export const ROOM_VIEWS: readonly RoomView[] = ['mixed', 'space', 'room'];

/** User audio and accessibility settings as saved. */
export interface SavedSettings {
  muted: boolean;
  /** 0..1. */
  volume: number;
  quiet: boolean;
  /** The ghost hand demonstrates with the left hand. */
  leftHanded: boolean;
  /** Brighter rims, outlines on the bodies and the target, stronger HUD text. */
  highContrast: boolean;
  /** No decorative motion (spins, pulses, flowing rings), no chapter-moment burst, static trails. */
  reducedMotion: boolean;
  boardSize: BoardSize;
  roomView: RoomView;
}

export const DEFAULT_SETTINGS: Readonly<SavedSettings> = Object.freeze({
  muted: false,
  volume: 0.8,
  quiet: false,
  leftHanded: false,
  highContrast: false,
  reducedMotion: false,
  boardSize: 'medium',
  roomView: 'mixed',
});

/** One-time onboarding steps the player has completed. */
export interface OnboardingFlags {
  ghostHandDone: boolean;
}

export const DEFAULT_ONBOARDING: Readonly<OnboardingFlags> = Object.freeze({ ghostHandDone: false });

/**
 * Everything needed to resume a session. Flights are recomputed
 * deterministically from the placements, so no physics state is stored.
 */
export interface GameState {
  version: 2;
  levelId: string;
  placements: Placements;
  attempts: number;
  solvedLevelIds: string[];
  /** Best stars per level id. */
  stars: Record<string, SavedStars>;
  lastOutcome: SimOutcome | null;
  settings: SavedSettings;
  onboarding: OnboardingFlags;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .sort()
        .map((key) => [key, sortKeys(source[key])]),
    );
  }
  return value;
}

/** JSON with sorted keys, so equal states always serialize identically. */
export function serializeGameState(state: GameState): string {
  return JSON.stringify(sortKeys(state));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isVec2(value: unknown): value is Vec2 {
  return Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === 'number') && isFiniteVec(value);
}

function parseStars(value: unknown): Record<string, SavedStars> {
  if (!isRecord(value)) throw new Error('Game state stars must be an object');
  const stars: Record<string, SavedStars> = {};
  for (const [id, n] of Object.entries(value)) {
    if (id === '' || (n !== 1 && n !== 2 && n !== 3)) {
      throw new Error(`Game state stars for ${JSON.stringify(id)} must be 1, 2 or 3`);
    }
    stars[id] = n;
  }
  return stars;
}

/** An optional boolean setting: missing (a save from before it existed) gives the default. */
function optionalFlag(value: Record<string, unknown>, key: 'leftHanded' | 'highContrast' | 'reducedMotion'): boolean {
  const v = value[key];
  if (v === undefined) return DEFAULT_SETTINGS[key];
  if (typeof v !== 'boolean') throw new Error(`Game state settings.${key} must be a boolean`);
  return v;
}

function parseSettings(value: unknown): SavedSettings {
  if (!isRecord(value)) throw new Error('Game state settings must be an object');
  const { muted, volume, quiet, boardSize, roomView } = value;
  if (typeof muted !== 'boolean') throw new Error('Game state settings.muted must be a boolean');
  if (typeof quiet !== 'boolean') throw new Error('Game state settings.quiet must be a boolean');
  if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > 1) {
    throw new Error('Game state settings.volume must be a finite number in [0, 1]');
  }
  // The accessibility settings came after version 2; a version 2 save
  // without them loads with the defaults, a wrong value is a corrupt save.
  if (boardSize !== undefined && !BOARD_SIZES.includes(boardSize as BoardSize)) {
    throw new Error(`Game state settings.boardSize must be one of ${BOARD_SIZES.join(', ')}`);
  }
  if (roomView !== undefined && !ROOM_VIEWS.includes(roomView as RoomView)) {
    throw new Error(`Game state settings.roomView must be one of ${ROOM_VIEWS.join(', ')}`);
  }
  return {
    muted,
    volume,
    quiet,
    leftHanded: optionalFlag(value, 'leftHanded'),
    highContrast: optionalFlag(value, 'highContrast'),
    reducedMotion: optionalFlag(value, 'reducedMotion'),
    boardSize: (boardSize as BoardSize | undefined) ?? DEFAULT_SETTINGS.boardSize,
    roomView: (roomView as RoomView | undefined) ?? DEFAULT_SETTINGS.roomView,
  };
}

function parseOnboarding(value: unknown): OnboardingFlags {
  if (!isRecord(value)) throw new Error('Game state onboarding must be an object');
  if (typeof value.ghostHandDone !== 'boolean') throw new Error('Game state onboarding.ghostHandDone must be a boolean');
  return { ghostHandDone: value.ghostHandDone };
}

/**
 * Parses and validates a saved state. Accepts version 2 and migrates
 * version 1 (no stars, default settings, onboarding not done). Throws Error
 * on any invalid input.
 */
export function deserializeGameState(json: string): GameState {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Game state is not valid JSON');
  }
  if (!isRecord(data)) throw new Error('Game state must be a JSON object');
  if (data.version !== 1 && data.version !== 2) {
    throw new Error(`Unsupported game state version: ${String(data.version)}`);
  }

  const { levelId, placements, attempts, solvedLevelIds, lastOutcome } = data;
  if (typeof levelId !== 'string' || levelId === '') throw new Error('Game state levelId must be a non-empty string');
  if (!isRecord(placements)) throw new Error('Game state placements must be an object');
  for (const [id, p] of Object.entries(placements)) {
    if (!isVec2(p)) throw new Error(`Game state placement ${id} must be a finite [x, z]`);
  }
  if (typeof attempts !== 'number' || !Number.isInteger(attempts) || attempts < 0) {
    throw new Error('Game state attempts must be a non-negative integer');
  }
  if (!Array.isArray(solvedLevelIds) || !solvedLevelIds.every((id) => typeof id === 'string')) {
    throw new Error('Game state solvedLevelIds must be an array of strings');
  }
  if (lastOutcome !== null && !SIM_OUTCOMES.includes(lastOutcome as SimOutcome)) {
    throw new Error(`Game state lastOutcome is unknown: ${String(lastOutcome)}`);
  }

  const v2 = data.version === 2;
  return {
    version: 2,
    levelId,
    placements: Object.fromEntries(
      Object.entries(placements).map(([id, p]) => [id, [(p as Vec2)[0], (p as Vec2)[1]] as Vec2]),
    ),
    attempts,
    solvedLevelIds: [...solvedLevelIds],
    stars: v2 ? parseStars(data.stars) : {},
    lastOutcome: lastOutcome as SimOutcome | null,
    settings: v2 ? parseSettings(data.settings) : { ...DEFAULT_SETTINGS },
    onboarding: v2 ? parseOnboarding(data.onboarding) : { ...DEFAULT_ONBOARDING },
  };
}
