# Orbit puzzle (working title)

A hands-first WebXR mixed-reality gravity puzzle built with the Immersive Web
SDK (IWSDK). Drag planets onto a glass board on your table, let go, and the
comet launches; bend its path into the target star. The game's display name
lives only in `APP_NAME` in `src/config.ts`.

`iwsdk.config.json` is the project authority (scene, assets, components, XR
features, emulator room). `vite.config.ts` only wires the IWSDK plugin, and the
application systems are registered explicitly in `src/index.ts`.

## Run

```sh
npm install
npm run dev        # CLI-managed dev server + managed Chromium with IWER at https://localhost:8081
```

IWER is IWSDK's browser-based Quest 3 emulator. Enter XR with the HUD's Enter
AR button or the IWER toolbar, and switch the toolbar input to hands. Without
XR, the same build plays with the mouse: `npm run build && npm run preview`.

## Testing on a headset

[TESTING.md](TESTING.md) is the 5-minute checklist for Quest testers. Add
`?debug=1` to the page address (production builds too) for the tester
overlay: average fps and the 1% low, draw calls and triangles, and in Your
Table the hit-test height above the board and its jitter. It also logs one
JSON line every 5 s with `console.info`.

## Layout

- `src/sim/`: pure-TypeScript physics, levels (chapter 1, Your Table targets) and solver (no Three.js).
- `src/game/`: pure gameplay logic (controller, placement, launch gate, state, save, song and stars, attract loop, frame stats).
- `src/audio/`: the procedural Web Audio engine (bells, reverb, pad, whoosh, chords).
- `src/xr/`: IWSDK systems and components.
- `src/render/`: procedural visuals and shaders.
- `src/debug/`: the `window.__game` debug API (dev and e2e builds only).
- `public/ui/`: UIKitML panels: `hud.uikitml` (HUD), `rim-button.uikitml`
  (near-rim Launch/Replay), `level-select.uikitml` (levels, stars, and the
  Settings page: left-handed, high contrast, reduced motion, board size and
  audio), `sandbox.uikitml` (Your Table) and `debug-overlay.uikitml`
  (`?debug=1`).
- `public/vendor/webxr-input-profiles/`: the generic-hand models (MIT), served
  from our own origin instead of the CDN.
- `e2e/`: Playwright desktop tests and the IWER verification script.
- `scripts/`: `solve.ts` (level authoring) and `pages-smoke.mjs` (Pages base-path smoke test).

## Checks

```sh
npm run typecheck
npm test              # vitest unit tests
npm run build
npm run test:e2e      # Playwright, desktop mouse play against a dist-e2e build
npm run verify:iwer   # IWER emulated Quest 3 session in a synthetic room
npm run build:pages && npm run smoke:pages   # Pages base path /pocket-orbit-plus/: no 4xx, no external requests
npm run build         # afterwards, so dist/ matches the default base again
npm.cmd run solve -- c1-l1   # print robust solutions of a level (PowerShell)
```

CI (`.github/workflows/ci.yml`) runs typecheck, tests and build. The Pages
workflow (`.github/workflows/pages.yml`) builds with the repository name as the
Vite base path and deploys with `actions/deploy-pages`.

- IWSDK testing guide: https://iwsdk.dev/guides/02-testing-experience.html
