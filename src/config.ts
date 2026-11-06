/**
 * App-wide constants. This module imports nothing.
 */

/**
 * The only user-visible name of the app. To rename the game, change this
 * line; index.html and the HUD read it from here.
 */
export const APP_NAME = 'Pocket Orbit+';

/** Per-frame render budget checked against renderer.info. */
export const RENDER_BUDGET = {
  maxDrawCalls: 100,
  maxTriangles: 150_000,
} as const;

/** A release launches only if the hand was tracked within this window. */
export const LAUNCH_TRACKING_GRACE_MS = 100;

/** Release counts as "over the board" within this normalized radius. */
export const RELEASE_RADIUS = 1.05;

/** Planets are clamped inside this normalized radius. */
export const PLACE_RADIUS = 0.92;

/** Fraction of the flight shown as the preview arc. */
export const PREVIEW_FRACTION = 0.2;

/** Board placement tunables (meters and milliseconds). */
export const BOARD = {
  fallbackDistance: 0.45,
  fallbackDrop: 0.2,
  fallbackRadius: 0.2,
  minRadius: 0.12,
  maxRadius: 0.45,
  tableFill: 0.45,
  reach: 0.8,
  minPlaneSide: 0.25,
  planeWaitMs: 3000,
  lift: 0.004,
  minColliderRadiusM: 0.035,
} as const;

/** Fixed camera and board pose for non-immersive (desktop) play. */
export const DESKTOP_VIEW = {
  cameraPosition: [0, 1.45, -0.05],
  boardCenter: [0, 1.0, -0.45],
  boardRadius: 0.2,
} as const;
