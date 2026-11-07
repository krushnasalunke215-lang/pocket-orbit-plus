import { describe, expect, it } from 'vitest';
import { PREVIEW_FRACTION } from '../config.js';
import { SIM_DT } from '../sim/constants.js';
import type { LevelDef } from '../sim/level.js';
import { ALL_LEVELS } from '../sim/levels/index.js';
import { simulate } from '../sim/simulate.js';
import { WORMHOLE_EXIT, WORMHOLE_LEVEL, withStubWormhole } from '../sim/test-fixtures.js';
import { GameController } from './controller.js';
import { segmentCrossesBreak } from './path-breaks.js';
import { deserializeGameState, serializeGameState } from './state.js';

function flyToEnd(game: GameController): void {
  for (let i = 0; i < 2000 && game.phase === 'flying'; i++) game.tick(1 / 60);
}

describe('GameController', () => {
  it('solves every level with its stored solution', () => {
    const game = new GameController(ALL_LEVELS);
    for (let i = 0; i < ALL_LEVELS.length; i++) {
      game.loadLevel(i);
      for (const [id, p] of Object.entries(game.level.solution)) game.setPlacement(id, p);
      const result = game.launch();
      expect(game.phase).toBe('flying');
      expect(game.attempts).toBe(1);
      game.tick(result.time / 2);
      expect(game.phase).toBe('flying');
      flyToEnd(game);
      expect(game.phase, game.level.id).toBe('solved');
      expect(game.solved).toBe(true);
      expect(game.lastOutcome).toBe('solved');
      expect(game.solvedLevelIds.has(game.level.id)).toBe(true);
      expect(game.flightTime).toBe(result.time);
    }
  });

  it('fails with zero moves', () => {
    const game = new GameController(ALL_LEVELS);
    for (let i = 0; i < ALL_LEVELS.length; i++) {
      game.loadLevel(i);
      game.launch();
      flyToEnd(game);
      expect(game.phase, game.level.id).toBe('failed');
      expect(game.lastOutcome).not.toBe('solved');
    }
  });

  it('cancels a running flight when a placement changes', () => {
    const game = new GameController(ALL_LEVELS);
    game.launch();
    game.tick(0.5);
    game.setPlacement('p1', [0.1, 0.2]);
    expect(game.phase).toBe('placing');
    expect(game.flightTime).toBe(0);
    expect(game.placements.p1).toEqual([0.1, 0.2]);
    expect(game.attempts).toBe(1);
  });

  it('rejects placements for fixed or unknown bodies', () => {
    const game = new GameController(ALL_LEVELS);
    game.loadLevel(2);
    expect(() => game.setPlacement('core', [0, 0])).toThrow();
    expect(() => game.setPlacement('nope', [0, 0])).toThrow();
    expect(() => game.setPlacement('p1', [Number.NaN, 0])).toThrow();
  });

  it('nextLevel advances and wraps to the first level', () => {
    const game = new GameController(ALL_LEVELS);
    const revision = game.levelRevision;
    for (let i = 1; i < ALL_LEVELS.length; i++) {
      game.nextLevel();
      expect(game.levelIndex).toBe(i);
    }
    game.nextLevel();
    expect(game.levelIndex).toBe(0);
    expect(game.levelRevision).toBe(revision + ALL_LEVELS.length);
    expect(game.attempts).toBe(0);
    expect(game.phase).toBe('placing');
  });

  it('plays the comet back from the precomputed samples', () => {
    const game = new GameController(ALL_LEVELS);
    const out = [0, 0, 0];
    game.cometBoardPosition(out);
    expect(out).toEqual([game.level.comet.position[0], 0, game.level.comet.position[1]]);
    const result = game.launch();
    game.tick(1e6);
    game.cometBoardPosition(out);
    const k = (result.sampleCount - 1) * 3;
    expect(out).toEqual([result.samples[k], result.samples[k + 1], result.samples[k + 2]]);
  });

  it('moves moons only while flying', () => {
    const game = new GameController(ALL_LEVELS);
    game.loadLevel(2);
    game.setPlacement('p1', game.level.solution.p1);
    const core = game.level.bodies.find((b) => b.id === 'core')!.position;
    const orbit = game.level.bodies.find((b) => b.id === 'moon')!.orbit!;
    const phase = orbit.phase ?? 0;
    const atRest = [0, 0, 0];
    game.bodyBoardPosition('moon', atRest);
    expect(atRest[0]).toBeCloseTo(core[0] + orbit.radius * Math.cos(phase), 12);
    expect(atRest[2]).toBeCloseTo(core[1] + orbit.radius * Math.sin(phase), 12);
    game.launch();
    game.tick(orbit.period / 4); // a quarter orbit
    const flying = [0, 0, 0];
    game.bodyBoardPosition('moon', flying);
    expect(flying[0]).toBeCloseTo(core[0] + orbit.radius * Math.cos(phase + Math.PI / 2), 6);
    expect(flying[2]).toBeCloseTo(core[1] + orbit.radius * Math.sin(phase + Math.PI / 2), 6);
    expect(game.bodyBoardPosition('missing', flying)).toBe(false);
  });

  it('previews the first part of the flight and memoizes it', () => {
    const game = new GameController(ALL_LEVELS);
    const head = (samples: Float32Array, count: number) => Array.from(samples.subarray(0, count * 3));
    const full = simulate(game.level, game.placements);
    const preview = game.preview();
    expect(preview.count).toBe(Math.ceil(full.sampleCount * PREVIEW_FRACTION));
    expect(head(preview.samples, preview.count)).toEqual(head(full.samples, preview.count));
    expect(game.preview()).toBe(preview);

    // The draft copies the point, so the caller may reuse its tuple.
    const point: [number, number] = [-0.075, -0.4];
    game.setDraft('p1', point);
    point[0] = 0.5;
    const drafted = game.preview();
    expect(drafted).not.toBe(preview);
    expect(drafted.samples).toBe(preview.samples); // one reused buffer
    const solved = simulate(game.level, { p1: [-0.075, -0.4] });
    expect(drafted.count).toBe(Math.ceil(solved.sampleCount * PREVIEW_FRACTION));
    expect(head(drafted.samples, drafted.count)).toEqual(head(solved.samples, drafted.count));
    expect(game.placements.p1).toEqual(game.level.bodies[0].position);

    game.clearDraft();
    expect(game.preview().count).toBe(preview.count);
  });

  it('plays a teleport back as a jump, never through the skipped middle', () => {
    const game = new GameController([WORMHOLE_LEVEL]);
    const result = withStubWormhole(() => game.launch());
    const [jump] = result.teleports;
    const out = [0, 0, 0];
    let lastBefore = -Infinity;
    for (let i = 0; game.phase === 'flying' && i < 2000; i++) {
      game.tick(1 / 90);
      game.cometBoardPosition(out);
      const passed = game.flightTime / SIM_DT >= jump.step;
      expect(game.teleportsPassed).toBe(passed ? 1 : 0);
      if (passed) expect(out[0]).toBeGreaterThanOrEqual(WORMHOLE_EXIT[0] - 1e-6);
      else {
        expect(out[0]).toBeLessThanOrEqual(jump.entry[0] + 1e-6);
        lastBefore = out[0];
      }
    }
    expect(game.phase).toBe('solved');
    expect(lastBefore).toBeGreaterThan(jump.entry[0] - 0.01);
  });

  it('breaks the preview arc at a teleport jump', () => {
    // The fixture as is (the jump lies in the recorded part), and starting just
    // before the gate so the shown 20% of the flight spans the jump.
    const nearGate: LevelDef = {
      ...WORMHOLE_LEVEL,
      comet: { position: [-0.4, 0], velocity: [0.5, 0] },
      target: { position: [0.9, 0], radius: 0.05 },
    };
    for (const level of [WORMHOLE_LEVEL, nearGate]) {
      withStubWormhole(() => {
        const game = new GameController([level]);
        const flight = simulate(level, {});
        const [jump] = flight.teleports;
        const preview = game.preview();
        expect(preview.breakCount, level.id).toBe(1);
        expect(preview.breaks[0]).toBe(Math.ceil(jump.step / flight.sampleEvery));
        if (level === nearGate) expect(preview.breaks[0]).toBeLessThan(preview.count);

        // Every segment the arc may draw keeps both ends on one side of the jump.
        const s = preview.samples;
        const end = level === nearGate ? preview.count : flight.sampleCount;
        let drawn = 0;
        for (let i = 0; i + 1 < end; i++) {
          if (segmentCrossesBreak(i, i + 1, preview.breaks, preview.breakCount)) continue;
          drawn++;
          const before = s[i * 3] <= jump.entry[0] + 1e-6 && s[(i + 1) * 3] <= jump.entry[0] + 1e-6;
          const after = s[i * 3] >= WORMHOLE_EXIT[0] - 1e-6 && s[(i + 1) * 3] >= WORMHOLE_EXIT[0] - 1e-6;
          expect(before || after, `segment ${i}-${i + 1}`).toBe(true);
        }
        expect(drawn).toBe(end - 2);
      });
    }
    // A flight without teleports has no breaks.
    expect(new GameController(ALL_LEVELS).preview().breakCount).toBe(0);
  });

  it('keeps external wells across level loads and refuses ids any level uses', () => {
    const game = new GameController(ALL_LEVELS);
    const plain = new GameController(ALL_LEVELS);
    const mug = { id: 'mug', position: [-0.3, 0, 0.15], radius: 0.06, source: 'real-object' } as const;
    game.setExternalWells([mug]);
    for (let i = 0; i < ALL_LEVELS.length; i++) {
      game.loadLevel(i);
      plain.loadLevel(i);
      expect(game.externalWells).toEqual([mug]);
      expect(game.launch().pathHash, game.level.id).not.toBe(plain.launch().pathHash);
    }

    // 'moon' is a body of c1-l3 only: refused while c1-l1 is loaded, and nothing changes.
    game.loadLevel(0);
    const revision = game.levelRevision;
    expect(() => game.setExternalWells([{ ...mug, id: 'moon' }])).toThrow(/moon/);
    expect(game.externalWells).toEqual([mug]);
    expect(game.levelRevision).toBe(revision);
    game.loadLevel(ALL_LEVELS.findIndex((l) => l.id === 'c1-l3'));
    expect(game.level.id).toBe('c1-l3');
  });

  it('round-trips through GameState JSON', () => {
    const game = new GameController(ALL_LEVELS);
    game.setPlacement('p1', [-0.075, -0.4]);
    game.launch();
    flyToEnd(game);
    game.nextLevel();
    game.setPlacement('p2', [0.15, -0.55]);
    game.launch();
    flyToEnd(game);
    const state = game.toState();
    const json = serializeGameState(state);

    const restored = new GameController(ALL_LEVELS);
    restored.fromState(deserializeGameState(json));
    expect(restored.toState()).toEqual(state);
    expect(restored.levelIndex).toBe(1);
    expect(restored.phase).toBe('placing');
    expect(restored.solvedLevelIds.has('c1-l1')).toBe(true);
    expect(() => restored.fromState({ ...state, levelId: 'missing' })).toThrow();
  });

  it('feeds external wells into launches', () => {
    const game = new GameController(ALL_LEVELS);
    game.setPlacement('p1', [-0.075, -0.4]);
    const plain = game.launch().pathHash;
    game.setExternalWells([{ id: 'mug', position: [-0.3, 0, 0.15], radius: 0.06, source: 'real-object' }]);
    const withWell = game.launch();
    expect(withWell.pathHash).not.toBe(plain);
    expect(withWell.flybys.some((f) => f.bodyId === 'mug')).toBe(true);
    expect(() => game.setExternalWells([{ id: 'bad', position: [0, 0, 0], source: 'real-object' }])).toThrow();
  });
});
