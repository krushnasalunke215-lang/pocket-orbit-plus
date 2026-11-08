/** Frame times FrameStats keeps (about 7-8 s at 72-90 fps). */
export const FRAME_STATS_CAPACITY = 600;
/** Frames averageFps uses by default. */
export const FRAME_STATS_AVERAGE_WINDOW = 120;

/**
 * Rolling frame-time statistics for the debug overlay. The caller passes
 * each frame's duration in milliseconds (no clocks in here). Storage is a
 * preallocated ring plus a scratch copy, so push() and both readers never
 * allocate. onePercentLowFps() sorts the scratch copy, so call it at most
 * a few times a second.
 */
export class FrameStats {
  private readonly times = new Float32Array(FRAME_STATS_CAPACITY);
  private readonly scratch = new Float32Array(FRAME_STATS_CAPACITY);
  private next = 0;
  /** Stored frames (at most FRAME_STATS_CAPACITY). */
  count = 0;

  /** Records one frame time (ms); non-finite or non-positive values are ignored. */
  push(ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.times[this.next] = ms;
    this.next = (this.next + 1) % FRAME_STATS_CAPACITY;
    if (this.count < FRAME_STATS_CAPACITY) this.count++;
  }

  /** 1000 / mean frame time over the last `window` frames (fewer if not stored yet); 0 when empty. */
  averageFps(window: number = FRAME_STATS_AVERAGE_WINDOW): number {
    const n = Math.min(this.count, Math.max(1, Math.floor(window)));
    if (this.count === 0) return 0;
    let sum = 0;
    for (let i = 1; i <= n; i++) sum += this.times[(this.next - i + FRAME_STATS_CAPACITY) % FRAME_STATS_CAPACITY]!;
    return (1000 * n) / sum;
  }

  /**
   * The 1% low: 1000 / the 99th percentile frame time (nearest rank) over
   * every stored frame; 0 when empty. Sorts the scratch copy in place.
   */
  onePercentLowFps(): number {
    const n = this.count;
    if (n === 0) return 0;
    const scratch = this.scratch;
    // Copy the valid frames; fill the rest with +Infinity so a full-length
    // in-place sort keeps them at the end (no subarray view is allocated).
    for (let i = 0; i < FRAME_STATS_CAPACITY; i++) scratch[i] = i < n ? this.times[i]! : Infinity;
    scratch.sort();
    const rank = Math.ceil(0.99 * n);
    return 1000 / scratch[rank - 1]!;
  }

  /** Forgets every stored frame. */
  clear(): void {
    this.next = 0;
    this.count = 0;
  }
}
