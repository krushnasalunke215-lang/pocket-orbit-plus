/**
 * App-wide constants. This module imports nothing.
 */

/**
 * The only user-visible name of the app. To rename the game, change this
 * line; index.html and the HUD read it from here.
 */
export const APP_NAME = 'Pocket Orbit+';

/**
 * Per-frame render budget checked against renderer.info (in XR the counts
 * cover both eyes: 150 stereo calls is about 75 per eye).
 */
export const RENDER_BUDGET = {
  maxDrawCalls: 150,
  maxTriangles: 300_000,
} as const;

/**
 * Direction toward the sun in the board/cosmos frame (normalized at use):
 * to the right, about 27 degrees up and a little ahead, so board bodies seen
 * from the player are half lit from the right.
 */
export const SUN_DIRECTION = [0.74, 0.45, -0.5] as const;

/** Distance of the sun sprite from the cosmos center (meters; in front of the star shell). */
export const SUN_DISTANCE = 45;

/** Fixed foveation level requested for XR sessions (0 none .. 1 most). */
export const XR_FOVEATION = 0.5;

/** One graphics profile of the surrounding cosmos and the board plate. */
export interface CosmosQuality {
  /** Vendored texture size (2048: the -2k files, 1024: the -1k files). */
  readonly textureSize: 2048 | 1024;
  /** Fine stars in the one instanced star field (one draw call). */
  readonly starCount: number;
  /** Diffraction-spike billboards on the brightest stars (one draw call). */
  readonly glints: boolean;
  /** Size of the procedural fallback sky baked once at init (equirect, width x height). */
  readonly skyTexture: readonly [number, number];
  /** Rocks in the asteroid belt (one instanced draw call). */
  readonly asteroids: number;
  /** Near dust motes around the player (one draw call; 0 turns them off). */
  readonly dustMotes: number;
  /** Segments per side of the spacetime grid plate. */
  readonly gridSegments: number;
  /** Shooting stars are atmospheric, not deep space: off in both profiles (the code stays). */
  readonly shootingStars: boolean;
}

/**
 * The two graphics profiles (src/xr/graphics-quality.ts picks one per page
 * load: Settings "Graphics", ?quality=low|high, Low on the Meta VR
 * Glasses). High is the full look; Low is the cheap fallback for a slow
 * headset: the 1k textures, fewer stars, no glints, no dust, a coarser
 * grid plate and fewer rocks.
 */
export const COSMOS_QUALITY_PROFILES: { readonly high: CosmosQuality; readonly low: CosmosQuality } = {
  high: {
    textureSize: 2048,
    starCount: 6000,
    glints: true,
    skyTexture: [512, 256],
    asteroids: 160,
    dustMotes: 300,
    gridSegments: 96,
    shootingStars: false,
  },
  low: {
    textureSize: 1024,
    starCount: 2500,
    glints: false,
    skyTexture: [512, 256],
    asteroids: 60,
    dustMotes: 0,
    gridSegments: 48,
    shootingStars: false,
  },
};

/**
 * Visual height of the play layer above the glass (board units, so it
 * scales with the board: 5.9 cm on the 0.27 m table board, 4.4 cm on the
 * 0.2 m fallback). Planets, moons, the target star, the comet and its
 * trail float there; their grab colliders move with them. The simulation
 * still runs on the board plane.
 */
export const VISUAL_LIFT = 0.22;

/** Board bodies are drawn this much larger than their simulated radius (still inside the grab collider). */
export const VISUAL_BODY_SCALE = 1.25;

/** Seconds the cosmos takes to fade in over the room when an AR session starts. */
export const COSMOS_FADE_SECONDS = 2.5;

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
  /** Table-size cap: on a plane the board radius never exceeds this fraction of the smaller side (the disc fits). */
  tableCapFill: 0.5,
  reach: 0.8,
  /** On a plane, the board's near rim sits at least this far ahead of the head. */
  headGap: 0.05,
  minPlaneSide: 0.25,
  planeWaitMs: 3000,
  lift: 0.004,
  minColliderRadiusM: 0.035,
} as const;

/**
 * Board size setting: a uniform factor on every board radius (table,
 * fallback and desktop). On a plane the table-size cap still applies.
 * Levels are scale-invariant, so solutions survive any size.
 */
export const BOARD_SIZE_SCALE = { small: 0.75, medium: 1, large: 1.25 } as const;

/**
 * Fixed camera and board pose for non-immersive (desktop) play. The board
 * faces cameraPosition (straight ahead of a seated player); the camera
 * itself sits at viewPosition, a seated three-quarter view from the right,
 * low enough that the surrounding cosmos and the giant planet are in the
 * frame above the board and the HUD, and DesktopCameraSystem drifts it
 * slowly around that pose (parallax) while nothing is touched.
 */
export const DESKTOP_VIEW = {
  cameraPosition: [0, 1.45, -0.05],
  cameraLookAt: [0, 1.0, -0.57],
  viewPosition: [0.24, 1.3, 0.0],
  viewLookAt: [-0.02, 1.08, -0.6],
  boardCenter: [0, 1.0, -0.45],
  boardRadius: 0.2,
} as const;
