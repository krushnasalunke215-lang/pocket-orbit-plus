// `iwsdk browser run` script for director mode, in the app frame: reads
// window.__demo (with the page URL, the debug API's readiness and IWER's
// device name), or navigates the frame to a new search. The driver writes
// the request to e2e/demo/.request.json:
//   { "action": "read" }
//   { "action": "navigate", "search": "?demo=1&shot=3&autostart=1" }
import { readFileSync } from 'node:fs';
import path from 'node:path';

export default async function run({ frame, page, workspaceRoot }) {
  const file = path.join(workspaceRoot, 'e2e', 'demo', '.request.json');
  const { action, search = '' } = JSON.parse(readFileSync(file, 'utf8'));
  if (!['read', 'navigate', 'front'].includes(action)) throw new Error(`unknown action: ${action}`);
  // A covered or minimized headed window is a hidden page: the game pauses
  // and the emulator's frames stop. Raise it.
  if (action === 'front') {
    await page.bringToFront();
    return { front: true };
  }
  const target = frame ?? page;
  return target.evaluate(
    ({ action, search }) => {
      if (action === 'navigate') {
        // After this call returns, so the evaluate is not cut off.
        setTimeout(() => {
          location.search = search;
        }, 50);
        return { from: location.search, to: search };
      }
      return {
        search: location.search,
        ready: Boolean(window.__game?.ready),
        device: window.IWER_DEVICE?.name ?? null,
        title: document.title,
        visibility: document.visibilityState,
        demo: window.__demo ? JSON.parse(JSON.stringify(window.__demo)) : null,
      };
    },
    { action, search },
  );
}
