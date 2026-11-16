import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { AudioEngineState } from '../src/audio/engine';
import { RENDER_BUDGET } from '../src/config';
import type { GameSnapshot, ScreenPoint } from '../src/debug/debug-api';
import { HUD_SIZE } from '../src/game/hud-layout';
import type { Placements } from '../src/sim/level';

/*
 * Desktop mouse play through the dev/e2e debug API (window.__game): the
 * mouse drags planets with the same built-in ray / distance grab that XR
 * hands use, and the snapshot reports what the game saw.
 */

function screenshotPath(name: string): string {
  const dir = path.resolve(test.info().config.rootDir, '..', '.agents', 'tasks', 'screenshots', 'final-fix');
  mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}

async function openGame(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60_000 });
}

function snapshot(page: Page): Promise<GameSnapshot> {
  return page.evaluate(() => window.__game!.snapshot());
}

async function screenPoint(page: Page, board: readonly number[]): Promise<ScreenPoint> {
  const point = await page.evaluate((p) => window.__game!.screenPoint(p), board as number[]);
  expect(point, `screen point of ${JSON.stringify(board)}`).not.toBeNull();
  return point!;
}

async function waitUntilNotFlying(page: Page): Promise<void> {
  // A lost flight plays to its end: up to about 40 s at SwiftShader's frame rate with the realistic scene.
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 60_000 }).not.toBe('flying');
}

/** Drags a body from where it is to a board point (or to a raw screen point). */
async function dragBody(page: Page, bodyId: string, to: readonly number[] | ScreenPoint): Promise<void> {
  const before = await snapshot(page);
  const index = before.bodies.findIndex((b) => b.id === bodyId);
  expect(index, `body ${bodyId}`).toBeGreaterThanOrEqual(0);
  const from = await screenPoint(page, before.bodies[index].board);
  // A board goal [x, z] is at the body's own (lifted) height, where the cursor ray meets the drag plane.
  const goal = 'x' in to ? null : to.length === 2 ? [to[0], before.bodies[index].board[1], to[1]] : to;
  const target = 'x' in to ? to : await screenPoint(page, goal!);

  // Hover is computed only when the pointer moves, and the very first move
  // into a fresh page never registers in @pmndrs/pointer-events, so arrive
  // with two moves and wait until the body is really hovered before pressing.
  await page.mouse.move(from.x - 2, from.y);
  await page.mouse.move(from.x, from.y);
  await expect
    .poll(async () => (await snapshot(page)).bodies[index].hovered, { message: `${bodyId} hovered`, timeout: 10_000 })
    .toBe(true);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 15 });
  await expect
    .poll(async () => (await snapshot(page)).bodies[index].held, { message: `${bodyId} held mid-drag`, timeout: 10_000 })
    .toBe(true);
  await page.mouse.up();
  await expect.poll(async () => (await snapshot(page)).bodies[index].held, { message: `${bodyId} released` }).toBe(false);
}

function audioState(page: Page): Promise<AudioEngineState> {
  return page.evaluate(() => window.__game!.audio.state());
}

/** Drags every movable body to `placements` (one launch per drag) and waits for the solve. */
async function solveWith(page: Page, placements: Placements): Promise<GameSnapshot> {
  for (const [id, p] of Object.entries(placements)) {
    await waitUntilNotFlying(page);
    await dragBody(page, id, p);
  }
  await expect.poll(async () => (await snapshot(page)).solved, { timeout: 30_000 }).toBe(true);
  return snapshot(page);
}

test('solves all six levels with the mouse', async ({ page }) => {
  // Eight drags and about 35 s of flights; SwiftShader draws the realistic scene at a few fps, so flights play slower.
  test.setTimeout(720_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await openGame(page);
  const levels = await page.evaluate(() => window.__game!.levels());
  expect(levels.length).toBe(6);

  for (let i = 0; i < levels.length; i++) {
    await page.evaluate((n) => window.__game!.loadLevel(n), i);
    if (i === 0) {
      // Art-direction capture before any move: tray planets, preview arc, target.
      await page.waitForTimeout(500);
      await page.screenshot({ path: screenshotPath('desktop-l1-start.png') });
    }
    for (const [id, p] of Object.entries(levels[i].solution)) {
      await waitUntilNotFlying(page);
      await dragBody(page, id, p);
    }
    if (i === 1) {
      // Art-direction capture about 40% into the solving flight: comet tail and trail.
      await expect
        .poll(
          async () => {
            const s = await snapshot(page);
            return s.phase === 'flying' && s.flightTime >= 0.4 * s.flightDuration;
          },
          { timeout: 30_000, intervals: [30] },
        )
        .toBe(true);
      await page.screenshot({ path: screenshotPath('desktop-l2-midflight.png') });
    }
    await expect.poll(async () => (await snapshot(page)).solved, { timeout: 30_000 }).toBe(true);
    const solved = await snapshot(page);
    expect(solved.level.id).toBe(levels[i].id);
    for (const [id, p] of Object.entries(levels[i].solution)) {
      expect(Math.hypot(solved.placements[id][0] - p[0], solved.placements[id][1] - p[1]), id).toBeLessThan(0.01);
    }
    expect(solved.stars.last, `${levels[i].id} stars`).toBeGreaterThanOrEqual(1);
    await page.screenshot({ path: screenshotPath(`desktop-l${i + 1}-solved.png`) });
    console.log(
      `level ${i + 1}: attempts ${solved.attempts}, stars ${solved.stars.last}, rung ${solved.stars.rung.join(',')}, hud ${JSON.stringify(solved.hud.size)} m, renderer`,
      JSON.stringify(solved.renderer),
    );
  }
  expect(errors).toEqual([]);
});

test('audio: unlock, note order and offline renders', async ({ page }) => {
  test.setTimeout(180_000);
  await openGame(page);
  const locked = await audioState(page);
  expect(locked.unlocked, 'no sound before a gesture').toBe(false);

  // The first click anywhere on the canvas unlocks audio (an empty corner here).
  const canvas = await page.locator('canvas').first().boundingBox();
  expect(canvas).not.toBeNull();
  await page.mouse.click(canvas!.x + 30, canvas!.y + 30);
  await expect.poll(async () => (await audioState(page)).contextState, { timeout: 10_000 }).toBe('running');
  expect((await audioState(page)).unlocked).toBe(true);

  // Moonrise's stored solution rings moon, core, p1.
  const levels = await page.evaluate(() => window.__game!.levels());
  const index = levels.findIndex((l) => l.id === 'c1-l3');
  await page.evaluate((n) => window.__game!.loadLevel(n), index);
  const solved = await solveWith(page, levels[index].solution);

  const expected = await page.evaluate(() => window.__game!.audio.expectedNotes());
  expect(expected.length).toBeGreaterThanOrEqual(2);
  const flightId = expected[0].flightId;
  await expect
    .poll(async () => (await page.evaluate(() => window.__game!.audio.events())).some((e) => e.kind === 'chord' && e.flightId === flightId))
    .toBe(true);
  const events = (await page.evaluate(() => window.__game!.audio.events())).filter((e) => e.flightId === flightId);
  console.log('audio expected', JSON.stringify(expected));
  console.log('audio events', JSON.stringify(events));

  // Flyby notes: the same bodies in the same order, each at most 0.35 s late.
  const flybys = events.filter((e) => e.kind === 'flyby');
  expect(flybys.map((e) => e.bodyId)).toEqual(expected.map((n) => n.bodyId));
  expect(flybys.map((e) => e.midi)).toEqual(expected.map((n) => n.midi));
  for (let i = 0; i < flybys.length; i++) {
    expect(flybys[i].flightTime, `${flybys[i].bodyId} not early`).toBeGreaterThanOrEqual(expected[i].time);
    expect(flybys[i].flightTime, `${flybys[i].bodyId} at most 0.35 s late`).toBeLessThanOrEqual(expected[i].time + 0.35);
  }

  // Then the phrase in rung order, then exactly one chord, last and latest.
  const lastFlyby = events.lastIndexOf(flybys[flybys.length - 1]);
  const after = events.slice(lastFlyby + 1).filter((e) => e.kind === 'phrase' || e.kind === 'chord');
  const phrase = after.filter((e) => e.kind === 'phrase');
  expect(phrase.map((e) => e.bodyId)).toEqual(solved.stars.rung);
  expect(after.filter((e) => e.kind === 'chord')).toHaveLength(1);
  expect(after[after.length - 1].kind).toBe('chord');
  for (let i = 1; i < after.length; i++) expect(after[i].ctxTime).toBeGreaterThan(after[i - 1].ctxTime);

  for (const voice of ['bell', 'chord'] as const) {
    const render = await page.evaluate((v) => window.__game!.audio.renderOffline(v), voice);
    console.log(`offline ${voice}`, JSON.stringify(render));
    expect(render.peak, `${voice} peak`).toBeGreaterThan(0.01);
    expect(render.peak, `${voice} peak`).toBeLessThan(1.0);
    expect(render.rms, `${voice} rms`).toBeGreaterThan(0.001);
  }
});

test('3-star melody run', async ({ page }) => {
  test.setTimeout(180_000);
  await openGame(page);
  const levels = await page.evaluate(() => window.__game!.levels());
  // Event Horizon: the stored solution rings hole, p1; the melody asks for p1, hole.
  const index = levels.findIndex((l) => l.id === 'c1-l4');
  const level = levels[index];
  expect(level.melodySolution).not.toBeNull();
  await page.evaluate((n) => window.__game!.loadLevel(n), index);

  const plain = await solveWith(page, level.solution);
  expect(plain.attempts).toBe(1);
  expect(plain.stars.rung).not.toEqual(level.melody);
  expect([1, 2]).toContain(plain.stars.last);
  expect(plain.stars.best[level.id]).toBe(plain.stars.last);

  for (const [id, p] of Object.entries(level.melodySolution!)) await dragBody(page, id, p);
  await expect.poll(async () => (await snapshot(page)).attempts, { timeout: 10_000 }).toBe(2);
  await expect.poll(async () => (await snapshot(page)).solved, { timeout: 30_000 }).toBe(true);
  const melody = await snapshot(page);
  expect(melody.stars.rung).toEqual(level.melody);
  expect(melody.stars.last).toBe(3);
  expect(melody.stars.best[level.id]).toBe(3);
  await page.waitForTimeout(300); // the HUD status text relayout
  await page.screenshot({ path: screenshotPath('desktop-3-stars.png') });
});

test('resumes at the current level after a reload', async ({ page }) => {
  test.setTimeout(240_000);
  await openGame(page);
  const levels = await page.evaluate(() => window.__game!.levels());
  for (const i of [0, 1]) {
    await page.evaluate((n) => window.__game!.loadLevel(n), i);
    const solved = await solveWith(page, levels[i].solution);
    expect(solved.level.id).toBe(levels[i].id);
  }
  await page.evaluate(() => window.__game!.loadLevel(2));
  // The sky constellation: the two solved levels' stars and their link.
  await expect.poll(async () => (await snapshot(page)).sky.litStars, { timeout: 10_000 }).toBe(2);
  const before = await snapshot(page);
  expect(before.sky.links).toBe(1);
  expect(before.save.lastSavedAt).not.toBeNull();
  expect(before.save.problem).toBeNull();

  await page.reload();
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60_000 });
  await expect.poll(async () => (await snapshot(page)).levelBuilt, { timeout: 10_000 }).toBe(true);
  const after = await snapshot(page);
  console.log('resumed', JSON.stringify({ level: after.level, solved: after.solvedLevelIds, stars: after.stars.best }));
  expect(after.level.index).toBe(2);
  expect(after.level.id).toBe(levels[2].id);
  expect(after.phase).toBe('placing');
  expect(after.solvedLevelIds).toEqual(expect.arrayContaining(['c1-l1', 'c1-l2']));
  for (const id of ['c1-l1', 'c1-l2']) {
    expect(after.stars.best[id], `${id} stars`).toBe(before.stars.best[id]);
    expect(after.stars.best[id]).toBeGreaterThanOrEqual(1);
  }
  expect(after.save.problem).toBeNull();
  // The constellation is rebuilt from the saved solved levels.
  expect(after.sky).toMatchObject({ litStars: 2, links: 1 });
});

test('corrupt save starts fresh', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.addInitScript(() => localStorage.setItem('orbit-puzzle.save', '{not json'));
  await openGame(page);
  const fresh = await snapshot(page);
  expect(fresh.level.index).toBe(0);
  expect(fresh.attempts).toBe(0);
  expect(fresh.solvedLevelIds).toEqual([]);
  expect(fresh.save.problem).toMatch(/corrupt save/);
  expect(await page.evaluate(() => localStorage.getItem('orbit-puzzle.save.corrupt'))).toBe('{not json');

  // Still playable: a solve works and is saved over the corrupt text.
  const levels = await page.evaluate(() => window.__game!.levels());
  const solved = await solveWith(page, levels[0].solution);
  expect(solved.level.index).toBe(0);
  const saved = await page.evaluate(() => localStorage.getItem('orbit-puzzle.save'));
  expect(JSON.parse(saved!).solvedLevelIds).toContain('c1-l1');
  expect(errors).toEqual([]);
});

test('page hide pauses the flight and the audio', async ({ page }) => {
  test.setTimeout(180_000);
  await openGame(page);
  await page.evaluate(() => window.__game!.loadLevel(0));
  const levels = await page.evaluate(() => window.__game!.levels());
  // The drag's pointerdown is the unlock gesture.
  await solveWith(page, levels[0].solution);
  await expect.poll(async () => (await audioState(page)).contextState, { timeout: 10_000 }).toBe('running');

  // Replay and hide the page in the same call, so the flight is surely running.
  const hidden = await page.evaluate(() => {
    window.__game!.launch();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    return window.__game!.snapshot();
  });
  expect(hidden.phase).toBe('flying');
  expect(hidden.pause).toEqual({ paused: true, reason: 'page-hidden' });
  const attempts = hidden.attempts;
  await expect.poll(async () => (await audioState(page)).contextState, { timeout: 5_000 }).toBe('suspended');
  const frozen = (await snapshot(page)).flightTime;
  await page.waitForTimeout(1000);
  const later = await snapshot(page);
  expect(later.phase).toBe('flying');
  expect(later.flightTime).toBe(frozen);
  expect(later.pause.paused).toBe(true);

  await page.evaluate(() => {
    // Drop the override: the prototype getter reports the real 'visible'.
    delete (document as unknown as { visibilityState?: string }).visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => (await snapshot(page)).pause.paused, { timeout: 5_000 }).toBe(false);
  await expect.poll(async () => (await snapshot(page)).flightTime, { timeout: 10_000 }).toBeGreaterThan(frozen);
  await expect.poll(async () => (await snapshot(page)).solved, { timeout: 30_000 }).toBe(true);
  const end = await snapshot(page);
  expect(end.attempts).toBe(attempts);
  expect(end.flightTime).toBeCloseTo(end.flightDuration, 6);
  await expect.poll(async () => (await audioState(page)).contextState, { timeout: 5_000 }).toBe('running');
});

/** Moves the mouse onto a HUD or level-select element (two moves, see dragBody) and clicks it. */
async function clickUi(page: Page, elementId: string): Promise<void> {
  const point = await page.evaluate((id) => window.__game!.hudScreenPoint(id), elementId);
  expect(point, `screen point of ${elementId}`).not.toBeNull();
  await page.mouse.move(point!.x - 2, point!.y);
  await page.mouse.move(point!.x, point!.y);
  await page.mouse.click(point!.x, point!.y);
}

test('attract loop runs until the first interaction', async ({ page }) => {
  test.setTimeout(120_000);
  await openGame(page);
  const start = await snapshot(page);
  expect(start.level.index).toBe(0);
  expect(start.attract, 'attract loop after load').toBe(true);
  expect(start.attempts).toBe(0);
  expect(start.phase).toBe('placing');
  // The loop moves only the comet visual: the game state stays at rest.
  await page.waitForTimeout(1500);
  const looping = await snapshot(page);
  expect(looping.attract).toBe(true);
  expect(looping.attempts).toBe(0);
  expect(looping.phase).toBe('placing');
  expect(looping.flightTime).toBe(0);
  expect(looping.comet.board).toEqual(start.comet.board);

  // Hovering a planet is the first interaction.
  const body = looping.bodies.find((b) => b.movable)!;
  const index = looping.bodies.indexOf(body);
  const at = await screenPoint(page, body.board);
  await page.mouse.move(at.x - 2, at.y);
  await page.mouse.move(at.x, at.y);
  await expect.poll(async () => (await snapshot(page)).bodies[index].hovered, { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await snapshot(page)).attract, { timeout: 5_000 }).toBe(false);
  const after = await snapshot(page);
  expect(after.attempts).toBe(0);
  expect(after.phase).toBe('placing');
  // For good: moving away does not restart it.
  await page.mouse.move(20, 20);
  await page.waitForTimeout(800);
  expect((await snapshot(page)).attract).toBe(false);
});

test('ghost hand on level 1 stops at the first grab', async ({ page }) => {
  test.setTimeout(180_000);
  await openGame(page);
  await page.evaluate(() => window.__game!.clearSave());
  await page.evaluate(() => window.__game!.loadLevel(0));
  const start = await snapshot(page);
  expect(start.ghostHand.done).toBe(false);
  await expect.poll(async () => (await snapshot(page)).ghostHand.visible, { timeout: 5_000 }).toBe(true);
  // Capture mid-carry (about 1.9-2.7 s into its 5.2 s loop).
  await expect
    .poll(
      async () => {
        const t = (await snapshot(page)).ghostHand.time % 5.2;
        return t > 1.9 && t < 2.7;
      },
      { timeout: 15_000, intervals: [40] },
    )
    .toBe(true);
  await page.screenshot({ path: screenshotPath('ghost-hand.png') });

  const levels = await page.evaluate(() => window.__game!.levels());
  const [id, p] = Object.entries(levels[0].solution)[0];
  await dragBody(page, id, p);
  const grabbed = await snapshot(page);
  expect(grabbed.ghostHand.visible, 'hidden after the first grab').toBe(false);
  expect(grabbed.ghostHand.done).toBe(true);
  await waitUntilNotFlying(page);
  expect((await snapshot(page)).ghostHand.visible).toBe(false);

  // Saved: still off after a reload on level 1.
  await page.reload();
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60_000 });
  await expect.poll(async () => (await snapshot(page)).levelBuilt, { timeout: 10_000 }).toBe(true);
  await page.waitForTimeout(500);
  const reloaded = await snapshot(page);
  expect(reloaded.level.index).toBe(0);
  expect(reloaded.phase).toBe('placing');
  expect(reloaded.ghostHand.done).toBe(true);
  expect(reloaded.ghostHand.visible).toBe(false);
});

test('level select: stars, loading a level and audio settings', async ({ page }) => {
  test.setTimeout(180_000);
  await openGame(page);
  await page.evaluate(() => window.__game!.loadLevel(0));
  const levels = await page.evaluate(() => window.__game!.levels());
  const solved = await solveWith(page, levels[0].solution);
  expect(solved.stars.best['c1-l1']).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(300); // the HUD relayout with the Next button

  const closed = await snapshot(page);
  expect(closed.levelSelect.ready).toBe(true);
  expect(closed.levelSelect.open).toBe(false);
  await clickUi(page, 'levels-button');
  await expect.poll(async () => (await snapshot(page)).levelSelect.open, { timeout: 5_000 }).toBe(true);
  await page.waitForTimeout(400); // pose and stars on the next frames
  const open = await snapshot(page);
  expect(open.levelSelect.buttonIds).toEqual(['level-1', 'level-2', 'level-3', 'level-4', 'level-5', 'level-6']);
  expect(open.levelSelect.shownStars[0], 'solved level 1 shows its stars').toBe(solved.stars.best['c1-l1']);
  expect(open.levelSelect.shownStars.slice(1), 'unsolved levels show none').toEqual([0, 0, 0, 0, 0]);
  console.log('level select', JSON.stringify(open.levelSelect));
  await page.screenshot({ path: screenshotPath('level-select.png') });

  // Audio settings on the Settings page edit the runtime settings the engine applies.
  await clickUi(page, 'settings-button');
  await expect.poll(async () => (await snapshot(page)).levelSelect.page, { timeout: 5_000 }).toBe('settings');
  await page.waitForTimeout(300); // the page relayout
  expect((await audioState(page)).muted).toBe(false);
  await clickUi(page, 'mute-button');
  await expect.poll(async () => (await audioState(page)).muted, { timeout: 5_000 }).toBe(true);
  await clickUi(page, 'volume-down');
  await expect.poll(async () => (await audioState(page)).volume, { timeout: 5_000 }).toBeCloseTo(0.7, 6);
  await clickUi(page, 'mute-button');
  await expect.poll(async () => (await audioState(page)).muted, { timeout: 5_000 }).toBe(false);
  expect((await snapshot(page)).levelSelect.open, 'settings keep the panel open').toBe(true);
  await clickUi(page, 'settings-back');
  await expect.poll(async () => (await snapshot(page)).levelSelect.page, { timeout: 5_000 }).toBe('levels');
  await page.waitForTimeout(300);

  // A level button loads that level and closes the panel.
  await clickUi(page, 'level-5');
  await expect.poll(async () => (await snapshot(page)).level.id, { timeout: 5_000 }).toBe('c1-l5');
  const loaded = await snapshot(page);
  expect(loaded.levelSelect.open).toBe(false);
  expect(loaded.phase).toBe('placing');
});

test('settings page: every accessibility and audio button by mouse, saved over a reload', async ({ page }) => {
  test.setTimeout(240_000);
  await openGame(page);
  await page.evaluate(() => window.__game!.loadLevel(0));
  await page.waitForTimeout(300);
  await clickUi(page, 'levels-button');
  await expect.poll(async () => (await snapshot(page)).levelSelect.open, { timeout: 5_000 }).toBe(true);
  await page.waitForTimeout(400);
  await clickUi(page, 'settings-button');
  await expect.poll(async () => (await snapshot(page)).levelSelect.page, { timeout: 5_000 }).toBe('settings');
  await page.waitForTimeout(400);
  const start = await snapshot(page);
  expect(start.accessibility.settings).toEqual({
    muted: false,
    volume: 0.8,
    quiet: false,
    leftHanded: false,
    highContrast: false,
    reducedMotion: false,
    boardSize: 'medium',
    roomView: 'mixed',
  });
  console.log('settings page', JSON.stringify({ position: start.levelSelect.position, size: start.levelSelect.size }));
  expect(start.levelSelect.size![0]).toBeLessThanOrEqual(0.461);
  expect(start.levelSelect.size![1]).toBeLessThanOrEqual(0.28);
  await page.screenshot({ path: screenshotPath('desktop-settings.png') });

  const a11y = async () => (await snapshot(page)).accessibility;
  await clickUi(page, 'left-handed-button');
  await expect.poll(async () => (await a11y()).ghostHandLeft, { timeout: 5_000 }).toBe(true);
  await clickUi(page, 'contrast-button');
  await expect.poll(async () => (await a11y()).highContrast, { timeout: 5_000 }).toBe(1);
  expect((await a11y()).outlinesVisible).toBe(true);
  expect((await a11y()).targetOutlineVisible).toBe(true);
  await clickUi(page, 'motion-button');
  await expect.poll(async () => (await a11y()).settings.reducedMotion, { timeout: 5_000 }).toBe(true);
  // RenderSyncSystem applies a settings change on its next frame.
  await expect.poll(async () => (await a11y()).trailFade, { timeout: 5_000 }).toBe(1e9);
  const radius = (await snapshot(page)).board.radius;
  await clickUi(page, 'board-size-button');
  await expect.poll(async () => (await snapshot(page)).board.radius, { timeout: 5_000 }).toBeCloseTo(radius * 1.25, 6);
  expect((await a11y()).settings.boardSize).toBe('large');
  await clickUi(page, 'mute-button');
  await clickUi(page, 'volume-up');
  await clickUi(page, 'quiet-button');
  await expect.poll(async () => (await audioState(page)).volume, { timeout: 5_000 }).toBeCloseTo(0.9, 6);
  // Room view cycles Mixed (the default), Space, Room; the desktop cosmos stays fully shown.
  await clickUi(page, 'room-view-button');
  await expect.poll(async () => (await a11y()).settings.roomView, { timeout: 5_000 }).toBe('space');
  expect((await snapshot(page)).cosmos).toMatchObject({ visible: true, opacity: 1, mask: 'none', roomView: 'space' });
  const on = await snapshot(page);
  expect(on.accessibility.settings).toEqual({
    muted: true,
    volume: 0.9,
    quiet: true,
    leftHanded: true,
    highContrast: true,
    reducedMotion: true,
    boardSize: 'large',
    roomView: 'space',
  });
  expect(on.levelSelect.open).toBe(true);
  expect(on.levelSelect.page).toBe('settings');
  await page.waitForTimeout(400); // the labels relayout
  await page.screenshot({ path: screenshotPath('desktop-settings-all-on.png') });

  // Reduced motion: the decorative clock, the target star and the bodies stand still.
  const a = await a11y();
  await page.waitForTimeout(700);
  const b = await a11y();
  expect(b.motionTime).toBe(a.motionTime);
  expect(b.targetStarYaw).toBe(a.targetStarYaw);
  expect(b.bodyYaw).toBe(a.bodyYaw);

  // Board size cycles large, small, medium.
  await clickUi(page, 'board-size-button');
  await expect.poll(async () => (await snapshot(page)).board.radius, { timeout: 5_000 }).toBeCloseTo(radius * 0.75, 6);
  await clickUi(page, 'board-size-button');
  await expect.poll(async () => (await snapshot(page)).board.radius, { timeout: 5_000 }).toBeCloseTo(radius, 6);
  await clickUi(page, 'board-size-button');
  await expect.poll(async () => (await snapshot(page)).board.radius, { timeout: 5_000 }).toBeCloseTo(radius * 1.25, 6);

  // Back to the levels page; Close closes the panel (in the three-quarter
  // desktop view the open panel covers the HUD's Levels button).
  await clickUi(page, 'settings-back');
  await expect.poll(async () => (await snapshot(page)).levelSelect.page, { timeout: 5_000 }).toBe('levels');
  await page.waitForTimeout(300);
  await clickUi(page, 'close-levels');
  await expect.poll(async () => (await snapshot(page)).levelSelect.open, { timeout: 5_000 }).toBe(false);

  // Saved with the game state (version 2), and restored by a reload.
  await expect
    .poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('orbit-puzzle.save') ?? '{}').settings?.boardSize), { timeout: 5_000 })
    .toBe('large');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('orbit-puzzle.save')!));
  expect(saved.version).toBe(2);
  expect(saved.settings).toEqual(on.accessibility.settings);
  await page.reload();
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60_000 });
  await expect.poll(async () => (await snapshot(page)).levelBuilt, { timeout: 10_000 }).toBe(true);
  await page.waitForTimeout(500);
  const reloaded = await snapshot(page);
  expect(reloaded.save.problem).toBeNull();
  expect(reloaded.accessibility.settings).toEqual(on.accessibility.settings);
  expect(reloaded.board.radius).toBeCloseTo(radius * 1.25, 6);
  expect(reloaded.accessibility.highContrast).toBe(1);
  expect(reloaded.accessibility.trailFade).toBe(1e9);
  expect(reloaded.accessibility.ghostHandLeft).toBe(true);
  expect((await audioState(page)).muted).toBe(true);
});

test('accessibility modes: screenshots of each', async ({ page }) => {
  test.setTimeout(300_000);
  await openGame(page);
  const setSettings = (partial: Record<string, unknown>) =>
    page.evaluate((p) => window.__game!.audio.setSettings(p as never), partial);
  const off = { leftHanded: false, highContrast: false, reducedMotion: false, boardSize: 'medium' };
  const levels = await page.evaluate(() => window.__game!.levels());

  // Left-handed: the ghost hand mid-carry is a left hand reaching in from the left.
  await page.evaluate(() => window.__game!.resetOnboarding());
  await setSettings({ ...off, leftHanded: true });
  await page.evaluate(() => window.__game!.loadLevel(0));
  await expect.poll(async () => (await snapshot(page)).ghostHand.visible, { timeout: 5_000 }).toBe(true);
  await expect
    .poll(
      async () => {
        const t = (await snapshot(page)).ghostHand.time % 5.2;
        return t > 1.9 && t < 2.7;
      },
      { timeout: 15_000, intervals: [40] },
    )
    .toBe(true);
  expect((await snapshot(page)).accessibility.ghostHandLeft).toBe(true);
  await page.screenshot({ path: screenshotPath('desktop-a11y-left-handed.png') });

  // High contrast on level 6 (black hole, planet, white star), with the same view off for comparison.
  await page.evaluate(() => window.__game!.loadLevel(5));
  await setSettings({ ...off });
  await page.waitForTimeout(500);
  await page.screenshot({ path: screenshotPath('desktop-a11y-contrast-off.png') });
  await setSettings({ ...off, highContrast: true });
  await page.waitForTimeout(500);
  const contrast = await snapshot(page);
  expect(contrast.accessibility.highContrast).toBe(1);
  expect(contrast.accessibility.outlinesVisible).toBe(true);
  await page.screenshot({ path: screenshotPath('desktop-a11y-high-contrast.png') });

  // Board sizes on level 1.
  await page.evaluate(() => window.__game!.loadLevel(0));
  for (const size of ['small', 'medium', 'large']) {
    await setSettings({ ...off, boardSize: size });
    await page.waitForTimeout(500);
    console.log(`board ${size}`, (await snapshot(page)).board.radius);
    await page.screenshot({ path: screenshotPath(`desktop-a11y-board-${size}.png`) });
  }

  // Reduced motion: a static trail after the level 6 solve, then the chapter
  // moment with no burst (the stars stand in their final ring at once).
  await setSettings({ ...off, reducedMotion: true });
  await page.evaluate(() => window.__game!.loadLevel(5));
  await page.evaluate((p) => window.__game!.setPlacements(p), levels[5].solution);
  await page.evaluate(() => window.__game!.launch());
  await expect.poll(async () => (await snapshot(page)).solved, { timeout: 90_000 }).toBe(true);
  await page.waitForTimeout(300);
  expect((await snapshot(page)).accessibility.trailFade).toBe(1e9);
  await page.screenshot({ path: screenshotPath('desktop-a11y-reduced-motion-trail.png') });
  await clickUi(page, 'next-button');
  await expect.poll(async () => (await snapshot(page)).chapterComplete.shown, { timeout: 10_000 }).toBe(true);
  // From its first frame the constellation stands at its final height (no rise).
  await expect.poll(async () => (await snapshot(page)).chapterComplete.starHeight, { timeout: 2_000, intervals: [20] }).toBeCloseTo(0.5, 6);
  const early = (await snapshot(page)).chapterComplete;
  expect(early.starSpin).toBe(0);
  await page.waitForTimeout(800);
  const later = (await snapshot(page)).chapterComplete;
  expect(later.starSpin).toBe(0);
  expect(later.starHeight).toBeCloseTo(0.5, 6);
  await page.screenshot({ path: screenshotPath('desktop-a11y-reduced-motion-chapter.png') });
});

test('chapter complete after level 6', async ({ page }) => {
  test.setTimeout(240_000);
  await openGame(page);
  const levels = await page.evaluate(() => window.__game!.levels());
  const last = levels.length - 1;
  await page.evaluate((n) => window.__game!.loadLevel(n), last);
  const solved = await solveWith(page, levels[last].solution);
  expect(solved.level.id).toBe('c1-l6');
  await page.waitForTimeout(300); // the HUD relayout with the Next button

  await clickUi(page, 'next-button');
  await expect.poll(async () => (await snapshot(page)).chapterComplete.shown, { timeout: 5_000 }).toBe(true);
  const moment = await snapshot(page);
  const total = Object.values(moment.stars.best).reduce((a, b) => a + b, 0);
  expect(moment.level.id, 'Next did not wrap to level 1').toBe('c1-l6');
  expect(moment.chapterComplete).toMatchObject({ shown: true, chapter: 1, stars: total, maxStars: 18 });
  expect(total).toBe(solved.stars.last);
  // HudSystem writes the status on the frame after the moment starts.
  await expect
    .poll(async () => (await snapshot(page)).hud.status, { timeout: 5_000 })
    .toBe(`Chapter 1 complete: ${total} of 18 stars`);
  // Let the stars rise, then capture the moment.
  await page.waitForTimeout(2500);
  // The HUD keeps the size the glasses-view geometry tests assume (HUD_SIZE).
  const hudSize = (await snapshot(page)).hud.size!;
  expect(hudSize[0]).toBeLessThanOrEqual(HUD_SIZE.width + 1e-6);
  expect(hudSize[1]).toBeLessThanOrEqual(HUD_SIZE.height + 1e-6);
  expect((await snapshot(page)).rimButton.shown, 'near-rim button hidden during the moment').toBe(false);
  await page.screenshot({ path: screenshotPath('chapter-complete.png') });
  await page.screenshot({ path: screenshotPath('l4-desktop-chapter.png') });
  expect((await snapshot(page)).sky.litStars).toBe(1);
  console.log('chapter complete', JSON.stringify({ chapter: moment.chapterComplete, hud: moment.hud }));

  // Nothing launches under the moment: a click where the near-rim button
  // was, and a drag on a planet (it takes no hover or grab), change nothing.
  const rim = await page.evaluate(() => window.__game!.hudScreenPoint('rim-launch-button'));
  expect(rim).not.toBeNull();
  await page.mouse.move(rim!.x - 2, rim!.y);
  await page.mouse.move(rim!.x, rim!.y);
  await page.mouse.click(rim!.x, rim!.y);
  const planet = moment.bodies.findIndex((b) => b.movable);
  const at = await screenPoint(page, moment.bodies[planet].board);
  await page.mouse.move(at.x - 2, at.y);
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(500);
  expect((await snapshot(page)).bodies[planet].hovered, 'planet takes no hover during the moment').toBe(false);
  await page.mouse.down();
  await page.mouse.move(at.x + 60, at.y + 30, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  const still = await snapshot(page);
  expect(still.attempts, 'no launch under the moment').toBe(moment.attempts);
  expect(still.phase).toBe('solved');
  expect(still.placements).toEqual(moment.placements);
  expect(still.chapterComplete.shown).toBe(true);

  // Play again loads level 1 and ends the moment.
  await clickUi(page, 'play-again-button');
  await expect.poll(async () => (await snapshot(page)).level.index, { timeout: 5_000 }).toBe(0);
  await expect.poll(async () => (await snapshot(page)).chapterComplete.shown, { timeout: 5_000 }).toBe(false);
  const again = await snapshot(page);
  expect(again.phase).toBe('placing');
  await expect.poll(async () => (await snapshot(page)).hud.status, { timeout: 5_000 }).not.toMatch(/^Chapter/);
  await expect.poll(async () => (await snapshot(page)).rimButton.shown, { timeout: 5_000 }).toBe(true);
});

test('space feedback: flyby ripples, capture flash, solve burst', async ({ page }) => {
  test.setTimeout(180_000);
  await openGame(page);
  const levels = await page.evaluate(() => window.__game!.levels());
  const recent = async () => (await snapshot(page)).spaceFx.recent;

  // Level 4 with no moves: the black hole swallows the comet (its lens flashes, the grid ripples inward).
  await page.evaluate(() => window.__game!.loadLevel(3));
  await page.evaluate(() => window.__game!.launch());
  await expect.poll(async () => (await snapshot(page)).lastOutcome, { timeout: 30_000 }).toBe('swallowed');
  await expect.poll(recent, { timeout: 5_000 }).toContain('capture');

  // Level 6 solved: a flash and ripple at each flyby (a push off the white star), the burst at the target.
  await page.evaluate(() => window.__game!.loadLevel(5));
  await page.evaluate((p) => window.__game!.setPlacements(p), levels[5].solution);
  const before = (await recent()).length;
  await page.evaluate(() => window.__game!.launch());
  await expect
    .poll(
      async () => {
        const s = await snapshot(page);
        return s.phase === 'flying' && s.flightTime >= 0.45 * s.flightDuration;
      },
      { timeout: 30_000, intervals: [30] },
    )
    .toBe(true);
  await page.screenshot({ path: screenshotPath('l2-desktop-l6-midflight.png') });
  await expect.poll(async () => (await snapshot(page)).solved, { timeout: 30_000 }).toBe(true);
  await expect.poll(recent, { timeout: 5_000 }).toContain('solve');
  // The solved comet rises into the sky and becomes level 6's star.
  await expect.poll(async () => (await snapshot(page)).sky.litStars, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  const all = await recent();
  // The history keeps the last 16 events: once full, read the last 8.
  const events = all.length < 16 ? all.slice(before) : all.slice(-8);
  console.log('space feedback', JSON.stringify(events));
  const firstFlyby = events.findIndex((e) => e === 'flyby' || e === 'push');
  expect(firstFlyby).toBeGreaterThanOrEqual(0);
  expect(firstFlyby).toBeLessThan(events.lastIndexOf('solve'));
});

test('render budget', async ({ page }) => {
  await openGame(page);
  await page.evaluate(() => window.__game!.loadLevel(0));
  await page.evaluate(() => window.__game!.resetRenderStats());
  const levels = await page.evaluate(() => window.__game!.levels());
  for (const [id, p] of Object.entries(levels[0].solution)) {
    await waitUntilNotFlying(page);
    await dragBody(page, id, p);
  }
  await expect.poll(async () => (await snapshot(page)).solved, { timeout: 30_000 }).toBe(true);
  await page.waitForTimeout(500); // a few frames of the solved state (halo swell, full trail)
  // The surrounding cosmos on the desktop: fully drawn, no mask.
  expect((await snapshot(page)).cosmos).toMatchObject({ visible: true, opacity: 1, mask: 'none' });
  await page.screenshot({ path: screenshotPath('l1-desktop.png') });

  const stats = await page.evaluate(() => window.__game!.renderStats());
  const report = { level: levels[0].id, budget: RENDER_BUDGET, ...stats };
  const out = path.resolve(test.info().config.rootDir, '..', 'test-results', 'render-stats-desktop.json');
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log('render stats (desktop)', JSON.stringify(report));

  expect(stats.autoReset).toBe(true);
  expect(stats.frames).toBeGreaterThan(30);
  expect(stats.max.calls).toBeGreaterThan(0);
  expect(stats.max.calls).toBeLessThanOrEqual(RENDER_BUDGET.maxDrawCalls);
  expect(stats.max.triangles).toBeLessThanOrEqual(RENDER_BUDGET.maxTriangles);
});

test('graphics: Low from the level panel applies on reload with the 1k textures; ?quality=low', async ({ page }) => {
  test.setTimeout(240_000);
  /** Render counts over 1.5 s of the current view. */
  const counts = async () => {
    await page.evaluate(() => window.__game!.resetRenderStats());
    await page.waitForTimeout(1500);
    const s = await page.evaluate(() => window.__game!.renderStats());
    return { calls: s.max.calls, triangles: s.max.triangles };
  };
  const texturesLoaded = async () => {
    await expect.poll(async () => (await snapshot(page)).textures.loaded.length, { timeout: 30_000 }).toBe(4);
    return (await snapshot(page)).textures;
  };
  await openGame(page);
  const high = await snapshot(page);
  expect(high.graphics).toMatchObject({ tier: 'high', source: 'default', saved: 'high' });
  expect(high.graphics.profile).toMatchObject({ textureSize: 2048, starCount: 6000, glints: true, dustMotes: 300, gridSegments: 96, asteroids: 160 });
  const highTextures = await texturesLoaded();
  expect([...highTextures.requested].sort()).toEqual(['tex-milky-way-2k', 'tex-planets-2k', 'tex-saturn-2k', 'tex-saturn-ring']);
  const highCounts = await counts();

  // The Graphics button beside Settings saves Low; the running page stays High until a reload.
  await clickUi(page, 'levels-button');
  await expect.poll(async () => (await snapshot(page)).levelSelect.open, { timeout: 5_000 }).toBe(true);
  await page.waitForTimeout(400);
  await clickUi(page, 'graphics-button');
  await expect.poll(async () => (await snapshot(page)).graphics.saved, { timeout: 5_000 }).toBe('low');
  expect(await page.evaluate(() => localStorage.getItem('orbit-puzzle.graphics'))).toBe('low');
  expect((await snapshot(page)).graphics.tier).toBe('high');
  await page.waitForTimeout(300);
  await page.screenshot({ path: screenshotPath('desktop-graphics-button.png') });

  await page.reload();
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60_000 });
  const low = await snapshot(page);
  expect(low.save.problem).toBeNull();
  expect(low.graphics).toMatchObject({ tier: 'low', source: 'setting', saved: 'low' });
  expect(low.graphics.profile).toMatchObject({ textureSize: 1024, starCount: 2500, glints: false, dustMotes: 0, gridSegments: 48, asteroids: 60 });
  // The vendored -1k maps are the ones requested and loaded (same origin), no -2k.
  const lowTextures = await texturesLoaded();
  expect([...lowTextures.requested].sort()).toEqual(['tex-milky-way-1k', 'tex-planets-1k', 'tex-saturn-1k', 'tex-saturn-ring']);
  expect(lowTextures.failed).toEqual([]);
  const urls = await page.evaluate(() => window.__game!.resourceUrls());
  expect(urls.filter((u) => u.endsWith('-1k.webp')).length).toBe(3);
  expect(urls.filter((u) => u.endsWith('-2k.webp'))).toEqual([]);
  const lowCounts = await counts();
  console.log('graphics desktop counts', JSON.stringify({ high: highCounts, low: lowCounts }));
  expect(lowCounts.triangles).toBeLessThan(highCounts.triangles);
  expect(lowCounts.calls).toBeLessThan(highCounts.calls);
  await page.screenshot({ path: screenshotPath('desktop-graphics-low.png') });

  // Back to High (saved), then ?quality=low overrides the saved High for one load.
  await clickUi(page, 'levels-button');
  await expect.poll(async () => (await snapshot(page)).levelSelect.open, { timeout: 5_000 }).toBe(true);
  await page.waitForTimeout(400);
  await clickUi(page, 'graphics-button');
  await expect.poll(async () => (await snapshot(page)).graphics.saved, { timeout: 5_000 }).toBe('high');
  await page.goto('/?quality=low');
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60_000 });
  expect((await snapshot(page)).graphics).toMatchObject({ tier: 'low', source: 'url', saved: 'high' });
  await page.goto('/');
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60_000 });
  expect((await snapshot(page)).graphics).toMatchObject({ tier: 'high', source: 'setting', saved: 'high' });
});

test('release off the board snaps back without launching', async ({ page }) => {
  await openGame(page);
  await page.evaluate(() => window.__game!.loadLevel(0));
  const before = await snapshot(page);
  const body = before.bodies.find((b) => b.movable)!;

  await dragBody(page, body.id, { x: 40, y: 790 });
  await expect.poll(async () => (await snapshot(page)).bodies.find((b) => b.id === body.id)!.held).toBe(false);

  const after = await snapshot(page);
  const moved = after.bodies.find((b) => b.id === body.id)!;
  expect(after.attempts).toBe(before.attempts);
  expect(after.phase).toBe('placing');
  expect(after.placements).toEqual(before.placements);
  expect(Math.hypot(moved.board[0] - body.board[0], moved.board[2] - body.board[2])).toBeLessThan(1e-6);
});

test('Launch button replays', async ({ page }) => {
  await openGame(page);
  await page.evaluate(() => window.__game!.loadLevel(0));
  const levels = await page.evaluate(() => window.__game!.levels());
  for (const [id, p] of Object.entries(levels[0].solution)) await dragBody(page, id, p);
  await expect.poll(async () => (await snapshot(page)).solved, { timeout: 30_000 }).toBe(true);
  await page.waitForTimeout(300); // let the HUD relayout with the Next button

  const button = await page.evaluate(() => window.__game!.hudScreenPoint('launch-button'));
  expect(button).not.toBeNull();
  await page.mouse.click(button!.x, button!.y);
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 5_000 }).toBe('flying');
  expect((await snapshot(page)).attempts).toBe(2);
});

test('near-rim button launches', async ({ page }) => {
  await openGame(page);
  await page.evaluate(() => window.__game!.loadLevel(0));
  await page.waitForTimeout(300); // the button is posed on the frame after it loads
  const before = await snapshot(page);
  expect(before.rimButton.ready).toBe(true);
  expect(before.rimButton.label).toBe('Launch');
  expect(before.attempts).toBe(0);

  const button = await page.evaluate(() => window.__game!.hudScreenPoint('rim-launch-button'));
  expect(button).not.toBeNull();
  // The first pointer move into a fresh page never registers; arrive with two.
  await page.mouse.move(button!.x - 2, button!.y);
  await page.mouse.move(button!.x, button!.y);
  await page.mouse.click(button!.x, button!.y);
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 5_000 }).toBe('flying');
  expect((await snapshot(page)).attempts).toBe(1);
  await expect.poll(async () => (await snapshot(page)).rimButton.label, { timeout: 5_000 }).toBe('Replay');
  await page.screenshot({ path: screenshotPath('desktop-rim-button.png') });
});

test('Your Table sandbox with the puck', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openGame(page);
  await page.evaluate(() => window.__game!.loadLevel(0));
  await page.waitForTimeout(300);

  // Level select -> Your Table.
  await clickUi(page, 'levels-button');
  await expect.poll(async () => (await snapshot(page)).levelSelect.open, { timeout: 5_000 }).toBe(true);
  await page.waitForTimeout(400); // the panel is posed on the next frames (a click before that misses)
  await clickUi(page, 'sandbox-button');
  await expect.poll(async () => (await snapshot(page)).mode, { timeout: 5_000 }).toBe('sandbox');
  await expect.poll(async () => (await snapshot(page)).sandbox.panel.shown, { timeout: 5_000 }).toBe(true);
  let snap = await snapshot(page);
  expect(snap.level.id).toBe('table-1');
  expect(snap.levelSelect.open).toBe(false);
  expect(snap.sandbox.wells).toEqual([]);

  const rimLaunch = async () => {
    await clickUi(page, 'rim-launch-button');
    await expect.poll(async () => (await snapshot(page)).phase, { timeout: 5_000 }).not.toBe('placing');
    await waitUntilNotFlying(page);
    return snapshot(page);
  };
  // A flight with no wells.
  const plain = await rimLaunch();
  expect(plain.lastPathHash).not.toBeNull();

  // Add a puck (at the board center), drag it with the mouse, then raise it twice.
  await clickUi(page, 'add-puck');
  await expect.poll(async () => (await snapshot(page)).sandbox.pucks, { timeout: 5_000 }).toBe(1);
  snap = await snapshot(page);
  const puck = snap.sandbox.wells[0];
  expect(puck.kind).toBe('puck');
  expect(puck.source).toBe('well-puck');
  expect(snap.sandbox.activeWells).toBe(1);
  const from = await screenPoint(page, puck.position);
  const goal = [-0.3, 0, -0.15];
  const to = await screenPoint(page, goal);
  await page.mouse.move(from.x - 2, from.y);
  await page.mouse.move(from.x, from.y);
  await expect.poll(async () => (await snapshot(page)).sandbox.wells[0].hovered, { timeout: 10_000 }).toBe(true);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 15 });
  await expect.poll(async () => (await snapshot(page)).sandbox.wells[0].held, { timeout: 10_000 }).toBe(true);
  await page.mouse.up();
  await expect.poll(async () => (await snapshot(page)).sandbox.wells[0].held, { timeout: 10_000 }).toBe(false);
  snap = await snapshot(page);
  const moved = snap.sandbox.wells[0].position;
  expect(Math.hypot(moved[0] - goal[0], moved[2] - goal[2])).toBeLessThan(0.05);
  expect(moved[1]).toBe(0);
  expect(snap.attempts).toBe(plain.attempts); // dragging a puck never launches

  const heightBefore = snap.sandbox.wells[0].heightM;
  await clickUi(page, 'height-up');
  await expect.poll(async () => (await snapshot(page)).sandbox.wells[0].heightM, { timeout: 5_000 }).toBeCloseTo(heightBefore + 0.01, 6);
  snap = await snapshot(page);
  expect(snap.sandbox.wells[0].mass).toBeGreaterThan(puck.mass);

  const withPuck = await rimLaunch();
  expect(withPuck.lastPathHash).not.toBe(plain.lastPathHash);
  expect(withPuck.attempts).toBe(plain.attempts + 1);
  await page.screenshot({ path: screenshotPath('desktop-sandbox-puck.png') });

  await clickUi(page, 'clear-wells');
  await expect.poll(async () => (await snapshot(page)).sandbox.wells.length, { timeout: 5_000 }).toBe(0);
  snap = await snapshot(page);
  expect(snap.sandbox.pucks).toBe(0);
  expect(snap.sandbox.activeWells).toBe(0);

  // Back to the story: level 1 still solves.
  await clickUi(page, 'exit-sandbox');
  await expect.poll(async () => (await snapshot(page)).mode, { timeout: 5_000 }).toBe('story');
  await expect.poll(async () => (await snapshot(page)).levelBuilt, { timeout: 5_000 }).toBe(true);
  expect((await snapshot(page)).level.id).toBe('c1-l1');
  expect((await snapshot(page)).sandbox.panel.shown).toBe(false);
  const levels = await page.evaluate(() => window.__game!.levels());
  const solved = await solveWith(page, levels[0].solution);
  expect(solved.level.id).toBe('c1-l1');
  expect(solved.stars.last).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('debug overlay with ?debug=1', async ({ page }) => {
  const info: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'info') info.push(m.text());
  });
  await page.goto('/?debug=1');
  // World.create can take over 5 s under SwiftShader load; the overlay is
  // registered right after it, before the debug API reports ready.
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 60_000 });
  await expect(page.locator('#debug-overlay')).toContainText('fps', { timeout: 5_000 });
  // The 2 Hz refresh writes real numbers and the render counts.
  await expect(page.locator('#debug-overlay')).toContainText(/fps (?!0\.0 )\d+\.\d avg \| 1% low \d+\.\d/, { timeout: 30_000 });
  await expect(page.locator('#debug-overlay')).toContainText(/calls \d+ \| tris \d+k/);
  // One JSON line every 5 s for testers to paste.
  await expect
    .poll(() => info.find((t) => t.startsWith('{"fps":')) ?? null, { timeout: 20_000 })
    .not.toBeNull();
  const line = JSON.parse(info.find((t) => t.startsWith('{"fps":'))!) as Record<string, unknown>;
  expect(Object.keys(line)).toEqual(['fps', 'low1', 'calls', 'triangles', 'hitHeightCm', 'jitterMm']);
  await page.screenshot({ path: screenshotPath('desktop-debug-overlay.png') });

  await openGame(page);
  await page.waitForTimeout(1000);
  await expect(page.locator('#debug-overlay')).toHaveCount(0);
});

test('makes no external requests', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));

  await openGame(page);
  await page.evaluate(() => window.__game!.loadLevel(0));
  const levels = await page.evaluate(() => window.__game!.levels());
  for (const [id, p] of Object.entries(levels[0].solution)) await dragBody(page, id, p);
  await expect.poll(async () => (await snapshot(page)).solved, { timeout: 30_000 }).toBe(true);

  expect(urls.length).toBeGreaterThan(0);
  const external = urls.filter(
    (u) => !u.startsWith(`${origin}/`) && !u.startsWith('data:') && !u.startsWith('blob:'),
  );
  expect(external).toEqual([]);
});
