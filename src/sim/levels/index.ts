import type { LevelDef } from '../level.js';
import { CHAPTER_1 } from './chapter1.js';

/** Every shipped level, ordered by chapter, then order. */
export const ALL_LEVELS: readonly LevelDef[] = [...CHAPTER_1];

export function getLevel(id: string): LevelDef | undefined {
  return ALL_LEVELS.find((level) => level.id === id);
}
