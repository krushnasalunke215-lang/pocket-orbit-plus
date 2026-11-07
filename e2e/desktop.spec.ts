import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { AudioEngineState } from '../src/audio/engine';
import { RENDER_BUDGET } from '../src/config';
import type { GameSnapshot, ScreenPoint } from '../src/debug/debug-api';
import type { Placements } from '../src/sim/level';

/*
 * Desktop mouse play through the dev/e2e debug API (window.__game): the
 * mouse drags planets with the same built-in ray / distance grab that XR
 * hands use, and the snapshot reports what the game saw.
 */

function screenshotPath(name: string): string {
  const dir = path.resolve(test.info().config.rootDir, '..', '.agents', 'tasks', 'screenshots', 'phase2');
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
  await expect.poll(async () => (await snapshot(page)).phase, { timeout: 30_000 }).not.toBe('flying');
}

/** Drags a body from where it is to a board point (or to a raw screen point). */
async function dragBody(page: Page, bodyId: string, to: readonly number[] | ScreenPoint): Promise<void> {
  const before = await snapshot(page);
  const index = before.bodies.findIndex((b) => b.id === bodyId);
  expect(index, `body ${bodyId}`).toBeGreaterThanOrEqual(0);
  const from = await screenPoint(page, before.bodies[index].board);
  const target = 'x' in to ? to : await screenPoint(page, to);

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
  // Eight drags and about 35 s of flights at SwiftShader's 6-8 fps.
  test.setTimeout(300_000);
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
