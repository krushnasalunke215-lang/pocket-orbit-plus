import { PLANET_DEFAULT_MASS, PLANET_DEFAULT_RADIUS } from './constants.js';
import type { Vec3 } from './vec.js';

/** Every body kind a level can contain. */
export type BodyKind = 'planet' | 'moon' | 'black-hole' | 'repulsor';

export const BODY_KINDS: readonly BodyKind[] = [
  'planet',
  'moon',
  'black-hole',
  'repulsor',
];

export interface KindDefaults {
  readonly mass: number;
  /** Contact radius. */
  readonly radius: number;
  /** A closest approach below this distance counts as a flyby. */
  readonly influenceRadius: number;
}

/** Per-kind defaults; a level body may override mass and radius. */
export const KIND_DEFAULTS: Readonly<Record<BodyKind, KindDefaults>> = {
  planet: {
    mass: PLANET_DEFAULT_MASS,
    radius: PLANET_DEFAULT_RADIUS,
    influenceRadius: 0.35,
  },
  moon: { mass: 0.008, radius: 0.035, influenceRadius: 0.25 },
  'black-hole': { mass: 0.06, radius: 0.05, influenceRadius: 0.4 },
  repulsor: { mass: 0.025, radius: 0.05, influenceRadius: 0.35 },
};

/** How a flight ends. */
export type SimOutcome =
  | 'solved'
  | 'collision'
  | 'swallowed'
  | 'out-of-bounds'
  | 'timeout';

export const SIM_OUTCOMES: readonly SimOutcome[] = [
  'solved',
  'collision',
  'swallowed',
  'out-of-bounds',
  'timeout',
];

/** What happens when the comet is at `distance` from a body this step. */
export type ContactResult =
  | { readonly type: 'none' }
  | {
      readonly type: 'end';
      readonly outcome: Exclude<SimOutcome, 'solved' | 'timeout' | 'out-of-bounds'>;
    }
  | { readonly type: 'teleport'; readonly position: Vec3; readonly velocity: Vec3 };

export interface BodyBehavior {
  /** 1 attracts the comet, -1 pushes it away. */
  readonly gravitySign: 1 | -1;
  /** Must not allocate: return shared constant results. */
  contact(distance: number, radius: number): ContactResult;
}

const NO_CONTACT: ContactResult = { type: 'none' };
const COLLISION: ContactResult = { type: 'end', outcome: 'collision' };
const SWALLOWED: ContactResult = { type: 'end', outcome: 'swallowed' };

/**
 * Behavior registry, looked up by kind for every level body.
 *
 * Adding a wormhole later: add `'wormhole'` to BodyKind and BODY_KINDS, add
 * its KIND_DEFAULTS entry, and register a behavior whose contact() returns
 * `{ type: 'teleport', position, velocity }` (the exit point and velocity in
 * board space, typically from level data such as a paired exit body). The
 * stepper in simulate.ts already applies teleports: it moves the comet,
 * replaces its velocity, recomputes the acceleration and restarts flyby
 * tracking. No stepper change is needed.
 */
export const BODY_BEHAVIORS: Readonly<Record<BodyKind, BodyBehavior>> = {
  planet: {
    gravitySign: 1,
    contact: (distance, radius) => (distance < radius ? COLLISION : NO_CONTACT),
  },
  moon: {
    gravitySign: 1,
    contact: (distance, radius) => (distance < radius ? COLLISION : NO_CONTACT),
  },
  'black-hole': {
    gravitySign: 1,
    contact: (distance, radius) => (distance < radius ? SWALLOWED : NO_CONTACT),
  },
  repulsor: {
    gravitySign: -1,
    contact: (distance, radius) => (distance < radius ? COLLISION : NO_CONTACT),
  },
};
