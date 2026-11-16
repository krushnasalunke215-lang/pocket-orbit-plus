import type { World } from '@iwsdk/core';

/*
 * Fingertip presses (IWSDK's touch pointer, @pmndrs/pointer-events) click
 * only when the fingertip goes down and comes back up on the same object
 * within the pointer's click window, 800 ms in IWSDK 1.1.0-rc.2. The touch
 * pointer goes down 2 cm before the surface, so a finger that slows down as
 * it reaches a button (a press straight from the resting hand) can spend
 * longer than that inside the 2 cm: in IWER the HUD Launch press went down
 * and up on the button 890 ms apart, a pointerup with no click (contact, no
 * launch). The window grows to POKE_CLICK_WINDOW_MS for both hands; the
 * same-object and same-press rules still hold, so nothing else clicks.
 */

/** Longest fingertip press (down to up, ms) that still clicks. */
export const POKE_CLICK_WINDOW_MS = 2000;

interface ClickWindowPointer {
  readonly options: { clickThresholdMs?: number };
}

interface PointerArbiter {
  getPointer(kind: 'touch'): ClickWindowPointer;
}

/** Widens the touch pointers' click window (call once, after World.create). */
export function installPokeClickWindow(world: World): void {
  const arbiters = (world.input as unknown as { multiPointers?: Record<'left' | 'right', PointerArbiter> }).multiPointers;
  if (!arbiters) {
    console.warn('[poke] no XR pointers to widen the fingertip click window on');
    return;
  }
  for (const hand of ['left', 'right'] as const) {
    arbiters[hand].getPointer('touch').options.clickThresholdMs = POKE_CLICK_WINDOW_MS;
  }
}
