import type { World } from '@iwsdk/core';
import { getSandbox } from './runtime.js';

type Hand = 'left' | 'right';
const HANDS: readonly Hand[] = ['left', 'right'];

/** The part of a UIKit pointer event these helpers read. */
export interface PointerIdEvent {
  readonly pointerId?: number;
}

/**
 * The hand whose MultiPointer dispatched `event`: its ray (a pinch while
 * pointing), touch (a fingertip poke) or grab pointer. Null for the mouse,
 * gaze or an event without a pointer id.
 */
export function handOfPointerEvent(world: World, event: PointerIdEvent | undefined): Hand | null {
  const id = event?.pointerId;
  if (id === undefined) return null;
  for (const hand of HANDS) {
    const multiPointer = world.input.xr.multiPointers[hand];
    if (multiPointer.getPointer('ray').id === id || multiPointer.getPointer('touch').id === id || multiPointer.getPointer('grab').id === id) {
      return hand;
    }
  }
  return null;
}

/**
 * True for a ray click by a hand whose current pinch confirmed a Make well
 * (SandboxRuntime.confirmPinch): the HUD and the Your Table panel ignore it,
 * so one pinch never both places a well and presses the button behind the
 * real object.
 */
export function isConfirmPinchClick(world: World, event: PointerIdEvent | undefined): boolean {
  const confirmPinch = getSandbox(world)?.confirmPinch;
  const id = event?.pointerId;
  if (!confirmPinch || id === undefined) return false;
  for (const hand of HANDS) {
    if (confirmPinch[hand] && world.input.xr.multiPointers[hand].getPointer('ray').id === id) return true;
  }
  return false;
}
