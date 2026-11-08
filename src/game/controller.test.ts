import { describe, expect, it } from 'vitest';
import { PREVIEW_FRACTION } from '../config.js';
import { SIM_DT } from '../sim/constants.js';
import { startPlacements, type LevelDef, type Placements } from '../sim/level.js';
import { ALL_LEVELS } from '../sim/levels/index.js';
import { SANDBOX_LEVELS } from '../sim/levels/sandbox.js';
import { simulate } from '../sim/simulate.js';
import { WORMHOLE_EXIT, WORMHOLE_LEVEL, withStubWormhole } from '../sim/test-fixtures.js';
import { GameController } from './controller.js';
import { segmentCrossesBreak } from './path-breaks.js';
import { DEFAULT_PAR, flightNotes, rungSequence, WELL_NOTE_MIDI } from './song.js';
import { deserializeGameState, serializeGameState } from './state.js';

/** A cup-sized well near the middle of the board. */
const MUG = { id: 'mug', position: [-0.3, 0, 0.15], radius: 0.06, source: 'real-object' } as const;

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

  it('never lets external wells change a story flight', () => {
    const game = new GameController(ALL_LEVELS, SANDBOX_LEVELS);
    const plain = new GameController(ALL_LEVELS);
    game.setExternalWells([MUG]);
    for (let i = 0; i < ALL_LEVELS.length; i++) {
      game.loadLevel(i);
      plain.loadLevel(i);
      expect(game.mode).toBe('story');
      expect(game.externalWells).toEqual([MUG]);
      expect(game.activeWells).toEqual([]);
      for (const g of [game, plain]) for (const [id, p] of Object.entries(g.level.solution)) g.setPlacement(id, p);
      // The preview and the launch both ignore the wells.
      expect(game.preview().count, game.level.id).toBe(plain.preview().count);
      const withWells = game.launch();
      const without = plain.launch();
      expect(withWells.pathHash, game.level.id).toBe(without.pathHash);
      expect(withWells.flybys.some((f) => f.bodyId === MUG.id)).toBe(false);
      flyToEnd(game);
      flyToEnd(plain);
      expect(game.phase, game.level.id).toBe('solved');
      expect(game.lastStars).toBe(plain.lastStars);
    }
  });

  it('feeds external wells into sandbox flights and keeps them across target changes', () => {
    const game = new GameController(ALL_LEVELS, SANDBOX_LEVELS);
    const plain = new GameController(ALL_LEVELS, SANDBOX_LEVELS);
    game.setExternalWells([MUG]);
    for (let i = 0; i < SANDBOX_LEVELS.length; i++) {
      game.loadSandbox(i);
      plain.loadSandbox(i);
      expect(game.mode).toBe('sandbox');
      expect(game.level.id).toBe(SANDBOX_LEVELS[i].id);
      expect(game.externalWells).toEqual([MUG]);
      expect(game.activeWells).toEqual([MUG]);
      const withWells = game.launch();
      expect(withWells.pathHash, game.level.id).not.toBe(plain.launch().pathHash);
      expect(withWells.flybys.some((f) => f.bodyId === MUG.id && f.source === 'real-object')).toBe(true);
      expect(game.lastNotes.find((n) => n.bodyId === MUG.id)?.midi).toBe(WELL_NOTE_MIDI);
    }
    // nextLevel cycles the sandbox targets and wraps; wells stay.
    game.loadSandbox(SANDBOX_LEVELS.length - 1);
    game.nextLevel();
    expect(game.mode).toBe('sandbox');
    expect(game.sandboxIndex).toBe(0);
    expect(game.externalWells).toEqual([MUG]);
  });

  it('refuses well ids that any story level or sandbox target uses, changing nothing', () => {
    const game = new GameController(ALL_LEVELS, SANDBOX_LEVELS);
    game.setExternalWells([MUG]);
    game.loadSandbox(0);
    const revision = game.levelRevision;
    // 'moon' is a body of c1-l3 only, 'p1' the sandbox planet.
    for (const id of ['moon', 'p1']) {
      expect(() => game.setExternalWells([{ ...MUG, id }])).toThrow(new RegExp(id));
      expect(game.externalWells).toEqual([MUG]);
    }
    expect(game.levelRevision).toBe(revision);
    expect(() => game.setExternalWells([{ id: 'bad', position: [0, 0, 0], source: 'real-object' }])).toThrow();
    game.loadLevel(ALL_LEVELS.findIndex((l) => l.id === 'c1-l3'));
    expect(game.level.id).toBe('c1-l3');
  });

  it('gives sandbox solves no stars and keeps saving and resuming the story level', () => {
    const game = new GameController(ALL_LEVELS, SANDBOX_LEVELS);
    const settings = { muted: false, volume: 0.8, quiet: false };
    const onboarding = { ghostHandDone: true };
    game.loadLevel(2);
    game.setPlacement('p1', [0.1, 0.2]);
    game.launch();
    flyToEnd(game);
    const story = game.toState(settings, onboarding);

    const index = SANDBOX_LEVELS.findIndex((l) => l.id === 'table-2');
    game.loadSandbox(index);
    const target = SANDBOX_LEVELS[index];
    game.setExternalWells(target.wellSolution!.wells);
    for (const [id, p] of Object.entries(target.wellSolution!.placements)) game.setPlacement(id, p);
    game.launch();
    flyToEnd(game);
    expect(game.phase).toBe('solved');
    expect(game.lastStars).toBe(0);
    expect(game.solvedLevelIds.has('table-2')).toBe(false);
    expect(game.bestStars.has('table-2')).toBe(false);
    // The save still names the story level, with its placements and attempts.
    expect(game.toState(settings, onboarding)).toEqual(story);
    game.nextLevel();
    expect(game.toState(settings, onboarding)).toEqual(story);

    const restored = new GameController(ALL_LEVELS, SANDBOX_LEVELS);
    restored.fromState(game.toState(settings, onboarding));
    expect(restored.mode).toBe('story');
    expect(restored.level.id).toBe('c1-l3');

    // Exiting returns to that story level as it was left; the wells stay set but do nothing there.
    game.exitSandbox();
    expect(game.mode).toBe('story');
    expect(game.level.id).toBe('c1-l3');
    expect(game.placements.p1).toEqual([0.1, 0.2]);
    expect(game.attempts).toBe(story.attempts);
    expect(game.lastOutcome).toBe(story.lastOutcome);
    expect(game.externalWells).toEqual(target.wellSolution!.wells);
    expect(game.activeWells).toEqual([]);
  });

  it('round-trips through GameState JSON with stars, settings and onboarding', () => {
    const settings = { muted: true, volume: 0.4, quiet: false };
    const onboarding = { ghostHandDone: true };
    const game = new GameController(ALL_LEVELS);
    game.setPlacement('p1', [-0.075, -0.4]);
    game.launch();
    flyToEnd(game);
    expect(game.bestStars.get('c1-l1')).toBe(3);
    game.nextLevel();
    game.setPlacement('p2', [0.15, -0.55]);
    game.launch();
    flyToEnd(game);
    const state = game.toState(settings, onboarding);
    expect(state.version).toBe(2);
    expect(state.stars).toEqual({ 'c1-l1': 3 });
    expect(state.settings).toEqual(settings);
    expect(state.onboarding).toEqual(onboarding);
    const json = serializeGameState(state);

    const restored = new GameController(ALL_LEVELS);
    const starsRevision = restored.starsRevision;
    restored.fromState(deserializeGameState(json));
    expect(restored.toState(settings, onboarding)).toEqual(state);
    expect(restored.levelIndex).toBe(1);
    expect(restored.phase).toBe('placing');
    expect(restored.solvedLevelIds.has('c1-l1')).toBe(true);
    expect(restored.bestStars.get('c1-l1')).toBe(3);
    expect(restored.starsRevision).toBeGreaterThan(starsRevision);
    expect(restored.lastOutcome).toBe(state.lastOutcome);
  });

  it('falls back to the first level for an unknown level id, keeping stars and solved ids', () => {
    const game = new GameController(ALL_LEVELS);
    game.loadLevel(2);
    const state = {
      ...game.toState({ muted: false, volume: 0.8, quiet: false }, { ghostHandDone: false }),
      levelId: 'removed-level',
      placements: { p1: [0.1, 0.1] as [number, number] },
      attempts: 4,
      solvedLevelIds: ['c1-l1', 'c1-l2'],
      stars: { 'c1-l1': 3 as const, 'c1-l2': 2 as const },
      lastOutcome: 'collision' as const,
    };
    expect(() => game.fromState(state)).not.toThrow();
    expect(game.levelIndex).toBe(0);
    expect(game.attempts).toBe(0);
    expect(game.lastOutcome).toBeNull();
    expect(game.placements).toEqual(startPlacements(game.level));
    expect([...game.solvedLevelIds]).toEqual(['c1-l1', 'c1-l2']);
    expect(Object.fromEntries(game.bestStars)).toEqual({ 'c1-l1': 3, 'c1-l2': 2 });

    // A placement for a body the level does not move is skipped, not thrown.
    expect(() => game.fromState({ ...state, levelId: 'c1-l1', placements: { p1: [-0.075, -0.4], ghost: [0, 0] } })).not.toThrow();
    expect(game.placements.p1).toEqual([-0.075, -0.4]);
    expect(game.placements.ghost).toBeUndefined();
  });

  it('rates the stored solution of c1-l1 with 3 stars (its melody is the one planet)', () => {
    const game = new GameController(ALL_LEVELS);
    game.setPlacement('p1', game.level.solution.p1);
    const result = game.launch();
    expect(game.lastNotes).toEqual(flightNotes(game.level, result.flybys));
    expect(game.lastNotes.map((n) => n.bodyId)).toEqual(['p1']);
    game.tick(result.time / 2);
    expect(game.lastStars).toBe(0);
    flyToEnd(game);
    expect(game.phase).toBe('solved');
    expect(game.lastRung).toEqual(['p1']);
    expect(game.lastStars).toBe(3);
    expect(game.bestStars.get('c1-l1')).toBe(3);
    expect(game.starsRevision).toBe(1);
  });

  it('gives 1-2 stars by attempts for a non-melody solve and 3 for the melody solution', () => {
    const game = new GameController(ALL_LEVELS);
    const solve = (placements: Placements) => {
      for (const [id, p] of Object.entries(placements)) game.setPlacement(id, p);
      game.launch();
      flyToEnd(game);
      expect(game.phase, game.level.id).toBe('solved');
    };
    const index = ALL_LEVELS.findIndex((l) => l.id === 'c1-l2');
    game.loadLevel(index);
    const level = game.level;
    expect(level.melodySolution).toBeDefined();
    expect(rungSequence(level, simulate(level, level.solution).flybys)).not.toEqual(level.melody);

    // Within par: 2 stars.
    solve(level.solution);
    expect(game.attempts).toBe(1);
    expect(game.lastStars).toBe(2);
    expect(game.lastRung).toEqual(['p1', 'p2']);

    // Past par: failed launches first, then the same solve earns 1 star.
    game.loadLevel(index);
    const par = level.par ?? DEFAULT_PAR;
    for (let i = 0; i < par; i++) {
      game.launch();
      flyToEnd(game);
      expect(game.phase).toBe('failed');
      expect(game.lastStars).toBe(0);
    }
    solve(level.solution);
    expect(game.attempts).toBe(par + 1);
    expect(game.lastStars).toBe(1);
    expect(game.bestStars.get(level.id)).toBe(2);

    // The melody solution rings the melody: 3 stars, whatever the attempts.
    solve(level.melodySolution!);
    expect(game.lastRung).toEqual([...level.melody!]);
    expect(game.lastStars).toBe(3);
    expect(game.bestStars.get(level.id)).toBe(3);
  });

  it('keeps the best stars across replays and level loads', () => {
    const game = new GameController(ALL_LEVELS);
    const index = ALL_LEVELS.findIndex((l) => l.id === 'c1-l3');
    game.loadLevel(index);
    const level = game.level;
    const solve = (placements: Placements) => {
      for (const [id, p] of Object.entries(placements)) game.setPlacement(id, p);
      game.launch();
      flyToEnd(game);
    };
    solve(level.melodySolution!);
    expect(game.lastStars).toBe(3);
    const revision = game.starsRevision;

    // A replay with the plain solution rates 2 but leaves the best at 3.
    solve(level.solution);
    expect(game.lastStars).toBe(2);
    expect(game.bestStars.get(level.id)).toBe(3);
    expect(game.starsRevision).toBe(revision);

    // A level load clears the last flight but not the best.
    game.loadLevel(index);
    expect(game.lastStars).toBe(0);
    expect(game.lastRung).toEqual([]);
    expect(game.lastNotes).toEqual([]);
    expect(game.bestStars.get(level.id)).toBe(3);

    // A replay launch resets the last rating until it solves again.
    solve(level.solution);
    expect(game.lastStars).toBe(2);
    game.launch();
    expect(game.lastStars).toBe(0);
    expect(game.lastRung).toEqual([]);
  });

  it('rings no well notes in a story flight, so the melody and stars are untouched', () => {
    const game = new GameController(ALL_LEVELS, SANDBOX_LEVELS);
    // A small well by the comet's start would ring first if story flights used it.
    game.setExternalWells([{ id: 'mug', position: [-0.6, 0, -0.3], radius: 0.02, source: 'real-object' }]);
    game.setPlacement('p1', game.level.solution.p1);
    game.launch();
    expect(game.lastNotes.map((n) => [n.bodyId, n.midi])).toEqual([['p1', 72]]);
    flyToEnd(game);
    expect(game.phase).toBe('solved');
    expect(game.lastRung).toEqual(['p1']);
    expect(game.lastStars).toBe(3);
  });
});
