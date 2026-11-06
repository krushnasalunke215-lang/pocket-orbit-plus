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

## Layout

- `src/sim/`: pure-TypeScript physics, levels and solver (no Three.js).
- `src/game/`: pure gameplay logic (controller, placement, launch gate, state).
- `src/xr/`: IWSDK systems and components.
- `src/render/`: procedural visuals and shaders.
- `src/debug/`: the `window.__game` debug API (dev and e2e builds only).
- `public/ui/hud.uikitml`: the HUD panel.
- `e2e/`: Playwright desktop tests and the IWER verification script.

## Checks

```sh
npm run typecheck
npm test              # vitest unit tests
npm run build
npm run test:e2e      # Playwright, desktop mouse play against a dist-e2e build
npm run verify:iwer   # IWER emulated Quest 3 session in a synthetic room
npm.cmd run solve -- c1-l1   # print robust solutions of a level (PowerShell)
```

CI (`.github/workflows/ci.yml`) runs typecheck, tests and build. The Pages
workflow (`.github/workflows/pages.yml`) builds with the repository name as the
Vite base path and deploys with `actions/deploy-pages`.

- IWSDK testing guide: https://iwsdk.dev/guides/02-testing-experience.html
