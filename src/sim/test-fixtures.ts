import { BODY_BEHAVIORS, type BodyBehavior, type BodyKind, type ContactResult } from './bodies.js';
import type { LevelDef } from './level.js';
import type { Vec3 } from './vec.js';

/*
 * Test-only fixtures (imported by *.test.ts files, never by the app).
 */

/** Exit of the stub wormhole: the comet reappears here, still heading +x. */
export const WORMHOLE_EXIT: Vec3 = [0.3, 0, 0];

/**
 * A comet flying +x through a stub wormhole entry at x = -0.3 (a repulsor
 * whose behavior withStubWormhole swaps) toward a target at x = 0.6. The
 * jump skips the middle of the board, so no sample may lie between them.
 */
export const WORMHOLE_LEVEL: LevelDef = {
  id: 'wormhole-fixture',
  chapter: 0,
  order: 0,
  title: 'Wormhole fixture',
  comet: { position: [-0.9, 0], velocity: [0.5, 0] },
  target: { position: [0.6, 0], radius: 0.1 },
  bodies: [{ id: 'gate', kind: 'repulsor', position: [-0.3, 0], mass: 1e-9, radius: 0.05 }],
  solution: {},
};

const NONE: ContactResult = { type: 'none' };
const JUMP: ContactResult = { type: 'teleport', position: WORMHOLE_EXIT, velocity: [0.5, 0, 0] };

/** Runs `fn` while the repulsor behaves as a wormhole entry, then restores it. */
export function withStubWormhole<T>(fn: () => T): T {
  const registry = BODY_BEHAVIORS as Record<BodyKind, BodyBehavior>;
  const original = registry.repulsor;
  registry.repulsor = { gravitySign: 1, contact: (distance, radius) => (distance < radius ? JUMP : NONE) };
  try {
    return fn();
  } finally {
    registry.repulsor = original;
  }
}
