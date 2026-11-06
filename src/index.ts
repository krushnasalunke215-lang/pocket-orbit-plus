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
import { GameSystem } from './xr/game-system.js';
import { HudSystem } from './xr/hud-system.js';
import { RenderStatsSystem } from './xr/render-stats-system.js';
import { RenderSyncSystem } from './xr/render-sync-system.js';

async function main(): Promise<void> {
  const world = await World.create(
    document.getElementById('scene-container') as HTMLDivElement,
    projectOptions,
  );

  // Registration order matters (each init reads what the previous created);
  // priorities set the per-frame order. Built-ins run first: Input -4,
  // GrabSystem -3, SceneUnderstanding -1.
  world
    .registerSystem(BoardPlacementSystem, { priority: 5 })
    .registerSystem(GameSystem, { priority: 10 })
    .registerSystem(BoardConstraintSystem, { priority: 0 })
    .registerSystem(RenderSyncSystem, { priority: 20 })
    .registerSystem(HudSystem, { priority: 30 })
    .registerSystem(RenderStatsSystem, { priority: 40 });

  if (import.meta.env.DEV || import.meta.env.MODE === 'e2e') {
    const { installDebugApi } = await import('./debug/debug-api.js');
    installDebugApi(world);
  }
}

void main();
