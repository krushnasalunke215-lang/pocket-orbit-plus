/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { AssetType, defineAssets } from '@iwsdk/core';

const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

export default defineAssets({
  'hud-panel': {
    url: publicAssetUrl('ui/hud.uikitml'),
    type: AssetType.UIKitML,
    name: 'HUD Panel',
  },
  'rim-button': {
    url: publicAssetUrl('ui/rim-button.uikitml'),
    type: AssetType.UIKitML,
    name: 'Near-rim Launch Button',
  },
  'level-select': {
    url: publicAssetUrl('ui/level-select.uikitml'),
    type: AssetType.UIKitML,
    name: 'Level Select',
  },
  'sandbox-panel': {
    url: publicAssetUrl('ui/sandbox.uikitml'),
    type: AssetType.UIKitML,
    name: 'Your Table Panel',
  },
  'debug-overlay': {
    url: publicAssetUrl('ui/debug-overlay.uikitml'),
    type: AssetType.UIKitML,
    name: 'Debug Overlay',
  },
  // Solar System Scope textures (CC BY 4.0, public/vendor/textures/CREDITS.md).
  // Lazy: not preloaded; src/render/space-textures.ts loads them after the first frames.
  'tex-milky-way-2k': {
    url: publicAssetUrl('vendor/textures/milky-way-2k.webp'),
    type: AssetType.Texture,
    priority: 'lazy',
    name: 'Milky Way 2k',
  },
  'tex-milky-way-1k': {
    url: publicAssetUrl('vendor/textures/milky-way-1k.webp'),
    type: AssetType.Texture,
    priority: 'lazy',
    name: 'Milky Way 1k',
  },
  'tex-saturn-2k': {
    url: publicAssetUrl('vendor/textures/saturn-2k.webp'),
    type: AssetType.Texture,
    priority: 'lazy',
    name: 'Saturn 2k',
  },
  'tex-saturn-1k': {
    url: publicAssetUrl('vendor/textures/saturn-1k.webp'),
    type: AssetType.Texture,
    priority: 'lazy',
    name: 'Saturn 1k',
  },
  'tex-saturn-ring': {
    url: publicAssetUrl('vendor/textures/saturn-ring.webp'),
    type: AssetType.Texture,
    priority: 'lazy',
    name: 'Saturn Ring',
  },
  'tex-planets-2k': {
    url: publicAssetUrl('vendor/textures/planets-2k.webp'),
    type: AssetType.Texture,
    priority: 'lazy',
    name: 'Planet Atlas 2k',
  },
  'tex-planets-1k': {
    url: publicAssetUrl('vendor/textures/planets-1k.webp'),
    type: AssetType.Texture,
    priority: 'lazy',
    name: 'Planet Atlas 1k',
  },
});
