// GitHub Pages base-path smoke test. Run after `npm run build:pages`
// (dist built with --base=/pocket-orbit-plus/):
//   npm run build:pages && npm run smoke:pages
// Serves dist with `vite preview` under the same base on https://localhost:4173
// (the IWSDK dev certificate, like preview:e2e), opens the game and the
// ?debug=1 overlay in headless Chromium (SwiftShader, as playwright.config.ts)
// and fails on any page error, console error, response >= 400 or request
// outside the origin (data: and blob: allowed). Then fetches the vendored
// hand models, their LICENSE and every public/ui/*.uikitml under the base.
// The preview server is always stopped and port 4173 must be free afterwards.
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, request } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = '/pocket-orbit-plus/';
const PORT = 4173;
const ORIGIN = `https://localhost:${PORT}`;
const SITE = `${ORIGIN}${BASE}`;
const SWIFTSHADER = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
/** Vendored @webxr-input-profiles/assets 1.0.20 generic-hand models (byte sizes). */
const VENDOR = 'vendor/webxr-input-profiles/generic-hand/';
const EXPECTED_BYTES = { 'left.glb': 94_572, 'right.glb': 94_004 };
/** The package LICENSE sits one level above generic-hand/ (public/vendor/webxr-input-profiles/). */
const LICENSE = 'vendor/webxr-input-profiles/LICENSE.md';
const LICENSE_TEXT = ['MIT License', 'Copyright (c) 2019 Amazon'];
/** vite preview answers a missing file with index.html and status 200 (SPA fallback). */
const looksLikeIndexHtml = (text) => /^\s*<!doctype html/i.test(text);

const failures = [];
const results = { pages: [], assets: [] };
const fail = (message) => {
  failures.push(message);
  console.log(`FAIL ${message}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

function startPreview() {
  const vite = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [vite, 'preview', `--base=${BASE}`, '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  return { child, output: () => output };
}

function stopPreview(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

async function waitForSite(api, timeoutMs) {
  const started = Date.now();
  for (;;) {
    try {
      const r = await api.get(SITE);
      if (r.status() === 200) return;
    } catch {
      // not up yet
    }
    if (Date.now() - started > timeoutMs) throw new Error(`preview did not serve ${SITE} within ${timeoutMs} ms`);
    await sleep(500);
  }
}

async function checkPage(browser, url, { debug }) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const record = { url, requests: 0, external: [], bad: [], pageErrors: [], consoleErrors: [], hudLoaded: false, overlay: null };
  page.on('request', (r) => {
    record.requests++;
    const u = r.url();
    if (!u.startsWith(`${ORIGIN}/`) && !u.startsWith('data:') && !u.startsWith('blob:')) record.external.push(u);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) record.bad.push(`${r.status()} ${r.url()}`);
    if (r.url() === `${SITE}ui/hud.uikitml` && r.status() === 200) record.hudLoaded = true;
  });
  page.on('pageerror', (e) => record.pageErrors.push(String(e?.message ?? e)));
  page.on('console', (m) => {
    if (m.type() === 'error') record.consoleErrors.push(m.text());
  });

  await page.goto(url);
  await page.waitForSelector('canvas', { timeout: 60_000 });
  const hudStart = Date.now();
  while (!record.hudLoaded && Date.now() - hudStart < 60_000) await sleep(250);
  if (debug) {
    await page.waitForFunction(
      () => /fps (?!0\.0 )\d+\.\d avg[^]*calls \d+ \| tris \d+k/.test(document.getElementById('debug-overlay')?.textContent ?? ''),
      null,
      { timeout: 60_000 },
    );
    record.overlay = await page.evaluate(() => document.getElementById('debug-overlay')?.textContent ?? null);
  } else {
    record.overlay = await page.evaluate(() => document.getElementById('debug-overlay')?.textContent ?? null);
  }
  // Let the first frames and panel loads settle, then judge the page.
  await sleep(4000);
  await context.close();

  if (!record.hudLoaded) fail(`${url}: ui/hud.uikitml was not loaded under the base path`);
  if (record.pageErrors.length) fail(`${url}: page errors ${JSON.stringify(record.pageErrors)}`);
  if (record.consoleErrors.length) fail(`${url}: console errors ${JSON.stringify(record.consoleErrors)}`);
  if (record.bad.length) fail(`${url}: responses >= 400 ${JSON.stringify(record.bad)}`);
  if (record.external.length) fail(`${url}: requests outside ${ORIGIN} ${JSON.stringify(record.external)}`);
  if (debug && !/fps \d+\.\d avg/.test(record.overlay ?? '')) fail(`${url}: debug overlay missing fps (${record.overlay})`);
  if (!debug && record.overlay !== null) fail(`${url}: debug overlay shown without ?debug=1`);
  results.pages.push(record);
}

async function checkAssets(api) {
  const ui = readdirSync(path.join(ROOT, 'public', 'ui')).filter((f) => f.endsWith('.uikitml'));
  const files = [...Object.keys(EXPECTED_BYTES).map((f) => VENDOR + f), LICENSE, ...ui.map((f) => `ui/${f}`)];
  for (const file of files) {
    const url = `${SITE}${file}`;
    const r = await api.get(url);
    const body = await r.body();
    const bytes = body.length;
    const name = path.posix.basename(file);
    const expected = file.startsWith(VENDOR) ? EXPECTED_BYTES[name] : undefined;
    const text = file.endsWith('.glb') ? '' : body.toString('utf8');
    results.assets.push({ file, status: r.status(), bytes, expected: expected ?? null });
    if (r.status() !== 200) fail(`${url}: status ${r.status()}`);
    else if (looksLikeIndexHtml(text)) fail(`${url}: served index.html (file missing under the base path)`);
    else if (expected !== undefined && bytes !== expected) fail(`${url}: ${bytes} bytes, expected ${expected}`);
    else if (bytes === 0) fail(`${url}: empty`);
    else if (file === LICENSE && !LICENSE_TEXT.every((t) => text.includes(t))) fail(`${url}: not the MIT license text`);
  }
}

let preview = null;
let browser = null;
let api = null;
let exitCode = 1;
try {
  const dist = path.join(ROOT, 'dist', 'index.html');
  try {
    statSync(dist);
  } catch {
    throw new Error('dist/index.html is missing: run `npm run build:pages` first');
  }
  if (await portOpen(PORT)) throw new Error(`port ${PORT} is already in use`);
  preview = startPreview();
  api = await request.newContext({ ignoreHTTPSErrors: true });
  await waitForSite(api, 60_000).catch((error) => {
    throw new Error(`${error.message}\n${preview.output()}`);
  });
  browser = await chromium.launch({ headless: true, args: SWIFTSHADER });
  await checkPage(browser, SITE, { debug: false });
  await checkPage(browser, `${SITE}?debug=1`, { debug: true });
  await checkAssets(api);
  exitCode = failures.length === 0 ? 0 : 1;
} catch (error) {
  fail(String(error?.stack ?? error));
} finally {
  await browser?.close().catch(() => null);
  await api?.dispose().catch(() => null);
  stopPreview(preview?.child);
  let free = false;
  for (let i = 0; i < 20 && !free; i++) {
    free = !(await portOpen(PORT));
    if (!free) await sleep(500);
  }
  if (!free) {
    fail(`port ${PORT} is still in use after stopping the preview`);
    exitCode = 1;
  }
  const summary = {
    ok: exitCode === 0,
    site: SITE,
    failures,
    pages: results.pages.map((p) => ({
      url: p.url,
      requests: p.requests,
      external: p.external.length,
      bad: p.bad.length,
      pageErrors: p.pageErrors.length,
      consoleErrors: p.consoleErrors.length,
      hudLoaded: p.hudLoaded,
      overlay: p.overlay,
    })),
    assets: results.assets,
    portFree: free,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exit(exitCode);
}
