import { AnimatedHand, type World } from '@iwsdk/core';

/*
 * Hand-tracking visuals loaded from this site's own origin instead of the
 * jsDelivr webxr-input-profiles CDN that IWSDK uses by default. The GLBs are
 * vendored in public/vendor/webxr-input-profiles (assets 1.0.20, MIT).
 *
 * XRInputVisualAdapter.createVisual takes the class's static assetPath when
 * the input config has none (hands never have one). Its visual cache is keyed
 * by `${assetKeyPrefix}-${profileId}-${handedness}`, and connectVisual drops a
 * cached visual whose constructor is not the adapter's class, so these
 * classes use their own prefix to never collide with a default AnimatedHand.
 * Controllers keep the CDN default: this app is played with hands.
 */

const HAND_DIR = `${import.meta.env.BASE_URL}vendor/webxr-input-profiles/generic-hand`;

class LocalLeftHand extends AnimatedHand {
  static assetPath = `${HAND_DIR}/left.glb`;
  static assetKeyPrefix = 'local-hand';
}

class LocalRightHand extends AnimatedHand {
  static assetPath = `${HAND_DIR}/right.glb`;
  static assetKeyPrefix = 'local-hand';
}

/**
 * Swaps both hand adapters to the local-asset hands. Call right after
 * World.create, before any XR session, so the CDN visual is never created.
 */
export function installLocalHandVisuals(world: World): void {
  const hands = world.input.xr.visualAdapters.hand;
  hands.left.updateVisualImplementation(LocalLeftHand);
  hands.right.updateVisualImplementation(LocalRightHand);
}
