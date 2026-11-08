/**
 * Okabe-Ito color-blind-safe palette (plus white). Body types also differ by
 * shape and ring pattern, never by color alone.
 */
export const PALETTE = {
  orange: 0xe69f00,
  skyBlue: 0x56b4e9,
  bluishGreen: 0x009e73,
  yellow: 0xf0e442,
  blue: 0x0072b2,
  vermillion: 0xd55e00,
  reddishPurple: 0xcc79a7,
  black: 0x000000,
  white: 0xffffff,
} as const;

/** Color roles used by the visuals. */
export const ROLE_COLORS = {
  board: 0x0b1324,
  boardRim: PALETTE.blue,
  movablePlanet: PALETTE.skyBlue,
  fixedPlanet: PALETTE.bluishGreen,
  moon: PALETTE.reddishPurple,
  blackHoleCore: PALETTE.black,
  blackHoleRing: PALETTE.vermillion,
  repulsor: PALETTE.white,
  repulsorRing: PALETTE.blue,
  comet: PALETTE.white,
  cometTrail: PALETTE.orange,
  preview: PALETTE.white,
  target: PALETTE.yellow,
  star: PALETTE.white,
  /** Onboarding ghost hand: white tinted toward sky blue. */
  ghost: 0xcfe9fb,
  /** Thin event-horizon rim of the black hole: white-hot, a touch warm. */
  eventHorizon: 0xffe8c8,
  /** Your Table wells (real objects and pucks): bluish green lifted toward white. */
  well: 0x7fe3c6,
  /** Reticle on a real object (a pinch makes a well). */
  reticleObject: PALETTE.bluishGreen,
  /** Reticle where a pinch falls back to a puck (too flat, off the board, no hit). */
  reticleFallback: PALETTE.orange,
} as const;
