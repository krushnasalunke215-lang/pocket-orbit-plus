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
  'placeBoard',
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
  'audio.state',
  'audio.events',
  'audio.expectedNotes',
  'audio.setSettings',
  'audio.renderOffline',
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
