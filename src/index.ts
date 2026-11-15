/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { DepthSensingSystem, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { BoardConstraintSystem } from './xr/board-constraint-system.js';
import { BoardPlacementSystem } from './xr/board-placement-system.js';
import { ChapterSystem } from './xr/chapter-system.js';
import { ComicFxSystem } from './xr/comic-fx-system.js';
import { SkyStorySystem } from './xr/sky-story-system.js';
import { CosmosSystem } from './xr/cosmos-system.js';
import { DesktopCameraSystem } from './xr/desktop-camera-system.js';
import { DebugOverlaySystem, debugOverlayRequested } from './xr/debug-overlay-system.js';
import { GameAudioSystem } from './xr/game-audio-system.js';
import { GameSystem } from './xr/game-system.js';
import { installDisplayQuality } from './xr/display-quality.js';
import { installLocalHandVisuals } from './xr/hand-visuals.js';
import { HudSystem } from './xr/hud-system.js';
import { LevelSelectSystem } from './xr/level-select-system.js';
import { LifecycleSystem } from './xr/lifecycle-system.js';
import { OnboardingSystem } from './xr/onboarding-system.js';
import { RealObjectSystem } from './xr/real-object-system.js';
import { RenderStatsSystem } from './xr/render-stats-system.js';
import { RenderSyncSystem } from './xr/render-sync-system.js';
import { RimButtonSystem } from './xr/rim-button-system.js';
import { SandboxPanelSystem } from './xr/sandbox-panel-system.js';
import { SaveSystem } from './xr/save-system.js';

async function main(): Promise<void> {
  const world = await World.create(
    document.getElementById('scene-container') as HTMLDivElement,
    projectOptions,
  );
  // Before any system and any XR session, so hand models never load from the CDN.
  installLocalHandVisuals(world);
  installDisplayQuality(world);

  // Director mode (?demo=1, dev builds only; see VIDEO.md): plays the
  // trailer shots in IWER. It starts from a fresh game and saves nothing,
  // so every take is the same and the player's save is untouched. In a
  // production build `demo` is the constant false.
  const demo = import.meta.env.DEV && new URLSearchParams(window.location.search).get('demo') === '1';
  // Registration order matters (each init reads what the previous created);
  // priorities set the per-frame order. Built-ins run first: Input -4,
  // GrabSystem -3, SceneUnderstanding -1.
  world
    // First every frame (before Input and Grab), so a release and the game
    // tick see this frame's pause state.
    .registerSystem(LifecycleSystem, { priority: -5 })
    // Depth occlusion before any occludable entity exists. It disables itself
    // when the session lacks 'depth-sensing' (Quest 2, glasses); depthSensing
    // stays optional in iwsdk.config.json. ?occlusion=0 starts it off.
    .registerSystem(DepthSensingSystem, {
      priority: 1,
      configData: {
        enableDepthTexture: true,
        enableOcclusion: new URLSearchParams(window.location.search).get('occlusion') !== '0',
        useFloat32: true,
        blurRadius: 20,
      },
    })
    .registerSystem(BoardPlacementSystem, { priority: 5 })
    // The desktop three-quarter camera and its slow parallax drift.
    .registerSystem(DesktopCameraSystem, { priority: 6 })
    .registerSystem(GameSystem, { priority: 10 });
  // Right after GameSystem: restores the save before other systems read state.
  if (!demo) world.registerSystem(SaveSystem, { priority: 11 });
  world
    // Your Table wells (sandbox mode): reticles, hit-test pinch, pucks.
    .registerSystem(RealObjectSystem, { priority: 12 })
    .registerSystem(BoardConstraintSystem, { priority: 0 })
    // Attract loop and ghost hand, then the chapter-complete moment: both
    // write the comet override before RenderSync draws it.
    .registerSystem(OnboardingSystem, { priority: 15 })
    .registerSystem(ChapterSystem, { priority: 16 })
    .registerSystem(RenderSyncSystem, { priority: 20 })
    // After RenderSync, so flyby notes ring from this frame's body positions.
    .registerSystem(GameAudioSystem, { priority: 21 })
    // Comic words (WHOOSH!, DING!, KA-POW!...) from the game state.
    .registerSystem(ComicFxSystem, { priority: 22 })
    // The surrounding cosmos: AR fade-in, Room view mask, slow orbits.
    .registerSystem(CosmosSystem, { priority: 23 })
    // The solve rise and the constellation: after Onboarding and Chapter
    // write the comet override, before RenderSync draws it (needs the cosmos).
    .registerSystem(SkyStorySystem, { priority: 17 })
    .registerSystem(HudSystem, { priority: 30 })
    .registerSystem(RimButtonSystem, { priority: 31 })
    .registerSystem(LevelSelectSystem, { priority: 32 })
    .registerSystem(SandboxPanelSystem, { priority: 33 })
    .registerSystem(RenderStatsSystem, { priority: 40 });

  // Tester overlay (fps, render counts, hit-test log): only with ?debug=1,
  // in production builds too.
  if (debugOverlayRequested(window.location.search)) {
    world.registerSystem(DebugOverlaySystem, { priority: 41 });
  }

  if (import.meta.env.DEV || import.meta.env.MODE === 'e2e') {
    const { installDebugApi } = await import('./debug/debug-api.js');
    const api = installDebugApi(world);
    if (import.meta.env.DEV && demo) {
      const { startDirector } = await import('./demo/director.js');
      startDirector(world, api);
    }
  }
}

void main();
