/**
 * True when the segment from sample `fromIndex` to sample `toIndex`
 * (fromIndex < toIndex) spans a teleport jump. `breaks` holds, for each jump,
 * the index of the first sample at or past its exit; only the first
 * `breakCount` entries are read. A segment ending exactly on a break joins
 * the entry side to the exit side, so it crosses.
 */
export function segmentCrossesBreak(
  fromIndex: number,
  toIndex: number,
  breaks: ArrayLike<number>,
  breakCount: number,
): boolean {
  for (let i = 0; i < breakCount; i++) {
    const b = breaks[i];
    if (fromIndex < b && b <= toIndex) return true;
  }
  return false;
}
