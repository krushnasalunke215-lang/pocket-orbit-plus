import { describe, expect, it } from 'vitest';
import { isOverBoard, shouldLaunch, trackingAge } from './launch-gate.js';

describe('isOverBoard', () => {
  it('accepts releases up to radius 1.05 and ignores height', () => {
    expect(isOverBoard([1.0, 0, 0])).toBe(true);
    expect(isOverBoard([0, 0.8, -1.05])).toBe(true);
    expect(isOverBoard([1.06, 0, 0])).toBe(false);
    expect(isOverBoard([0.8, 0, 0.8])).toBe(false);
  });
});

describe('shouldLaunch', () => {
  it('launches when over the board and tracked within 100 ms', () => {
    expect(shouldLaunch({ overBoard: true, msSinceTracked: 50 })).toBe(true);
    expect(shouldLaunch({ overBoard: true, msSinceTracked: 100 })).toBe(true);
  });

  it('snaps back when tracking is older than 100 ms', () => {
    expect(shouldLaunch({ overBoard: true, msSinceTracked: 101 })).toBe(false);
    expect(shouldLaunch({ overBoard: true, msSinceTracked: Infinity })).toBe(false);
  });

  it('snaps back when released off the board', () => {
    expect(shouldLaunch({ overBoard: false, msSinceTracked: 0 })).toBe(false);
    expect(shouldLaunch({ overBoard: false, msSinceTracked: null })).toBe(false);
  });

  it('treats inputs without tracking (mouse) as fresh', () => {
    expect(shouldLaunch({ overBoard: true, msSinceTracked: null })).toBe(true);
  });
});

describe('trackingAge', () => {
  it('is null for the mouse and the age of the last tracked pose in XR', () => {
    expect(trackingAge(false, null, 1000)).toBeNull();
    expect(trackingAge(false, 900, 1000)).toBeNull();
    expect(trackingAge(true, 940, 1000)).toBe(60);
  });

  it('fails closed in XR when the hold never reported a hand', () => {
    const age = trackingAge(true, null, 1000);
    expect(age).toBe(Infinity);
    expect(shouldLaunch({ overBoard: true, msSinceTracked: age })).toBe(false);
  });

  it('snaps back when the holding hand is missing on the release frame', () => {
    // Posed 10 ms ago, but the input source vanished on release (D1).
    const age = trackingAge(true, 990, 1000, false);
    expect(age).toBe(Infinity);
    expect(shouldLaunch({ overBoard: true, msSinceTracked: age })).toBe(false);
  });

  it('keeps the age for a present hand posed 60 ms ago', () => {
    const age = trackingAge(true, 940, 1000, true);
    expect(age).toBe(60);
    expect(shouldLaunch({ overBoard: true, msSinceTracked: age })).toBe(true);
  });

  it('snaps back for a present hand left unposed for 150 ms', () => {
    const age = trackingAge(true, 850, 1000, true);
    expect(age).toBe(150);
    expect(shouldLaunch({ overBoard: true, msSinceTracked: age })).toBe(false);
  });

  it('ignores hand presence for the mouse', () => {
    expect(trackingAge(false, null, 1000, false)).toBeNull();
  });
});
