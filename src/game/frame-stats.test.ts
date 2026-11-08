import { describe, expect, it } from 'vitest';
import { FRAME_STATS_CAPACITY, FrameStats } from './frame-stats.js';

describe('FrameStats', () => {
  it('reads 0 before any frame', () => {
    const s = new FrameStats();
    expect(s.averageFps()).toBe(0);
    expect(s.onePercentLowFps()).toBe(0);
  });

  it('steady 13.9 ms frames read about 72 fps, average and 1% low', () => {
    const s = new FrameStats();
    for (let i = 0; i < 300; i++) s.push(13.9);
    expect(s.averageFps()).toBeCloseTo(71.94, 1);
    expect(s.onePercentLowFps()).toBeCloseTo(71.94, 1);
  });

  it('a few 50 ms spikes lower the 1% low but barely the average', () => {
    const s = new FrameStats();
    for (let i = 0; i < FRAME_STATS_CAPACITY; i++) s.push(i % 60 === 30 ? 50 : 13.9);
    // 10 spikes in 600 frames (more than 1%): the 99th percentile is a spike.
    expect(s.onePercentLowFps()).toBeCloseTo(20, 3);
    // 2 spikes in the last 120 frames: (118 * 13.9 + 100) / 120 ms.
    const average = s.averageFps();
    expect(average).toBeCloseTo((1000 * 120) / (118 * 13.9 + 2 * 50), 1);
    expect(average).toBeGreaterThan(68);
  });

  it('1% low ignores a single spike in 600 frames', () => {
    const s = new FrameStats();
    for (let i = 0; i < FRAME_STATS_CAPACITY; i++) s.push(i === 100 ? 80 : 11.1);
    expect(s.onePercentLowFps()).toBeCloseTo(1000 / 11.1, 1);
  });

  it('wraps the ring: old frames are overwritten', () => {
    const s = new FrameStats();
    for (let i = 0; i < FRAME_STATS_CAPACITY; i++) s.push(50);
    for (let i = 0; i < FRAME_STATS_CAPACITY + 7; i++) s.push(10);
    expect(s.count).toBe(FRAME_STATS_CAPACITY);
    expect(s.averageFps()).toBeCloseTo(100, 3);
    expect(s.onePercentLowFps()).toBeCloseTo(100, 3);
    // Half wrapped: the average window sees only new frames, the 1% low still sees old ones.
    for (let i = 0; i < 300; i++) s.push(20);
    expect(s.averageFps()).toBeCloseTo(50, 3);
    expect(s.onePercentLowFps()).toBeCloseTo(50, 3);
  });

  it('uses fewer frames than the window while filling, and ignores bad values', () => {
    const s = new FrameStats();
    s.push(10);
    s.push(30);
    s.push(Number.NaN);
    s.push(-5);
    s.push(0);
    expect(s.count).toBe(2);
    expect(s.averageFps()).toBeCloseTo(50, 5);
    expect(s.averageFps(1)).toBeCloseTo(1000 / 30, 5);
    expect(s.onePercentLowFps()).toBeCloseTo(1000 / 30, 5);
    s.clear();
    expect(s.averageFps()).toBe(0);
  });
});
