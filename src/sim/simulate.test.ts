import { describe, expect, it } from 'vitest';
import { SIM_DT } from './constants.js';
import type { LevelDef } from './level.js';
import { bodyPositionAt, createSimBodies, fullSampleCount, simulate } from './simulate.js';
import { WORMHOLE_EXIT, WORMHOLE_LEVEL, withStubWormhole } from './test-fixtures.js';

/** Comet from the left heading +x straight at a target on the center line. */
const STRAIGHT: LevelDef = {
  id: 'fixture',
  chapter: 0,
  order: 0,
  title: 'Fixture',
  comet: { position: [-0.9, 0], velocity: [0.5, 0] },
  target: { position: [0.6, 0], radius: 0.1 },
  bodies: [],
  solution: {},
};

const OFF_LINE_TARGET = { position: [0.6, -0.6], radius: 0.1 } as const;

/** One movable planet that bends the comet (used for determinism checks). */
const BENT: LevelDef = {
  ...STRAIGHT,
  target: OFF_LINE_TARGET,
  bodies: [{ id: 'p1', kind: 'planet', position: [0, -0.3], movable: true }],
  solution: { p1: [0, -0.3] },
};

function withBody(level: LevelDef, body: LevelDef['bodies'][number]): LevelDef {
  return { ...level, bodies: [...level.bodies, body] };
}

describe('simulate', () => {
  it('is deterministic: same inputs give the same pathHash and flybys', () => {
    const a = simulate(BENT, { p1: [0.05, -0.32] });
    const b = simulate(BENT, { p1: [0.05, -0.32] });
    expect(a.pathHash).toMatch(/^[0-9a-f]{8}$/);
    expect(b.pathHash).toBe(a.pathHash);
    expect(a.flybys.length).toBeGreaterThan(0);
    expect(b.flybys).toEqual(a.flybys);
  });

  it('hashes every step, so recordEvery does not change the pathHash', () => {
    const every1 = simulate(BENT, {}, { recordEvery: 1 });
    const every4 = simulate(BENT, {}, { recordEvery: 4 });
    expect(every4.pathHash).toBe(every1.pathHash);
    expect(every1.sampleCount).toBe(every1.steps + 1);
    expect(every4.sampleCount).toBe(Math.ceil(every4.steps / 4) + 1);
    // Step 0 and the final step are always recorded.
    expect(every4.samples[0]).toBeCloseTo(-0.9, 6);
    const last = (every4.sampleCount - 1) * 3;
    expect(every4.samples[last]).toBe(every1.samples[every1.steps * 3]);
    expect(every4.samples[last + 2]).toBe(every1.samples[every1.steps * 3 + 2]);
  });

  it('changes the pathHash when a planet moves by 1e-3', () => {
    const a = simulate(BENT, { p1: [0, -0.3] });
    const b = simulate(BENT, { p1: [0.001, -0.3] });
    expect(b.pathHash).not.toBe(a.pathHash);
  });

  it('reaches every outcome', () => {
    expect(simulate(STRAIGHT).outcome).toBe('solved');

    const hitPlanet = simulate(withBody(STRAIGHT, { id: 'rock', kind: 'planet', position: [0, 0] }));
    expect(hitPlanet.outcome).toBe('collision');
    expect(hitPlanet.endBodyId).toBe('rock');

    const hole = simulate(withBody(STRAIGHT, { id: 'hole', kind: 'black-hole', position: [0, 0] }));
    expect(hole.outcome).toBe('swallowed');
    expect(hole.endBodyId).toBe('hole');

    expect(simulate({ ...STRAIGHT, target: OFF_LINE_TARGET }).outcome).toBe('out-of-bounds');
    expect(simulate({ ...STRAIGHT, target: OFF_LINE_TARGET, maxTime: 0.05 }).outcome).toBe('timeout');
  });

  it('pushes the comet away from a repulsor beside the path', () => {
    const level = withBody(
      { ...STRAIGHT, target: OFF_LINE_TARGET },
      { id: 'push', kind: 'repulsor', position: [0, -0.2] },
    );
    const result = simulate(level);
    const lastZ = result.samples[(result.sampleCount - 1) * 3 + 2];
    // The repulsor sits at -z, so the comet ends up deflected toward +z.
    expect(lastZ).toBeGreaterThan(0.05);
  });

  it('moves a moon along its orbit formula', () => {
    const level = withBody(
      withBody(STRAIGHT, { id: 'core', kind: 'planet', position: [0.1, -0.2], height: 0.05 }),
      { id: 'moon', kind: 'moon', position: [0.4, -0.2], orbit: { parent: 'core', radius: 0.3, period: 6, phase: 0.5 } },
    );
    const bodies = createSimBodies(level, {});
    const out = new Float64Array(3);
    for (const [t, angle] of [
      [0, 0.5],
      [1.5, Math.PI / 2 + 0.5],
    ]) {
      bodyPositionAt(bodies, 1, t, out);
      expect(out[0]).toBeCloseTo(0.1 + 0.3 * Math.cos(angle), 12);
      expect(out[1]).toBeCloseTo(0.05, 12);
      expect(out[2]).toBeCloseTo(-0.2 + 0.3 * Math.sin(angle), 12);
    }
  });

  it('bends the path with a real-object external well and reports its flyby', () => {
    const plain = simulate(STRAIGHT);
    const withWell = simulate(STRAIGHT, {}, {
      externalWells: [{ id: 'mug', source: 'real-object', position: [0, 0.05, -0.25], radius: 0.05 }],
    });
    expect(withWell.pathHash).not.toBe(plain.pathHash);
    expect(withWell.flybys).toContainEqual(
      expect.objectContaining({ bodyId: 'mug', source: 'real-object' }),
    );
  });

  it('records both sides of a teleport and no sample in between', () => {
    const [a, b] = withStubWormhole(() => [simulate(WORMHOLE_LEVEL), simulate(WORMHOLE_LEVEL)]);
    expect(a.outcome).toBe('solved');
    expect(a.teleports).toHaveLength(1);
    const [jump] = a.teleports;
    expect(jump.bodyId).toBe('gate');
    expect(jump.time).toBeCloseTo(jump.step * SIM_DT, 12);
    // Contact fires on the first step inside the 0.05 entry radius.
    expect(jump.entry[0]).toBeGreaterThan(-0.35);
    expect(jump.entry[0]).toBeLessThan(-0.34);
    expect(jump.exit).toEqual(WORMHOLE_EXIT);
    for (let i = 0; i < a.sampleCount; i++) {
      const x = a.samples[i * 3];
      expect(x <= jump.entry[0] + 1e-6 || x >= WORMHOLE_EXIT[0] - 1e-6, `sample ${i} x=${x}`).toBe(true);
    }
    expect(b.pathHash).toBe(a.pathHash);
    expect(b.teleports).toEqual(a.teleports);
    expect(simulate(STRAIGHT).teleports).toEqual([]);
  });

  it('caps recorded samples and writes them into a given buffer without changing the flight', () => {
    const full = simulate(BENT);
    const buffer = new Float32Array(30);
    const capped = simulate(BENT, {}, { maxSamples: 10, sampleBuffer: buffer });
    expect(capped.sampleCount).toBe(10);
    expect(capped.samples.buffer).toBe(buffer.buffer);
    expect(Array.from(capped.samples)).toEqual(Array.from(full.samples.subarray(0, 30)));
    expect(capped.steps).toBe(full.steps);
    expect(capped.outcome).toBe(full.outcome);
    expect(capped.pathHash).toBe(full.pathHash);
    expect(capped.flybys).toEqual(full.flybys);
    expect(fullSampleCount(full.steps, full.sampleEvery)).toBe(full.sampleCount);
    expect(() => simulate(BENT, {}, { maxSamples: 11, sampleBuffer: buffer })).toThrow();
  });

  it('rejects an external well with neither mass nor radius', () => {
    expect(() =>
      simulate(STRAIGHT, {}, { externalWells: [{ id: 'w', source: 'real-object', position: [0, 0, 0] }] }),
    ).toThrow(Error);
  });
});
