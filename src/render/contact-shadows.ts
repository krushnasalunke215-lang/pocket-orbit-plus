import { PlaneGeometry } from '@iwsdk/core';
import { SpritePool } from './halo-sprites.js';
import { postMaterial, shadowMaterial } from './shaders/shadow.js';

/*
 * Depth cues for the play layer floating VISUAL_LIFT above the glass, one
 * draw call each (the board visual parents them, so slots are in board
 * units): SHADOWS, a soft ink disc on the glass under each body, the target
 * and the comet; POSTS, a thin glowing post from the glass up to each body
 * and the target (its pattern is the post's height).
 */

/** Height of the shadow discs above the glass (board units), above the pull rings. */
export const SHADOW_Y = 0.004;

export const SHADOWS = new SpritePool('ContactShadows', new PlaneGeometry(2, 2).rotateX(-Math.PI / 2), shadowMaterial, 16);
SHADOWS.mesh.renderOrder = -1;
SHADOWS.mesh.position.y = SHADOW_Y;

export const POSTS = new SpritePool('LightPosts', new PlaneGeometry(2, 2), postMaterial, 16);
POSTS.mesh.renderOrder = 1;
