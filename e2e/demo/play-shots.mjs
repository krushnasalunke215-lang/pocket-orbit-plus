// Director mode check (VIDEO.md): plays every shot, ?demo=1&shot=1 to
// shot=7 with autostart=1, to its end in a headed IWER managed session, and
// fails on a director error or a console error. Shot 6 switches the
// emulator to metaVRGlasses (iwsdk.config.json; Vite restarts in place) and
// back. A frame of each shot (at its key moment) goes to
// .agents/tasks/screenshots/cosmos-real/demo-shot-N.png; the summary to
// test-results/demo-shots-summary.json. The runtime is always stopped.
// Usage: npm run demo:shots
//        node e2e/demo/play-shots.mjs --only=1,6
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { call, root, run, sleep } from '../iwer/cli.mjs';
import { RESULTS, SHOTS, restoreEmulatorDevice, setEmulatorDevice, waitFor } from '../iwer/xr-helpers.mjs';

const ALL = [0, 1, 2, 3, 4, 5, 6, 7];
const REQUEST = path.join(root, 'e2e', 'demo', '.request.json');

const only = process.argv.find((a) => a.startsWith('--only='));
const wanted = only ? only.slice('--only='.length).split(',').map(Number) : ALL;
if (wanted.some((n) => !ALL.includes(n))) throw new Error(`shots are 0-7, got ${only}`);

function frameCall(action, search) {
  writeFileSync(REQUEST, JSON.stringify({ action, search }));
  return call(['browser', 'run', 'e2e/demo/read-demo.mjs', '--timeout', '30000']).result;
}
const read = () => frameCall('read');

async function navigate(search) {
  frameCall('navigate', search);
  await sleep(2500);
  return waitFor(`the page at "${search}"`, () => {
    const r = read();
    return r.search === search && r.ready ? r : null;
  }, 120_000, 1000);
}

/** The first array in a CLI reply (the log list's key is not part of the documented shape). */
function firstArray(value, depth = 0) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object' || depth > 4) return null;
  for (const v of Object.values(value)) {
    const found = firstArray(v, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Console errors since `since` (ms since epoch). */
function consoleErrors(since) {
  const data = call(['browser', 'logs'], { input: { count: 200, level: 'error', since } });
  const list = firstArray(data) ?? [];
  return list
    .filter((e) => !e || typeof e !== 'object' || (e.level ?? e.type ?? 'error') === 'error')
    .map((e) => String(e?.text ?? e?.message ?? JSON.stringify(e)).slice(0, 300));
}

async function playShot(n) {
  const search = `?demo=1&shot=${n}&autostart=1`;
  const since = Date.now();
  frameCall('front');
  await navigate(search);
  let frame = null;
  let hiddenPolls = 0;
  const demo = await waitFor(`shot ${n} to end`, () => {
    const r = read();
    if (r.visibility === 'hidden') {
      // The window was covered or minimized: the shot cannot run hidden.
      hiddenPolls++;
      frameCall('front');
    }
    const d = r.demo;
    if (d?.state === 'running' && d.keyAt && !frame) {
      frame = path.join(SHOTS, `demo-shot-${n}.png`);
      call(['browser', 'screenshot', '--output-file', frame]);
    }
    return d && (d.state === 'done' || d.state === 'error') ? d : null;
  }, 300_000, 1000);
  const errors = consoleErrors(since);
  const result = demo.results.find((r) => r.id === n) ?? null;
  const ok = demo.state === 'done' && Boolean(result) && errors.length === 0;
  const line = { shot: n, ok, state: demo.state, seconds: result ? result.ms / 1000 : null, target: result?.targetSeconds ?? null, device: demo.device, error: demo.error, warnings: demo.warnings, consoleErrors: errors, hiddenPolls, frame };
  console.log(`${ok ? 'PASS' : 'FAIL'} shot ${n} ${JSON.stringify(line)}`);
  return line;
}

/** After an iwsdk.config.json edit: the restarted runtime, a built page and IWER as `device`. */
async function waitForRestart(device) {
  await sleep(4000);
  await waitFor('browserCommandReady after the restart', () => call(['dev', 'status']).state?.browserCommandReady, 240_000, 1000);
  return waitFor(`the page with IWER as ${device}`, () => {
    const r = read();
    return r.ready && r.device === device ? r : null;
  }, 240_000, 1000);
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

const summary = { ok: false, shots: [], error: null };
let exitCode = 1;
try {
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(RESULTS, { recursive: true });
  if (call(['dev', 'status']).state?.running) call(['dev', 'down'], { timeoutMs: 60_000 });
  // Headed: the managed Chromium window is visible, as when recording.
  for (let attempt = 1; ; attempt++) {
    try {
      call(['dev', 'up', '--ai-mode', 'collaborate', '--allow-browser-automation'], { timeoutMs: 180_000 });
      break;
    } catch (error) {
      const state = run(['dev', 'status']).data?.state;
      if (state?.running || state?.starting) break;
      if (attempt >= 3) throw error;
      await sleep(10_000);
    }
  }
  await waitFor('browserCommandReady', () => call(['dev', 'status']).state?.browserCommandReady, 120_000, 1000);
  try {
    call(['workspace', 'set-view'], { input: { view: 'runtime' } });
  } catch {
    // already the runtime view
  }
  const first = await waitFor('window.__game ready', () => (read().ready ? read() : null), 120_000, 1000);
  summary.questDevice = first.device;

  for (const n of wanted.filter((s) => s !== 6)) summary.shots.push(await playShot(n));
  if (wanted.includes(6)) {
    await navigate('');
    setEmulatorDevice('metaVRGlasses');
    await waitForRestart('Meta VR Glasses');
    summary.shots.push(await playShot(6));
    // Plain URL first, so the reload after restoring starts no shot.
    await navigate('');
    restoreEmulatorDevice();
    await waitForRestart(summary.questDevice);
  }
  summary.ok = summary.shots.length === wanted.length && summary.shots.every((s) => s.ok);
  exitCode = summary.ok ? 0 : 1;
} catch (error) {
  summary.error = String(error?.stack ?? error);
  console.error(error);
} finally {
  if (restoreEmulatorDevice()) console.log('restored dev.emulator.device in iwsdk.config.json');
  try {
    run(['xr', 'exit'], { input: {} });
  } catch {
    // no session or no runtime
  }
  let stillRunning = true;
  for (let attempt = 1; attempt <= 2 && stillRunning; attempt++) {
    try {
      run(['dev', 'down'], { timeoutMs: 60_000 });
    } catch (error) {
      console.error(`dev down failed (attempt ${attempt})`, error);
    }
    try {
      stillRunning = Boolean(run(['dev', 'status']).data?.state?.running);
    } catch {
      stillRunning = true;
    }
    if (stillRunning && attempt < 2) await sleep(5000);
  }
  summary.runtimeStopped = !stillRunning;
  summary.orphanViteStopped = stopOrphanVite();
  if (stillRunning) exitCode = 1;
  writeFileSync(path.join(RESULTS, 'demo-shots-summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ok: summary.ok && exitCode === 0, shots: summary.shots.map((s) => ({ shot: s.shot, ok: s.ok, seconds: s.seconds })), runtimeStopped: summary.runtimeStopped, error: summary.error }, null, 2));
  process.exit(exitCode);
}
