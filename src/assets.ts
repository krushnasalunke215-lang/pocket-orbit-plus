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
});
