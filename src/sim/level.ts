import { BODY_KINDS, type BodyKind } from './bodies.js';
import { isFiniteVec, vec2Length, type Vec2 } from './vec.js';

/*
 * Level coordinate frame (board-normalized): the board is a disc of radius 1
 * in the XZ plane, centered at the origin. Vec2 positions are [x, z]; +X is
 * the player's right, +Z points toward the player (so -Z is the far side),
 * and the optional `height` is +Y above the board. Velocities are in board
 * radii per second. The app scales the board root by the board radius in
 * meters, so a level plays identically on any table size.
 */

/** Circular kinematic orbit around a non-orbiting parent body. */
export interface OrbitDef {
  readonly parent: string;
  readonly radius: number;
  /** Seconds per revolution. */
  readonly period: number;
  /** Angle in radians at t = 0 (default 0). */
  readonly phase?: number;
}

export interface BodyDef {
  readonly id: string;
  readonly kind: BodyKind;
  /**
   * Start position. Orbiting bodies ignore it (their position comes from the
   * orbit), but it must still be a valid board point.
   */
  readonly position: Vec2;
  /** Height above the board (default 0). Movable bodies keep their height. */
  readonly height?: number;
  /** The player can drag this body. Movable bodies cannot orbit. */
  readonly movable?: boolean;
  /** Overrides KIND_DEFAULTS[kind].mass. */
  readonly mass?: number;
  /** Overrides KIND_DEFAULTS[kind].radius. */
  readonly radius?: number;
  readonly orbit?: OrbitDef;
}

/** Board positions of movable bodies, keyed by body id. */
export type Placements = Readonly<Record<string, Vec2>>;

export interface LevelDef {
  readonly id: string;
  readonly chapter: number;
  readonly order: number;
  readonly title: string;
  readonly comet: {
    readonly position: Vec2;
    readonly velocity: Vec2;
    readonly height?: number;
  };
  readonly target: {
    readonly position: Vec2;
    readonly radius: number;
    readonly height?: number;
  };
  readonly bodies: readonly BodyDef[];
  /** Seconds before a flight times out (default DEFAULT_MAX_TIME). */
  readonly maxTime?: number;
  /** Normalized radius beyond which the comet is out of bounds. */
  readonly boundsRadius?: number;
  /** Stored, solver-verified placements for every movable body. */
  readonly solution: Placements;
}

/** Movable body id → its start position. */
export function startPlacements(level: LevelDef): Record<string, Vec2> {
  const out: Record<string, Vec2> = {};
  for (const body of level.bodies) {
    if (body.movable) out[body.id] = body.position;
  }
  return out;
}

const ON_BOARD = 1 + 1e-9;

function isPositive(n: unknown): boolean {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

function isVec2(v: unknown): v is Vec2 {
  return Array.isArray(v) && v.length === 2 && isFiniteVec(v);
}

/** Returns a list of problems; an empty list means the level is valid. */
export function validateLevel(level: LevelDef): string[] {
  const problems: string[] = [];
  const where = (what: string) => `${level.id}: ${what}`;

  if (!level.id) problems.push('level id is empty');
  if (!Number.isInteger(level.chapter)) problems.push(where('chapter is not an integer'));
  if (!Number.isInteger(level.order)) problems.push(where('order is not an integer'));

  const checkBoardPoint = (label: string, p: unknown) => {
    if (!isVec2(p)) problems.push(where(`${label} is not a finite [x, z]`));
    else if (vec2Length(p) > ON_BOARD) problems.push(where(`${label} is outside radius 1`));
  };
  const checkHeight = (label: string, h: number | undefined) => {
    if (h !== undefined && !Number.isFinite(h)) problems.push(where(`${label} height is not finite`));
  };

  checkBoardPoint('comet position', level.comet.position);
  checkHeight('comet', level.comet.height);
  if (!isVec2(level.comet.velocity)) problems.push(where('comet velocity is not a finite [x, z]'));

  checkBoardPoint('target position', level.target.position);
  checkHeight('target', level.target.height);
  if (!isPositive(level.target.radius)) problems.push(where('target radius must be > 0'));

  if (level.maxTime !== undefined && !isPositive(level.maxTime)) {
    problems.push(where('maxTime must be > 0'));
  }
  if (level.boundsRadius !== undefined && !isPositive(level.boundsRadius)) {
    problems.push(where('boundsRadius must be > 0'));
  }

  const byId = new Map<string, BodyDef>();
  for (const body of level.bodies) {
    if (!body.id) problems.push(where('a body has an empty id'));
    if (byId.has(body.id)) problems.push(where(`duplicate body id ${body.id}`));
    byId.set(body.id, body);
  }

  for (const body of level.bodies) {
    const label = `body ${body.id}`;
    if (!BODY_KINDS.includes(body.kind)) problems.push(where(`${label} has unknown kind ${body.kind}`));
    checkBoardPoint(`${label} position`, body.position);
    checkHeight(label, body.height);
    if (body.mass !== undefined && !isPositive(body.mass)) problems.push(where(`${label} mass must be > 0`));
    if (body.radius !== undefined && !isPositive(body.radius)) problems.push(where(`${label} radius must be > 0`));

    const orbit = body.orbit;
    if (!orbit) continue;
    if (body.movable) problems.push(where(`${label} is movable and orbits`));
    if (!isPositive(orbit.radius)) problems.push(where(`${label} orbit radius must be > 0`));
    if (!isPositive(orbit.period)) problems.push(where(`${label} orbit period must be > 0`));
    if (orbit.phase !== undefined && !Number.isFinite(orbit.phase)) {
      problems.push(where(`${label} orbit phase is not finite`));
    }
    const parent = byId.get(orbit.parent);
    if (!parent || parent === body) {
      problems.push(where(`${label} orbit parent ${orbit.parent} does not exist`));
    } else if (parent.orbit) {
      problems.push(where(`${label} orbit parent ${orbit.parent} orbits itself`));
    } else if (isVec2(parent.position) && vec2Length(parent.position) + orbit.radius > ON_BOARD) {
      problems.push(where(`${label} orbit leaves radius 1`));
    }
  }

  const movableIds = level.bodies.filter((b) => b.movable).map((b) => b.id);
  const solutionIds = Object.keys(level.solution);
  for (const id of movableIds) {
    if (!solutionIds.includes(id)) problems.push(where(`solution is missing movable body ${id}`));
  }
  for (const id of solutionIds) {
    if (!movableIds.includes(id)) problems.push(where(`solution names non-movable or unknown body ${id}`));
    else checkBoardPoint(`solution ${id}`, level.solution[id]);
  }

  return problems;
}
