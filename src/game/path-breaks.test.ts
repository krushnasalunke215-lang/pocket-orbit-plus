import { describe, expect, it } from 'vitest';
import { segmentCrossesBreak } from './path-breaks.js';

describe('segmentCrossesBreak', () => {
  const breaks = Int32Array.from([5, 12, 0, 0]);

  it('is false with no breaks', () => {
    expect(segmentCrossesBreak(0, 100, breaks, 0)).toBe(false);
  });

  it('detects a segment that ends on or spans a break', () => {
    expect(segmentCrossesBreak(4, 5, breaks, 2)).toBe(true);
    expect(segmentCrossesBreak(2, 8, breaks, 2)).toBe(true);
    expect(segmentCrossesBreak(10, 14, breaks, 2)).toBe(true);
  });

  it('allows segments that start on a break or stay on one side', () => {
    expect(segmentCrossesBreak(5, 6, breaks, 2)).toBe(false);
    expect(segmentCrossesBreak(3, 4, breaks, 2)).toBe(false);
    expect(segmentCrossesBreak(6, 12 - 1, breaks, 2)).toBe(false);
  });

  it('reads only the first breakCount entries', () => {
    expect(segmentCrossesBreak(10, 14, breaks, 1)).toBe(false);
  });
});
