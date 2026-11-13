import {
  createSystem,
  DepthOccludable,
  EnvironmentRaycastTarget,
  Grabbed,
  OcclusionShadersMode,
  Vector2,
  Vector3,
  VisibilityState,
  type Entity,
} from '@iwsdk/core';
import { PLACE_RADIUS } from '../config.js';
import { colliderLocalRadius, intersectRayWithBoardPlane } from '../game/board-math.js';
import {
  addWell,
  classifyHit,
  clampHeight,
  heightStep,
  MAX_WELLS,
  PUCK_HEIGHT_M,
  wellFromBoardPoint,
  wellMassForHeight,
} from '../game/real-object.js';
import { createReticleVisual } from '../render/reticle-visual.js';
import type { ReticleVisual, WellVisual } from '../render/visual-types.js';
import { createWellVisual } from '../render/well-visual.js';
import type { ExternalWell } from '../sim/wells.js';
import { BoardBody, WellMarker, WellPuck } from './components.js';
import { setRayGrabbable } from './ray-grab.js';
import {
  getBoard,
  getGame,
  getHitLog,
  getPause,
  HIT_LOG_SIZE,
  setSandbox,
  type SandboxRuntime,
  type SandboxWell,
} from './runtime.js';

type Hand = 'left' | 'right';
const HANDS: readonly Hand[] = ['left', 'right'];

/** Source tag of puck wells (real objects use 'real-object'). */
export const PUCK_SOURCE = 'well-puck';
/** Hit-test reach of the reticles (meters). */
const RETICLE_MAX_DISTANCE = 2;

export const SANDBOX_STATUS = {
  idle: 'Make a well from a real object, or add a puck',
  armed: 'Point at an object on your table and pinch',
  placed: 'Well placed: launch to hear it',
  full: 'Max 3 wells',
  tooFlat: 'Too flat: drag the puck instead',
  offBoard: 'Off the board: stand the object on the board',
  noHitTest: 'No hit-test here: drag the puck instead',
  lateMiss: 'Nothing in reach: aim at an object on the board',
  puck: 'Drag the puck, set its height with - and +',
  cleared: 'Wells cleared',
} as const;

interface WellEntry {
  readonly well: SandboxWell;
  readonly entity: Entity;
  readonly visual: WellVisual;
}

/**
 * Your Table (sandbox mode): real objects on the player's table become
 * gravity wells. arm() shows the arming hand's hit-test reticle (built-in
 * EnvironmentRaycastTarget on that hand's target ray; bluish green on an
 * object, orange where a pinch falls back to a puck) and takes the ray
 * grab off the planets, the board handle and the pucks, so the confirming
 * pinch grabs nothing. That pinch (select start; not one whose ray meets a
 * panel button before the hit-test point, which only presses the button) turns the hit
 * into a well under the object, as heavy as the object is tall
 * (wellMassForHeight); a hit on the table itself or no hit spawns a
 * draggable well puck instead (DistanceGrabbable, kept on the board plane
 * inside PLACE_RADIUS; its release moves the well). The HUD and the Your
 * Table panel then ignore that hand's ray click until its select ends
 * (confirmPinch), so the pinch does not also press the button behind the
 * real object. Height +/- change the
 * selected well, clear removes everything. Wells go to the game with
 * setExternalWells, which only sandbox flights use. Registered after
 * GameSystem; no allocation per frame (wells change on events only).
 */
export class RealObjectSystem extends createSystem({
  pucks: { required: [WellPuck] },
  heldPucks: { required: [WellPuck, Grabbed] },
  bodies: { required: [BoardBody] },
}) {
  private runtime!: SandboxRuntime;
  private readonly entries: WellEntry[] = [];
  private readonly reticles = new Map<Hand, { entity: Entity; visual: ReticleVisual }>();
  private nextId = 1;
  private lastStartHand: Hand | null = null;
  private armedFrame = -1;
  /** HitLog.total when arming began (no new hit by the confirm means no hit-test results). */
  private armedHitTotal = 0;
  private frame = 0;
  private lastLevelRevision = -1;
  private lastBoardVersion = -1;
  private reticlesOn = false;
  private readonly v = new Vector3();
  private readonly ndc = new Vector2();
  private hasPointer = false;
  private readonly origin = new Vector3();
  private readonly through = new Vector3();
  private readonly originTuple: [number, number, number] = [0, 0, 0];
  private readonly throughTuple: [number, number, number] = [0, 0, 0];
  private readonly hit2: [number, number] = [0, 0];

  init(): void {
    const reticle = { visible: false, hit: 'miss' as const, world: [0, 0, 0], board: [0, 0, 0], heightM: 0 };
    this.runtime = {
      armed: false,
      armHand: null,
      status: SANDBOX_STATUS.idle,
      wells: [],
      selectedId: null,
      reticle: reticle as SandboxRuntime['reticle'],
      revision: 0,
      confirmPinch: { left: false, right: false },
      arm: (hand) => this.arm(hand),
      disarm: () => this.disarm(),
      addPuck: () => this.addPuck(null, SANDBOX_STATUS.puck),
      stepHeight: (steps) => this.stepHeight(steps),
      clear: () => this.clear(),
    };
    setSandbox(this.world, this.runtime);

    for (const hand of HANDS) {
      const visual = createReticleVisual();
      // The hit-test target is attached only in sandbox mode (setReticleTargets).
      const entity = this.world.createTransformEntity(visual.root);
      this.reticles.set(hand, { entity, visual });
    }

    const canvas = this.renderer.domElement;
    const onPointer = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      this.ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      this.hasPointer = true;
    };
    canvas.addEventListener('pointermove', onPointer);
    canvas.addEventListener('pointerdown', onPointer);
    this.cleanupFuncs.push(
      () => canvas.removeEventListener('pointermove', onPointer),
      () => canvas.removeEventListener('pointerdown', onPointer),
      this.queries.heldPucks.subscribe('qualify', (entity) => this.select(entity.getValue(WellPuck, 'wellId') as string)),
      this.queries.heldPucks.subscribe('disqualify', (entity) => this.onPuckRelease(entity)),
    );
  }

  update(_delta: number, time: number): void {
    this.frame++;
    const game = getGame(this.world);
    const board = getBoard(this.world);
    if (!game || !board) return;
    const sandbox = game.mode === 'sandbox';
    if (sandbox !== this.reticlesOn) this.setReticleTargets(sandbox);
    if (game.levelRevision !== this.lastLevelRevision) {
      // A level load rebuilt the bodies with their ray grab: arming ends.
      if (this.runtime.armed) this.disarm();
      this.lastLevelRevision = game.levelRevision;
      for (const entry of this.entries) entry.visual.setVisible(sandbox);
    }
    if (board.version !== this.lastBoardVersion) {
      const r = colliderLocalRadius(board.pose.radius);
      for (const entry of this.entries) {
        entry.visual.collider?.scale.setScalar(r);
        if (entry.well.kind === 'object') entry.visual.setHeight(entry.well.heightM / board.pose.radius);
      }
      this.lastBoardVersion = board.version;
    }

    const immersive = this.visibilityState.peek() !== VisibilityState.NonImmersive;
    for (const hand of HANDS) {
      const select = this.input.xr.getSelectState(hand);
      if (immersive && select.start) this.lastStartHand = hand;
      // The confirm pinch's click (dispatched on select end by InputSystem,
      // which runs before this system) has been ignored by now; a new pinch
      // also means the old one ended.
      if (select.end || select.start) this.runtime.confirmPinch[hand] = false;
    }

    this.updateReticle(sandbox, immersive, board.pose.radius);

    // No confirm while paused (XR blurred or hidden): like every click, a
    // pinch then belongs to the system UI, not to the game. Nor while the
    // arming hand's ray reaches a ray target before the hit-test point (see
    // rayTargetFirst): that pinch presses the button or grabs the puck.
    const armHand = this.runtime.armHand;
    if (
      this.runtime.armed &&
      armHand &&
      this.frame > this.armedFrame &&
      !getPause(this.world).paused &&
      this.input.xr.getSelectState(armHand).start &&
      !this.rayTargetFirst(armHand)
    ) {
      this.confirm();
    }

    for (const entity of this.queries.heldPucks.entities) this.constrainPuck(entity, immersive);
    for (const entry of this.entries) {
      if (entry.well.kind === 'puck' && !entry.entity.hasComponent(Grabbed)) {
        const p = entry.well.position;
        entry.entity.object3D?.position.set(p[0], 0, p[2]);
      }
      entry.visual.update(time);
    }
  }

  /**
   * True when the hand's ray has a virtual hit (armed, a panel element or a
   * new puck) and no hit-test point lies before it. The ray does not see
   * real objects, so a panel standing behind the aimed object (the HUD or
   * the Your Table panel behind a bottle) does not block the confirm.
   */
  private rayTargetFirst(hand: Hand): boolean {
    const multiPointer = this.input.xr.multiPointers[hand];
    if (!multiPointer.getRayBusy()) return false;
    const reticle = this.runtime.reticle;
    const intersection = multiPointer.getPointer('ray').getIntersection();
    if (!reticle.visible || !intersection) return true;
    const origin = intersection.pointerPosition;
    this.v.set(reticle.world[0], reticle.world[1], reticle.world[2]);
    return intersection.point.distanceToSquared(origin) <= this.v.distanceToSquared(origin);
  }

  /** Classifies the reticle hit of the armed (else right) hand, shows the armed reticle and logs hits in the sandbox. */
  private updateReticle(sandbox: boolean, immersive: boolean, radius: number): void {
    const runtime = this.runtime;
    const reticle = runtime.reticle;
    const hand: Hand = runtime.armHand ?? 'right';
    const root = getBoard(this.world)!.entity.object3D!;
    reticle.visible = false;
    reticle.hit = 'miss';
    for (const h of HANDS) {
      const r = this.reticles.get(h)!;
      const object = r.entity.object3D!;
      const hasHit =
        immersive &&
        object.visible &&
        r.entity.hasComponent(EnvironmentRaycastTarget) &&
        r.entity.getValue(EnvironmentRaycastTarget, 'xrHitTestResult') !== undefined;
      if (h === hand && hasHit && sandbox) {
        object.getWorldPosition(this.v);
        reticle.world[0] = this.v.x;
        reticle.world[1] = this.v.y;
        reticle.world[2] = this.v.z;
        root.updateWorldMatrix(true, false);
        root.worldToLocal(this.v);
        reticle.board[0] = this.v.x;
        reticle.board[1] = this.v.y;
        reticle.board[2] = this.v.z;
        reticle.heightM = this.v.y * radius;
        reticle.hit = classifyHit(reticle.board, reticle.heightM);
        reticle.visible = runtime.armed;
        const log = getHitLog(this.world);
        log.heights[log.next] = reticle.heightM;
        log.positions[log.next * 3] = reticle.world[0];
        log.positions[log.next * 3 + 1] = reticle.world[1];
        log.positions[log.next * 3 + 2] = reticle.world[2];
        log.next = (log.next + 1) % HIT_LOG_SIZE;
        log.count = Math.min(HIT_LOG_SIZE, log.count + 1);
        log.total++;
        log.armed = runtime.armed;
      }
      r.visual.show(runtime.armed && sandbox && h === hand && hasHit, reticle.hit === 'object');
    }
  }

  /**
   * Hit-test sources on both hands' target rays exist only in sandbox mode,
   * so story play pays nothing for them (EnvironmentRaycastSystem cancels a
   * source when its target component is removed).
   */
  private setReticleTargets(on: boolean): void {
    for (const hand of HANDS) {
      const entity = this.reticles.get(hand)!.entity;
      if (on && !entity.hasComponent(EnvironmentRaycastTarget)) {
        entity.addComponent(EnvironmentRaycastTarget, { space: hand, maxDistance: RETICLE_MAX_DISTANCE });
      } else if (!on && entity.hasComponent(EnvironmentRaycastTarget)) {
        entity.removeComponent(EnvironmentRaycastTarget);
      }
    }
    this.reticlesOn = on;
  }

  private arm(hand?: Hand): void {
    const game = getGame(this.world);
    if (!game || game.mode !== 'sandbox') return;
    if (this.visibilityState.peek() === VisibilityState.NonImmersive) {
      this.addPuck(null, SANDBOX_STATUS.noHitTest);
      return;
    }
    if (this.entries.length >= MAX_WELLS) {
      this.setStatus(SANDBOX_STATUS.full);
      return;
    }
    const runtime = this.runtime;
    runtime.armed = true;
    runtime.armHand = hand ?? this.lastStartHand ?? 'right';
    // A fresh hit-test source on that hand's current target ray (the input
    // source may have changed since the last one, e.g. controllers to hands).
    const reticle = this.reticles.get(runtime.armHand)!.entity;
    reticle.removeComponent(EnvironmentRaycastTarget);
    reticle.addComponent(EnvironmentRaycastTarget, { space: runtime.armHand, maxDistance: RETICLE_MAX_DISTANCE });
    this.armedFrame = this.frame;
    this.armedHitTotal = getHitLog(this.world).total;
    this.setInteractable(false);
    this.setStatus(SANDBOX_STATUS.armed);
  }

  private disarm(): void {
    const runtime = this.runtime;
    if (!runtime.armed) return;
    runtime.armed = false;
    runtime.armHand = null;
    this.setInteractable(true);
    runtime.revision++;
  }

  /** Takes the ray grab off (or back onto) the movable planets, the board handle and the pucks (see setRayGrabbable). */
  private setInteractable(on: boolean): void {
    const targets: Entity[] = [];
    for (const entity of this.queries.bodies.entities) if (entity.getValue(BoardBody, 'movable')) targets.push(entity);
    for (const entity of this.queries.pucks.entities) targets.push(entity);
    const handle = getBoard(this.world)?.handleEntity;
    if (handle) targets.push(handle);
    for (const entity of targets) setRayGrabbable(entity, on);
  }

  /** The confirming pinch: a well on the aimed object, else a puck where it aimed (or the center). */
  private confirm(): void {
    const reticle = this.runtime.reticle;
    const hit = reticle.hit;
    const hand = this.runtime.armHand;
    if (hand) this.runtime.confirmPinch[hand] = true;
    this.disarm();
    if (hit === 'object') {
      const id = this.newId();
      const well = wellFromBoardPoint(id, [reticle.board[0], reticle.board[1], reticle.board[2]], reticle.heightM);
      this.addEntry(
        { id, kind: 'object', position: [well.position[0], 0, well.position[2]], heightM: clampHeight(reticle.heightM), measuredHeightM: reticle.heightM, mass: well.mass! },
        SANDBOX_STATUS.placed,
      );
    } else if (hit === 'too-low') {
      this.addPuck([reticle.board[0], reticle.board[2]], SANDBOX_STATUS.tooFlat);
    } else if (hit === 'off-board') {
      this.addPuck(null, SANDBOX_STATUS.offBoard);
    } else {
      // No hit-test result during the whole arming: the session gives none
      // here (VR fallback, or hit-test not granted), so the table is not "too flat".
      // Earlier hits but none now: the ray points past the reach or at nothing.
      const noHits = getHitLog(this.world).total === this.armedHitTotal;
      this.addPuck(null, noHits ? SANDBOX_STATUS.noHitTest : SANDBOX_STATUS.lateMiss);
    }
  }

  private addPuck(at: [number, number] | null, status: string): void {
    const game = getGame(this.world);
    if (!game || game.mode !== 'sandbox') return;
    let x = at?.[0] ?? 0;
    let z = at?.[1] ?? 0;
    const len = Math.hypot(x, z);
    if (len > PLACE_RADIUS) {
      x *= PLACE_RADIUS / len;
      z *= PLACE_RADIUS / len;
    }
    const id = this.newId();
    this.addEntry({ id, kind: 'puck', position: [x, 0, z], heightM: PUCK_HEIGHT_M, measuredHeightM: PUCK_HEIGHT_M, mass: wellMassForHeight(PUCK_HEIGHT_M) }, status);
  }

  private newId(): string {
    return `well-${this.nextId++}`;
  }

  private addEntry(well: SandboxWell, status: string): void {
    const game = getGame(this.world);
    const board = getBoard(this.world);
    if (!game || !board) return;
    const next = addWell(this.externalWells(), this.toExternal(well));
    if (!next) {
      this.setStatus(SANDBOX_STATUS.full);
      return;
    }
    const puck = well.kind === 'puck';
    const visual = createWellVisual(puck);
    visual.root.position.set(well.position[0], 0, well.position[2]);
    visual.setHeight(puck ? 0 : well.heightM / board.pose.radius);
    visual.collider?.scale.setScalar(colliderLocalRadius(board.pose.radius));
    const entity = this.world.createTransformEntity(visual.root, { parent: board.entity });
    entity.addComponent(DepthOccludable, { mode: OcclusionShadersMode.HardOcclusion });
    if (puck) {
      entity.addComponent(WellPuck, { wellId: well.id });
      setRayGrabbable(entity, true);
    } else {
      entity.addComponent(WellMarker, { wellId: well.id });
    }
    this.entries.push({ well, entity, visual });
    this.runtime.wells.push(well);
    game.setExternalWells(next);
    this.select(well.id);
    this.setStatus(status);
  }

  private toExternal(well: SandboxWell): ExternalWell {
    return {
      id: well.id,
      position: [well.position[0], 0, well.position[2]],
      mass: well.mass,
      source: well.kind === 'object' ? 'real-object' : PUCK_SOURCE,
    };
  }

  private externalWells(): ExternalWell[] {
    return this.entries.map((e) => this.toExternal(e.well));
  }

  /** Re-sends every well to the game (after a move or a height change). */
  private syncWells(): void {
    getGame(this.world)?.setExternalWells(this.externalWells());
    this.runtime.revision++;
  }

  private select(id: string): void {
    this.runtime.selectedId = id;
    for (const entry of this.entries) entry.visual.setSelected(entry.well.id === id);
    this.runtime.revision++;
  }

  private stepHeight(steps: number): void {
    const entry = this.entries.find((e) => e.well.id === this.runtime.selectedId);
    const board = getBoard(this.world);
    if (!entry || !board) return;
    entry.well.heightM = heightStep(entry.well.heightM, steps);
    entry.well.mass = wellMassForHeight(entry.well.heightM);
    if (entry.well.kind === 'object') entry.visual.setHeight(entry.well.heightM / board.pose.radius);
    this.syncWells();
  }

  private clear(): void {
    this.disarm();
    for (const entry of this.entries) {
      entry.visual.dispose();
      // Geometry and materials are shared module resources.
      entry.entity.dispose({ disposeResources: false });
    }
    this.entries.length = 0;
    this.runtime.wells.length = 0;
    this.runtime.selectedId = null;
    getGame(this.world)?.setExternalWells([]);
    this.setStatus(SANDBOX_STATUS.cleared);
  }

  private setStatus(status: string): void {
    this.runtime.status = status;
    this.runtime.revision++;
  }

  /** Keeps a held puck on the board plane inside PLACE_RADIUS (desktop: under the cursor). */
  private constrainPuck(entity: Entity, immersive: boolean): void {
    const object = entity.object3D;
    if (!object) return;
    if (!immersive) this.desktopPoint(object.position);
    let x = object.position.x;
    let z = object.position.z;
    const len = Math.hypot(x, z);
    if (len > PLACE_RADIUS) {
      x *= PLACE_RADIUS / len;
      z *= PLACE_RADIUS / len;
    }
    object.position.set(x, 0, z);
  }

  /** Desktop: where the camera ray through the cursor meets the board plane, written into `out` (board units). */
  private desktopPoint(out: Vector3): void {
    const board = getBoard(this.world);
    if (!board || !this.hasPointer) return;
    const root = board.entity.object3D!;
    root.updateWorldMatrix(true, false);
    this.camera.getWorldPosition(this.origin);
    this.through.set(this.ndc.x, this.ndc.y, 0.5).unproject(this.camera);
    root.worldToLocal(this.origin);
    root.worldToLocal(this.through);
    this.originTuple[0] = this.origin.x;
    this.originTuple[1] = this.origin.y;
    this.originTuple[2] = this.origin.z;
    this.throughTuple[0] = this.through.x;
    this.throughTuple[1] = this.through.y;
    this.throughTuple[2] = this.through.z;
    const hit = intersectRayWithBoardPlane(this.originTuple, this.throughTuple, 0, this.hit2);
    if (hit) {
      out.x = hit[0];
      out.z = hit[1];
    }
  }

  private onPuckRelease(entity: Entity): void {
    const id = entity.getValue(WellPuck, 'wellId') as string;
    const entry = this.entries.find((e) => e.well.id === id);
    const object = entity.object3D;
    if (!entry || !object) return;
    if (this.visibilityState.peek() === VisibilityState.NonImmersive) this.desktopPoint(object.position);
    let x = object.position.x;
    let z = object.position.z;
    const len = Math.hypot(x, z);
    if (len > PLACE_RADIUS) {
      x *= PLACE_RADIUS / len;
      z *= PLACE_RADIUS / len;
    }
    entry.well.position[0] = x;
    entry.well.position[2] = z;
    object.position.set(x, 0, z);
    this.syncWells();
  }
}
