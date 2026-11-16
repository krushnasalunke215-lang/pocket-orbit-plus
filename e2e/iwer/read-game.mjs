// `iwsdk browser run` script: evaluates one whitelisted window.__game call in
// the app frame (the app may run inside the workspace iframe) and returns its
// JSON result as { value, perfNow, origin }. The driver writes the call to e2e/iwer/.request.json as
// { "method": "snapshot", "args": [] }.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const METHODS = new Set([
  'snapshot',
  'levels',
  'loadLevel',
  'launch',
  'setPlacements',
  'sandbox.enter',
  'sandbox.exit',
  'sandbox.arm',
  'sandbox.disarm',
  'sandbox.addPuck',
  'sandbox.stepHeight',
  'sandbox.clear',
  'occlusion',
  'setOcclusion',
  'placeBoard',
  'replayCosmosFade',
  'enterVR',
  'renderStats',
  'resetRenderStats',
  'spike.enabledFeatures',
  'spike.planes',
  'spike.meshes',
  'spike.hitTestFromViewer',
  'resourceUrls',
  'watchLaunch.start',
  'watchLaunch.read',
  'iwer.setPrimaryInputMode',
  'iwer.setVisibility',
  'saveNow',
  'clearSave',
  'resetOnboarding',
  'uiWorldPoint',
  'panelCorners',
  'hold.atFraction',
  'hold.ghost',
  'hold.read',
  'hold.release',
  'audio.state',
  'audio.events',
  'audio.expectedNotes',
  'audio.setSettings',
  'audio.renderOffline',
  'page.setSearch',
  'page.search',
  'page.debugOverlayText',
  'cosmos.traceStart',
  'cosmos.traceRead',
  'flightStats.start',
  'flightStats.read',
]);

export default async function run({ frame, page, workspaceRoot }) {
  const file = path.join(workspaceRoot, 'e2e', 'iwer', '.request.json');
  const { method, args = [] } = JSON.parse(readFileSync(file, 'utf8'));
  if (!METHODS.has(method)) throw new Error(`method not allowed: ${method}`);
  const target = frame ?? page;
  return target.evaluate(
    async ({ method, args }) => {
      const game = window.__game;
      if (!game) return { error: 'window.__game is not installed' };
      if (!game.ready) return { error: 'window.__game is not ready' };
      // Launch watcher: page timers note the page clock when attempts goes up
      // (timers keep running during XR, unlike window rAF).
      if (method === 'watchLaunch.start') {
        const watch = { base: game.snapshot().attempts, launchedAt: null };
        window.__iwerLaunchWatch = watch;
        const id = setInterval(() => {
          if (game.snapshot().attempts > watch.base) {
            watch.launchedAt = performance.now();
            clearInterval(id);
          }
        }, 4);
        setTimeout(() => clearInterval(id), 30_000);
        return { value: { base: watch.base }, perfNow: performance.now() };
      }
      // Page URL and the ?debug=1 overlay's DOM text. setSearch navigates
      // after this call returns (a timer), so the evaluate is not cut off.
      if (method === 'page.setSearch') {
        const search = String(args[0] ?? '');
        setTimeout(() => {
          location.search = search;
        }, 50);
        return { value: { from: location.search, to: search }, perfNow: performance.now() };
      }
      if (method === 'page.search') return { value: location.search, perfNow: performance.now() };
      if (method === 'page.debugOverlayText') {
        const el = document.getElementById('debug-overlay');
        return { value: el ? { text: el.textContent, display: el.style.display } : null, perfNow: performance.now() };
      }
      // Cosmos fade trace: page timers sample the session mode and the AR
      // fade every 100 ms for args[0] ms (timers keep running during XR).
      if (method === 'cosmos.traceStart') {
        const trace = { samples: [] };
        window.__iwerCosmosTrace = trace;
        const started = performance.now();
        const id = setInterval(() => {
          const s = game.snapshot();
          trace.samples.push({ t: performance.now(), mode: s.session.mode, visibility: s.session.visibility, fade: s.cosmos?.fade ?? null, opacity: s.cosmos?.opacity ?? null });
          if (performance.now() - started > (args[0] ?? 8000)) clearInterval(id);
        }, 100);
        return { value: { started }, perfNow: performance.now() };
      }
      if (method === 'cosmos.traceRead') {
        return { value: window.__iwerCosmosTrace ?? null, perfNow: performance.now() };
      }
      // Render stats of a flight in progress: page timers reset the stats
      // once the next flight passes args[0] of its duration, then keep the
      // stats of the last tick that still saw phase 'flying', for at most
      // args[1] ms (the driver's CLI round trips are far too slow for this).
      if (method === 'flightStats.start') {
        const [fraction, ms] = args;
        const watch = { fraction, ms, started: null, at: null, stats: null, phase: null, flightTime: null, flightDuration: null, done: false };
        window.__iwerFlightStats = watch;
        const id = setInterval(() => {
          const s = game.snapshot();
          if (watch.started === null) {
            if (s.phase === 'flying' && s.flightTime >= fraction * s.flightDuration) {
              game.resetRenderStats();
              watch.started = performance.now();
            }
            return;
          }
          const now = performance.now();
          if (s.phase !== 'flying' || now - watch.started > ms) {
            watch.done = true;
            clearInterval(id);
            return;
          }
          watch.stats = game.renderStats();
          watch.at = now;
          watch.phase = s.phase;
          watch.flightTime = s.flightTime;
          watch.flightDuration = s.flightDuration;
        }, 50);
        setTimeout(() => {
          watch.done = true;
          clearInterval(id);
        }, 120_000);
        return { value: { fraction, ms }, perfNow: performance.now() };
      }
      if (method === 'flightStats.read') {
        const w = window.__iwerFlightStats ?? null;
        return {
          value: w && { ...w, seconds: w.at === null || w.started === null ? 0 : (w.at - w.started) / 1000 },
          perfNow: performance.now(),
        };
      }
      if (method === 'watchLaunch.read') {
        return { value: window.__iwerLaunchWatch ?? null, perfNow: performance.now() };
      }
      // IWER's input mode before a session starts ('hand' or 'controller');
      // the CLI's set-input-mode needs an active session.
      if (method === 'iwer.setPrimaryInputMode') {
        const device = window.IWER_DEVICE;
        if (!device) return { error: 'window.IWER_DEVICE is not installed' };
        device.primaryInputMode = args[0];
        return { value: device.primaryInputMode, perfNow: performance.now() };
      }
      // IWER's XR visibility ('visible' | 'visible-blurred' | 'hidden'). With
      // { launch: true } it launches first in the same call, so a short
      // flight cannot end during the CLI round trip.
      if (method === 'iwer.setVisibility') {
        const device = window.IWER_DEVICE;
        if (!device) return { error: 'window.IWER_DEVICE is not installed' };
        if (typeof device.updateVisibilityState !== 'function') {
          return { error: 'IWER_DEVICE.updateVisibilityState is not a function' };
        }
        const launched = args[1]?.launch === true;
        if (launched) game.launch();
        device.updateVisibilityState(args[0]);
        const s = game.snapshot();
        return {
          value: { state: args[0], launched, attempts: s.attempts, phase: s.phase, flightTime: s.flightTime },
          perfNow: performance.now(),
        };
      }
      // Mid-flight hold for screenshots: a page timer pauses the game (an
      // emulated page hide, so the XR frames and the hands keep rendering)
      // once the next flight reaches `args[0]` of its duration; the driver
      // reads it, takes the screenshot and releases it.
      if (method === 'hold.atFraction') {
        const hold = { fraction: args[0], held: false, heldAt: null, flightDuration: null };
        window.__iwerHold = hold;
        const id = setInterval(() => {
          const s = game.snapshot();
          if (s.phase !== 'flying' || s.flightTime < hold.fraction * s.flightDuration) return;
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
          document.dispatchEvent(new Event('visibilitychange'));
          hold.held = true;
          hold.heldAt = s.flightTime;
          hold.flightDuration = s.flightDuration;
          clearInterval(id);
        }, 5);
        hold.stop = () => clearInterval(id);
        // Armed before the last drag, which can take minutes under load.
        setTimeout(() => clearInterval(id), 600_000);
        return { value: { fraction: hold.fraction }, perfNow: performance.now() };
      }
      // Same hold, once the ghost hand is between args[0] and args[1] seconds
      // into its args[2]-second loop (mid-carry), for its screenshot.
      if (method === 'hold.ghost') {
        const [from, to, period] = args;
        const hold = { fraction: null, held: false, heldAt: null, flightDuration: null };
        window.__iwerHold = hold;
        const id = setInterval(() => {
          const s = game.snapshot();
          const t = s.ghostHand.time % period;
          if (!s.ghostHand.visible || t < from || t > to) return;
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
          document.dispatchEvent(new Event('visibilitychange'));
          hold.held = true;
          hold.heldAt = s.ghostHand.time;
          clearInterval(id);
        }, 5);
        hold.stop = () => clearInterval(id);
        setTimeout(() => clearInterval(id), 600_000);
        return { value: { from, to }, perfNow: performance.now() };
      }
      if (method === 'hold.read') {
        const hold = window.__iwerHold;
        const s = game.snapshot();
        return {
          value: hold
            ? { held: hold.held, heldAt: hold.heldAt, flightDuration: hold.flightDuration, flightTime: s.flightTime, phase: s.phase, pause: s.pause }
            : null,
          perfNow: performance.now(),
        };
      }
      if (method === 'hold.release') {
        window.__iwerHold?.stop?.();
        window.__iwerHold = null;
        // Drop the override: the prototype getter reports the real state.
        delete document.visibilityState;
        document.dispatchEvent(new Event('visibilitychange'));
        return { value: game.snapshot().pause, perfNow: performance.now() };
      }
      const parts = method.split('.');
      const owner = parts.length === 2 ? game[parts[0]] : game;
      const value = await owner[parts[parts.length - 1]](...args);
      // perfNow: the page clock when the call returned (to time events against
      // it); origin: the app frame's origin (to judge resource URLs).
      return {
        value: value === undefined ? null : JSON.parse(JSON.stringify(value)),
        perfNow: performance.now(),
        origin: location.origin,
      };
    },
    { method, args },
  );
}
