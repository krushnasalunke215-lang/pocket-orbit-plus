import { describe, expect, it } from 'vitest';
import { PREVIEW_FRACTION } from '../config.js';
import { ALL_LEVELS } from '../sim/levels/index.js';
import { simulate } from '../sim/simulate.js';
import { GameController } from './controller.js';
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
    const atRest = [0, 0, 0];
    game.bodyBoardPosition('moon', atRest);
    expect(atRest[0]).toBeCloseTo(0.3, 12);
    expect(atRest[2]).toBeCloseTo(-0.15, 12);
    game.launch();
    game.tick(1.5); // a quarter of the 6 s orbit
    const flying = [0, 0, 0];
    game.bodyBoardPosition('moon', flying);
    expect(flying[0]).toBeCloseTo(0, 6);
    expect(flying[2]).toBeCloseTo(0.15, 6);
    expect(game.bodyBoardPosition('missing', flying)).toBe(false);
  });

  it('previews the first part of the flight and memoizes it', () => {
    const game = new GameController(ALL_LEVELS);
    const full = simulate(game.level, game.placements);
    const preview = game.preview();
    expect(preview.count).toBe(Math.ceil(full.sampleCount * PREVIEW_FRACTION));
    expect(game.preview()).toBe(preview);
    game.setDraft('p1', [-0.075, -0.4]);
    const drafted = game.preview();
    expect(drafted).not.toBe(preview);
    expect(Array.from(drafted.samples)).toEqual(Array.from(simulate(game.level, game.level.solution).samples));
    game.clearDraft();
    expect(game.preview().count).toBe(preview.count);
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
