import {
  BODY_BEHAVIORS,
  KIND_DEFAULTS,
  type BodyBehavior,
  type BodyKind,
  type SimOutcome,
} from './bodies.js';
import {
  DEFAULT_BOUNDS_RADIUS,
  DEFAULT_MAX_TIME,
  DEFAULT_RECORD_EVERY,
  EPS,
  G,
  SIM_DT,
} from './constants.js';
import { fnvHex, fnvInit, fnvInt32, fnvString } from './hash.js';
import type { LevelDef, Placements } from './level.js';
import { isFiniteVec } from './vec.js';
import { WELL_INFLUENCE_RADIUS, wellMass, wellRadius, type ExternalWell } from './wells.js';

/** Source tag of bodies that come from the level itself. */
export const LEVEL_SOURCE = 'level';

/**
 * Struct-of-arrays view of every gravity source in a flight: level bodies
 * first (in level order), then external wells. Vector arrays hold xyz
 * triples in board space.
 */
export interface SimBodies {
  readonly count: number;
  /** Number of level bodies; indices at or above this are external wells. */
  readonly levelCount: number;
  readonly ids: readonly string[];
  /** Body kind, or null for an external well. */
  readonly kinds: readonly (BodyKind | null)[];
  /** LEVEL_SOURCE for level bodies, the well's source tag for wells. */
  readonly sources: readonly string[];
  /** Static position, or for an orbiting body its (unused) start position. */
  readonly positions: Float64Array;
  readonly masses: Float64Array;
  readonly radii: Float64Array;
  readonly influence: Float64Array;
  /** 1 attracts, -1 repels. */
  readonly signs: Float64Array;
  /** Index of the orbit parent, or -1 for a static body. */
  readonly orbitParent: Int32Array;
  readonly orbitRadius: Float64Array;
  /** 2π / period, in radians per second. */
  readonly orbitOmega: Float64Array;
  readonly orbitPhase: Float64Array;
}

export interface FlybyEvent {
  readonly bodyId: string;
  /** LEVEL_SOURCE or the external well's source tag. */
  readonly source: 'level' | (string & {});
  /** Step of the closest approach. */
  readonly step: number;
  readonly time: number;
  readonly closestDistance: number;
}

export interface SimOptions {
  readonly externalWells?: readonly ExternalWell[];
  /** Record a playback sample every this many steps (default 2). */
  readonly recordEvery?: number;
}

export interface SimResult {
  readonly outcome: SimOutcome;
  /** The body that ended the flight (collision or swallowed). */
  readonly endBodyId?: string;
  /** Steps taken; the flight lasted steps * SIM_DT seconds. */
  readonly steps: number;
  readonly time: number;
  /**
   * Comet xyz per recorded sample. Sample i was taken at step
   * min(i * sampleEvery, steps): step 0 and the final step are always present.
   */
  readonly samples: Float32Array;
  readonly sampleCount: number;
  readonly sampleEvery: number;
  readonly flybys: FlybyEvent[];
  /** FNV-1a over every step's rounded comet position, then the outcome. */
  readonly pathHash: string;
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Builds the gravity sources for a flight. Placements override the x/z of
 * movable bodies (missing ones stay at their start position) and throw on
 * unknown or non-movable ids.
 */
export function createSimBodies(
  level: LevelDef,
  placements: Placements = {},
  wells: readonly ExternalWell[] = [],
): SimBodies {
  const defs = level.bodies;
  const levelCount = defs.length;
  const count = levelCount + wells.length;
  const index = new Map<string, number>();
  defs.forEach((body, i) => index.set(body.id, i));

  for (const id of Object.keys(placements)) {
    const i = index.get(id);
    if (i === undefined) throw new Error(`Placement for unknown body ${id}`);
    if (!defs[i].movable) throw new Error(`Placement for non-movable body ${id}`);
    const p = placements[id];
    if (!Array.isArray(p) || p.length !== 2 || !isFiniteVec(p)) {
      throw new Error(`Placement for ${id} must be a finite [x, z]`);
    }
  }

  const ids: string[] = [];
  const kinds: (BodyKind | null)[] = [];
  const sources: string[] = [];
  const positions = new Float64Array(count * 3);
  const masses = new Float64Array(count);
  const radii = new Float64Array(count);
  const influence = new Float64Array(count);
  const signs = new Float64Array(count);
  const orbitParent = new Int32Array(count).fill(-1);
  const orbitRadius = new Float64Array(count);
  const orbitOmega = new Float64Array(count);
  const orbitPhase = new Float64Array(count);

  defs.forEach((body, i) => {
    const defaults = KIND_DEFAULTS[body.kind];
    if (!defaults) throw new Error(`Body ${body.id} has unknown kind ${body.kind}`);
    const p = hasOwn(placements, body.id) ? placements[body.id] : body.position;
    ids.push(body.id);
    kinds.push(body.kind);
    sources.push(LEVEL_SOURCE);
    positions[i * 3] = p[0];
    positions[i * 3 + 1] = body.height ?? 0;
    positions[i * 3 + 2] = p[1];
    masses[i] = body.mass ?? defaults.mass;
    radii[i] = body.radius ?? defaults.radius;
    influence[i] = defaults.influenceRadius;
    signs[i] = BODY_BEHAVIORS[body.kind].gravitySign;
    if (body.orbit) {
      const parent = index.get(body.orbit.parent);
      if (parent === undefined || parent === i || defs[parent].orbit) {
        throw new Error(`Body ${body.id} has an invalid orbit parent ${body.orbit.parent}`);
      }
      orbitParent[i] = parent;
      orbitRadius[i] = body.orbit.radius;
      orbitOmega[i] = (2 * Math.PI) / body.orbit.period;
      orbitPhase[i] = body.orbit.phase ?? 0;
    }
  });

  wells.forEach((well, k) => {
    const i = levelCount + k;
    if (index.has(well.id)) throw new Error(`External well id ${well.id} is already in use`);
    index.set(well.id, i);
    ids.push(well.id);
    kinds.push(null);
    sources.push(well.source);
    positions[i * 3] = well.position[0];
    positions[i * 3 + 1] = well.position[1];
    positions[i * 3 + 2] = well.position[2];
    masses[i] = wellMass(well);
    radii[i] = wellRadius(well);
    influence[i] = WELL_INFLUENCE_RADIUS;
    signs[i] = 1;
  });

  return {
    count,
    levelCount,
    ids,
    kinds,
    sources,
    positions,
    masses,
    radii,
    influence,
    signs,
    orbitParent,
    orbitRadius,
    orbitOmega,
    orbitPhase,
  };
}

/**
 * Writes body i's position at time t into out[offset..offset+2]. An orbiting
 * body sits at parent + r * (cos(ωt + φ), 0, sin(ωt + φ)).
 */
export function bodyPositionAt(
  bodies: SimBodies,
  i: number,
  t: number,
  out: Float64Array,
  offset = 0,
): Float64Array {
  const pos = bodies.positions;
  const parent = bodies.orbitParent[i];
  if (parent < 0) {
    out[offset] = pos[i * 3];
    out[offset + 1] = pos[i * 3 + 1];
    out[offset + 2] = pos[i * 3 + 2];
  } else {
    const angle = bodies.orbitOmega[i] * t + bodies.orbitPhase[i];
    const r = bodies.orbitRadius[i];
    out[offset] = pos[parent * 3] + r * Math.cos(angle);
    out[offset + 1] = pos[parent * 3 + 1];
    out[offset + 2] = pos[parent * 3 + 2] + r * Math.sin(angle);
  }
  return out;
}

function hashPosition(h: number, x: number, y: number, z: number): number {
  h = fnvInt32(h, Math.round(x * 1e5));
  h = fnvInt32(h, Math.round(y * 1e5));
  return fnvInt32(h, Math.round(z * 1e5));
}

/**
 * Flies the comet for the given placements with fixed-step velocity Verlet
 * and returns the whole flight. Deterministic: the same inputs always give
 * the same samples, flybys and pathHash. Contact order per step: target →
 * level bodies in order → bounds → time.
 */
export function simulate(
  level: LevelDef,
  placements: Placements = {},
  options: SimOptions = {},
): SimResult {
  const recordEvery = options.recordEvery ?? DEFAULT_RECORD_EVERY;
  if (!Number.isInteger(recordEvery) || recordEvery < 1) {
    throw new Error('recordEvery must be a positive integer');
  }
  const bodies = createSimBodies(level, placements, options.externalWells ?? []);
  const n = bodies.count;
  const levelCount = bodies.levelCount;
  const { masses, radii, influence, signs } = bodies;
  const behaviors: BodyBehavior[] = [];
  for (let i = 0; i < levelCount; i++) behaviors.push(BODY_BEHAVIORS[bodies.kinds[i] as BodyKind]);

  const orbitingList: number[] = [];
  for (let i = 0; i < n; i++) if (bodies.orbitParent[i] >= 0) orbitingList.push(i);
  const orbiting = Int32Array.from(orbitingList);

  const maxTime = level.maxTime ?? DEFAULT_MAX_TIME;
  const bounds = level.boundsRadius ?? DEFAULT_BOUNDS_RADIUS;
  const bounds2 = bounds * bounds;
  const maxSteps = Math.max(1, Math.ceil(maxTime / SIM_DT - 1e-9));
  const eps2 = EPS * EPS;
  const dt = SIM_DT;
  const halfDt2 = 0.5 * dt * dt;

  const tx = level.target.position[0];
  const ty = level.target.height ?? 0;
  const tz = level.target.position[1];
  const targetRadius = level.target.radius;

  // Preallocated per flight; the step loop below allocates nothing except
  // the (rare) flyby events.
  const bodyPos = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) bodyPositionAt(bodies, i, 0, bodyPos, i * 3);
  const dist = new Float64Array(n);
  const prev1 = new Float64Array(n).fill(NaN);
  const prev2 = new Float64Array(n).fill(NaN);
  const acc = new Float64Array(3);
  const capacity = Math.floor(maxSteps / recordEvery) + 2;
  const samples = new Float32Array(capacity * 3);
  const flybys: FlybyEvent[] = [];

  let px = level.comet.position[0];
  let py = level.comet.height ?? 0;
  let pz = level.comet.position[1];
  let vx = level.comet.velocity[0];
  let vy = 0;
  let vz = level.comet.velocity[1];

  const computeAccel = (x: number, y: number, z: number): void => {
    let ax = 0;
    let ay = 0;
    let az = 0;
    for (let i = 0; i < n; i++) {
      const dx = bodyPos[i * 3] - x;
      const dy = bodyPos[i * 3 + 1] - y;
      const dz = bodyPos[i * 3 + 2] - z;
      const r2 = dx * dx + dy * dy + dz * dz + eps2;
      const s = (signs[i] * G * masses[i]) / (r2 * Math.sqrt(r2));
      ax += s * dx;
      ay += s * dy;
      az += s * dz;
    }
    acc[0] = ax;
    acc[1] = ay;
    acc[2] = az;
  };

  // Updates flyby tracking with this step's distances (also fills dist[]).
  const trackFlybys = (step: number): void => {
    for (let i = 0; i < n; i++) {
      const dx = bodyPos[i * 3] - px;
      const dy = bodyPos[i * 3 + 1] - py;
      const dz = bodyPos[i * 3 + 2] - pz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      dist[i] = d;
      const mid = prev1[i];
      if (mid < prev2[i] && mid < d && mid < influence[i]) {
        flybys.push({
          bodyId: bodies.ids[i],
          source: bodies.sources[i],
          step: step - 1,
          time: (step - 1) * dt,
          closestDistance: mid,
        });
      }
      prev2[i] = mid;
      prev1[i] = d;
    }
  };

  let sampleCount = 0;
  const record = (): void => {
    samples[sampleCount * 3] = px;
    samples[sampleCount * 3 + 1] = py;
    samples[sampleCount * 3 + 2] = pz;
    sampleCount++;
  };

  let h = hashPosition(fnvInit(), px, py, pz);
  record();
  trackFlybys(0);
  computeAccel(px, py, pz);

  let step = 0;
  let outcome: SimOutcome | null = null;
  let endBodyId: string | undefined;

  while (outcome === null) {
    const ax = acc[0];
    const ay = acc[1];
    const az = acc[2];
    px += vx * dt + ax * halfDt2;
    py += vy * dt + ay * halfDt2;
    pz += vz * dt + az * halfDt2;
    step++;
    const t = step * dt;
    for (let k = 0; k < orbiting.length; k++) {
      const i = orbiting[k];
      bodyPositionAt(bodies, i, t, bodyPos, i * 3);
    }
    computeAccel(px, py, pz);
    vx += 0.5 * (ax + acc[0]) * dt;
    vy += 0.5 * (ay + acc[1]) * dt;
    vz += 0.5 * (az + acc[2]) * dt;

    h = hashPosition(h, px, py, pz);
    trackFlybys(step);

    const tdx = px - tx;
    const tdy = py - ty;
    const tdz = pz - tz;
    if (tdx * tdx + tdy * tdy + tdz * tdz < targetRadius * targetRadius) {
      outcome = 'solved';
      break;
    }

    for (let i = 0; i < levelCount; i++) {
      const contact = behaviors[i].contact(dist[i], radii[i]);
      if (contact.type === 'none') continue;
      if (contact.type === 'end') {
        outcome = contact.outcome;
        endBodyId = bodies.ids[i];
      } else {
        px = contact.position[0];
        py = contact.position[1];
        pz = contact.position[2];
        vx = contact.velocity[0];
        vy = contact.velocity[1];
        vz = contact.velocity[2];
        computeAccel(px, py, pz);
        prev1.fill(NaN);
        prev2.fill(NaN);
      }
      break;
    }
    if (outcome !== null) break;

    if (px * px + pz * pz > bounds2 || Math.abs(py) > bounds) {
      outcome = 'out-of-bounds';
      break;
    }
    if (step >= maxSteps) {
      outcome = 'timeout';
      break;
    }
    if (step % recordEvery === 0) record();
  }

  // The loop records only steps that did not end the flight, so the final
  // step is always recorded here.
  record();
  h = fnvString(h, outcome);

  const result: SimResult = {
    outcome,
    steps: step,
    time: step * dt,
    samples: samples.slice(0, sampleCount * 3),
    sampleCount,
    sampleEvery: recordEvery,
    flybys,
    pathHash: fnvHex(h),
  };
  return endBodyId === undefined ? result : { ...result, endBodyId };
}
