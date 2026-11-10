import { DistanceGrabbable, MovementMode, RayInteractable, type Entity } from '@iwsdk/core';

/**
 * The built-in ray / distance grab every board grabbable uses (planets, the
 * board handle, well pucks): hand rays, near pinches through the oversized
 * collider, gaze and the mouse move the object with the pointer.
 */
export const BOARD_GRAB = {
  movementMode: MovementMode.MoveFromTarget,
  translate: true,
  rotate: false,
  scale: false,
  returnToOrigin: false,
};

/**
 * Lets a board grabbable take rays and grabs again (with BOARD_GRAB), or
 * stops it. Removing RayInteractable alone is not enough: IWSDK's
 * InputSystem keeps every DistanceGrabbable entity among the ray targets,
 * so only Hovered and Pressed would stop while the grab still worked.
 * Without both components the object is no ray target at all. GrabSystem
 * binds the grab handle once and keeps it, so re-adding resumes it.
 */
export function setRayGrabbable(entity: Entity, on: boolean): void {
  if (on) {
    if (!entity.hasComponent(RayInteractable)) entity.addComponent(RayInteractable);
    if (!entity.hasComponent(DistanceGrabbable)) entity.addComponent(DistanceGrabbable, { ...BOARD_GRAB });
  } else {
    if (entity.hasComponent(DistanceGrabbable)) entity.removeComponent(DistanceGrabbable);
    if (entity.hasComponent(RayInteractable)) entity.removeComponent(RayInteractable);
  }
}
