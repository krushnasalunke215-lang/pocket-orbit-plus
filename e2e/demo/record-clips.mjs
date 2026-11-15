// Backup trailer clips (VIDEO.md, silent): records each director-mode shot
// (?demo=1&shot=N&autostart=1) as a 1280x720 Playwright video into
// .agents/tasks/video-clips/shot-N-<name>.webm, then decodes one frame of
// each clip (at the shot's key moment) to shot-N-<name>.png beside it for
// review. The dev server runs without the managed browser (dev up
// --no-open), so Playwright's Chromium is the only browser; it runs headed
// so WebGL uses the GPU. Shot 6 switches iwsdk.config.json to metaVRGlasses
// and back. The server is always stopped.
// Usage: npm run demo:clips
//        node e2e/demo/record-clips.mjs --only=2,6
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { call, root, run, sleep } from '../iwer/cli.mjs';
import { restoreEmulatorDevice, setEmulatorDevice, waitFor } from '../iwer/xr-helpers.mjs';

const CLIPS = path.join(root, '.agents', 'tasks', 'video-clips');
const TMP = path.join(CLIPS, '.tmp');
const BASE = 'https://localhost:8081/';
const SIZE = { width: 1280, height: 720 };
const NAMES = { 0: 'dissolve', 1: 'hook', 2: 'level-1', 3: 'levels-4-6', 4: 'chapter-complete', 5: 'your-table', 6: 'glasses', 7: 'accessibility' };
const ORDER = [0, 1, 2, 3, 4, 5, 7, 6];

const only = process.argv.find((a) => a.startsWith('--only='));
const wanted = only ? only.slice('--only='.length).split(',').map(Number) : ORDER;
if (wanted.some((n) => !NAMES[n])) throw new Error(`shots are 0-7, got ${only}`);

/** Loads the plain page until IWER reports `device` (after a config switch Vite restarts). */
async function waitForDevice(browser, device) {
  const page = await browser.newPage({ ignoreHTTPSErrors: true });
  try {
    return await waitFor(`IWER as ${device}`, async () => {
      await page.goto(BASE, { waitUntil: 'load', timeout: 60_000 });
      const name = await page.waitForFunction(() => window.IWER_DEVICE?.name, null, { timeout: 30_000 }).then((h) => h.jsonValue());
      return name === device ? name : null;
    }, 240_000, 3000);
  } finally {
    await page.close();
  }
}

async function record(browser, n) {
  const context = await browser.newContext({ viewport: SIZE, ignoreHTTPSErrors: true, recordVideo: { dir: TMP, size: SIZE } });
  const page = await context.newPage();
  const pageAt = Date.now();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  const gotoAt = Date.now();
  await page.goto(`${BASE}?demo=1&shot=${n}&autostart=1`, { waitUntil: 'load', timeout: 120_000 });
  const demo = await waitFor(`shot ${n} to end`, async () => {
    const d = await page.evaluate(() => (window.__demo ? JSON.parse(JSON.stringify(window.__demo)) : null));
    return d && (d.state === 'done' || d.state === 'error') ? d : null;
  }, 300_000, 1000);
  await sleep(1000);
  const video = page.video();
  await context.close();
  const file = path.join(CLIPS, `shot-${n}-${NAMES[n]}.webm`);
  rmSync(file, { force: true });
  renameSync(await video.path(), file);
  const result = demo.results.find((r) => r.id === n) ?? null;
  // performance.now() counts from the navigation; the video from the page's creation.
  const keySeconds = result?.keyAt ? (gotoAt - pageAt + result.keyAt) / 1000 : null;
  return { shot: n, file, state: demo.state, error: demo.error, warnings: demo.warnings, seconds: result ? result.ms / 1000 : null, keySeconds, consoleErrors: errors };
}

/** Decodes the clip in the browser and saves the frame at `seconds` as a PNG. */
async function saveFrame(browser, file, seconds, out) {
  const page = await browser.newPage();
  try {
    const b64 = readFileSync(file).toString('base64');
    const frame = await page.evaluate(async ({ b64, seconds }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const video = document.createElement('video');
      video.muted = true;
      video.src = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }));
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve;
        video.onerror = () => reject(new Error('the clip did not decode'));
      });
      try {
        video.currentTime = seconds;
        await new Promise((resolve, reject) => {
          const id = setTimeout(() => reject(new Error('seek timed out')), 8000);
          video.onseeked = () => {
            clearTimeout(id);
            resolve();
          };
        });
      } catch {
        // A recording without cues: play up to the time instead.
        video.playbackRate = 8;
        await video.play();
        await new Promise((resolve) => {
          const tick = () => (video.currentTime >= seconds || video.ended ? resolve() : setTimeout(tick, 10));
          tick();
        });
        video.pause();
      }
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      return { url: canvas.toDataURL('image/png'), at: video.currentTime, width: video.videoWidth, height: video.videoHeight, duration: video.duration };
    }, { b64, seconds });
    writeFileSync(out, Buffer.from(frame.url.split(',')[1], 'base64'));
    return { frame: out, at: Number(frame.at.toFixed(2)), width: frame.width, height: frame.height, duration: Number.isFinite(frame.duration) ? Number(frame.duration.toFixed(2)) : null };
  } finally {
    await page.close();
  }
}

/** The first Vite of a restarted runtime can outlive `dev down` (no port); stop it. */
function stopOrphanVite() {
  const script = [
    `$root = '${root.replaceAll("'", "''").toLowerCase()}'`,
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" |",
    "  Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains($root) -and $_.CommandLine -match 'vite[\\\\/]bin[\\\\/]vite\\.js' } |",
    '  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }',
  ].join('\n');
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 60_000 }).split(/\s+/).filter(Boolean).map(Number);
  } catch (error) {
    return [`failed: ${String(error?.message ?? error).slice(0, 200)}`];
  }
}

const summary = { ok: false, clips: [], error: null };
let browser = null;
let exitCode = 1;
try {
  mkdirSync(TMP, { recursive: true });
  if (call(['dev', 'status']).state?.running) call(['dev', 'down'], { timeoutMs: 60_000 });
  // Right after a previous `dev down` (or under memory pressure) the start
  // can time out; retry like verify-iwer.
  for (let attempt = 1; ; attempt++) {
    try {
      call(['dev', 'up', '--no-open', '--timeout', '120000'], { timeoutMs: 240_000 });
      break;
    } catch (error) {
      if (run(['dev', 'status']).data?.state?.running) break;
      if (attempt >= 3) throw error;
      console.log(`dev up failed (attempt ${attempt}), retrying in 10 s`);
      await sleep(10_000);
    }
  }
  browser = await chromium.launch({
    headless: false,
    args: [
      '--ignore-certificate-errors',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--window-size=1300,860',
    ],
  });
  const questDevice = await waitForDevice(browser, 'Meta Quest 3');
  for (const n of ORDER.filter((s) => wanted.includes(s))) {
    if (n === 6) {
      setEmulatorDevice('metaVRGlasses');
      await sleep(4000);
      await waitForDevice(browser, 'Meta VR Glasses');
    }
    const clip = await record(browser, n);
    const seconds = clip.keySeconds ?? (clip.seconds ? clip.seconds * 0.6 : 5);
    Object.assign(clip, await saveFrame(browser, clip.file, seconds, clip.file.replace(/\.webm$/, '.png')).catch((e) => ({ frameError: String(e?.message ?? e) })));
    clip.ok = clip.state === 'done' && clip.consoleErrors.length === 0 && Boolean(clip.frame);
    console.log(`${clip.ok ? 'PASS' : 'FAIL'} clip ${n} ${JSON.stringify(clip)}`);
    summary.clips.push(clip);
    if (n === 6) {
      restoreEmulatorDevice();
      await sleep(4000);
      await waitForDevice(browser, questDevice);
    }
  }
  summary.ok = summary.clips.length === wanted.length && summary.clips.every((c) => c.ok);
  exitCode = summary.ok ? 0 : 1;
} catch (error) {
  summary.error = String(error?.stack ?? error);
  console.error(error);
} finally {
  if (browser) await browser.close().catch(() => null);
  if (restoreEmulatorDevice()) console.log('restored dev.emulator.device in iwsdk.config.json');
  rmSync(TMP, { recursive: true, force: true });
  try {
    run(['dev', 'down'], { timeoutMs: 60_000 });
  } catch (error) {
    console.error('dev down failed', error);
  }
  summary.runtimeStopped = !run(['dev', 'status']).data?.state?.running;
  summary.orphanViteStopped = stopOrphanVite();
  if (!summary.runtimeStopped) exitCode = 1;
  writeFileSync(path.join(CLIPS, 'clips-summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ok: summary.ok && exitCode === 0, clips: summary.clips.map((c) => ({ shot: c.shot, ok: c.ok, seconds: c.seconds, frame: c.frame })), runtimeStopped: summary.runtimeStopped, error: summary.error }, null, 2));
  process.exit(exitCode);
}
