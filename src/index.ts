/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { BoardConstraintSystem } from './xr/board-constraint-system.js';
import { BoardPlacementSystem } from './xr/board-placement-system.js';
import { ChapterSystem } from './xr/chapter-system.js';
import { GameAudioSystem } from './xr/game-audio-system.js';
import { GameSystem } from './xr/game-system.js';
import { installLocalHandVisuals } from './xr/hand-visuals.js';
import { HudSystem } from './xr/hud-system.js';
import { LevelSelectSystem } from './xr/level-select-system.js';
import { LifecycleSystem } from './xr/lifecycle-system.js';
import { OnboardingSystem } from './xr/onboarding-system.js';
import { RenderStatsSystem } from './xr/render-stats-system.js';
import { RenderSyncSystem } from './xr/render-sync-system.js';
import { RimButtonSystem } from './xr/rim-button-system.js';
import { SaveSystem } from './xr/save-system.js';

async function main(): Promise<void> {
  const world = await World.create(
    document.getElementById('scene-container') as HTMLDivElement,
    projectOptions,
  );
  // Before any system and any XR session, so hand models never load from the CDN.
  installLocalHandVisuals(world);

  // Registration order matters (each init reads what the previous created);
  // priorities set the per-frame order. Built-ins run first: Input -4,
  // GrabSystem -3, SceneUnderstanding -1.
  world
    // First every frame (before Input and Grab), so a release and the game
    // tick see this frame's pause state.
    .registerSystem(LifecycleSystem, { priority: -5 })
    .registerSystem(BoardPlacementSystem, { priority: 5 })
    .registerSystem(GameSystem, { priority: 10 })
    // Right after GameSystem: restores the save before other systems read state.
    .registerSystem(SaveSystem, { priority: 11 })
    .registerSystem(BoardConstraintSystem, { priority: 0 })
    // Attract loop and ghost hand, then the chapter-complete moment: both
    // write the comet override before RenderSync draws it.
    .registerSystem(OnboardingSystem, { priority: 15 })
    .registerSystem(ChapterSystem, { priority: 16 })
    .registerSystem(RenderSyncSystem, { priority: 20 })
    // After RenderSync, so flyby notes ring from this frame's body positions.
    .registerSystem(GameAudioSystem, { priority: 21 })
    .registerSystem(HudSystem, { priority: 30 })
    .registerSystem(RimButtonSystem, { priority: 31 })
    .registerSystem(LevelSelectSystem, { priority: 32 })
    .registerSystem(RenderStatsSystem, { priority: 40 });

  if (import.meta.env.DEV || import.meta.env.MODE === 'e2e') {
    const { installDebugApi } = await import('./debug/debug-api.js');
    installDebugApi(world);
  }
}

void main();
