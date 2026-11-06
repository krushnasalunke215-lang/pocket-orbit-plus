import { SIM_OUTCOMES, type SimOutcome } from '../sim/bodies.js';
import type { Placements } from '../sim/level.js';
import { isFiniteVec, type Vec2 } from '../sim/vec.js';

/**
 * Everything needed to resume a session. Flights are recomputed
 * deterministically from the placements, so no physics state is stored.
 */
export interface GameState {
  version: 1;
  levelId: string;
  placements: Placements;
  attempts: number;
  solvedLevelIds: string[];
  lastOutcome: SimOutcome | null;
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

/** Parses and validates a saved state. Throws Error on any invalid input. */
export function deserializeGameState(json: string): GameState {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('Game state is not valid JSON');
  }
  if (!isRecord(data)) throw new Error('Game state must be a JSON object');
  if (data.version !== 1) throw new Error(`Unsupported game state version: ${String(data.version)}`);

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

  return {
    version: 1,
    levelId,
    placements: Object.fromEntries(
      Object.entries(placements).map(([id, p]) => [id, [(p as Vec2)[0], (p as Vec2)[1]] as Vec2]),
    ),
    attempts,
    solvedLevelIds: [...solvedLevelIds],
    lastOutcome: lastOutcome as SimOutcome | null,
  };
}
