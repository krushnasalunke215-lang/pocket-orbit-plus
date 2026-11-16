import {
  CapsuleGeometry,
  createSystem,
  DepthOccludable,
  DoubleSide,
  Grabbed,
  Group,
  Mesh,
  MeshBasicMaterial,
  OcclusionShadersMode,
  Quaternion,
  Vector3,
  VisibilityState,
  XRPlane,
  type Entity,
} from '@iwsdk/core';
import { BOARD, BOARD_SIZE_SCALE, DESKTOP_VIEW } from '../config.js';
import { boardHandlePose } from '../game/hud-layout.js';
import {
  chooseBoardPlacement,
  desktopPlacement,
  fallbackPlacement,
  resizedPlacement,
  type BoardPlacement,
  type HeadPose,
  type PlaneInfo,
} from '../game/placement.js';
import { ROLE_COLORS } from '../render/palette.js';
import { createBoardVisual } from '../render/board-visual.js';
import { cosmosQuality } from './graphics-quality.js';
import { setRayGrabbable } from './ray-grab.js';
import type { BoardSize } from '../game/state.js';
import { getSettings, setBoard, type BoardRuntime } from './runtime.js';

/** The parts of a WebXR XRPlane that placement reads. */
interface NativePlane {
  readonly polygon: ReadonlyArray<{ readonly x: number; readonly z: number }>;
  readonly orientation?: string;
  readonly semanticLabel?: string;
}

// Handle look: a short bar just outside the near rim, plus a fat invisible
// collider that hand rays and pinches find easily. World meters.
const handleGeometry = new CapsuleGeometry(0.006, 0.07, 4, 8).rotateZ(Math.PI / 2);
const handleColliderGeometry = new CapsuleGeometry(0.025, 0.08, 2, 8).rotateZ(Math.PI / 2);
const handleMaterial = new MeshBasicMaterial({ color: ROLE_COLORS.boardRim, toneMapped: false });
const handleColliderMaterial = new MeshBasicMaterial({ visible: false, side: DoubleSide });

/**
 * Owns the board root entity and where it sits:
 * - desktop (non-immersive): the fixed DESKTOP_VIEW pose and camera;
 * - entering XR: the fallback pose in front of the head at once (play never
 *   waits), then for BOARD.planeWaitMs, until the first grab, moves onto the
 *   best detected plane (a 'table' first) whenever a plane appears;
 * - afterwards only the board handle (or placeBoard()) moves it.
 * The board size setting scales every placement's radius uniformly
 * (BOARD_SIZE_SCALE); changing it rescales the board about its center,
 * within the table-size cap of a plane placement.
 */
export class BoardPlacementSystem extends createSystem({
  planes: { required: [XRPlane] },
  grabbed: { required: [Grabbed] },
}) {
  private runtime!: BoardRuntime;
  private pendingXRPlacement = false;
  private planeWaitUntil = 0;
  private planesDirty = false;
  private grabbedSincePlacement = false;
  private handleWasGrabbed = false;
  /** The board size the current pose was made for (SaveSystem may load another after init). */
  private boardSize: BoardSize = 'medium';
  private readonly handleOffset = new Vector3();
  private readonly v = new Vector3();
  private readonly v2 = new Vector3();
  private readonly q = new Quaternion();

  init(): void {
    const boardEntity = this.world.createTransformEntity(new Group());
    boardEntity.object3D!.name = 'BoardRoot';
    const boardVisual = createBoardVisual(cosmosQuality().gridSegments);
    boardEntity.object3D!.add(boardVisual.root);
    // The board root's materials share the occlusion uniforms (src/render/shaders/common.ts).
    boardEntity.addComponent(DepthOccludable, { mode: OcclusionShadersMode.HardOcclusion });

    const handleRoot = new Group();
    handleRoot.name = 'BoardHandle';
    handleRoot.add(new Mesh(handleGeometry, handleMaterial), new Mesh(handleColliderGeometry, handleColliderMaterial));
    const handleEntity = this.world.createTransformEntity(handleRoot);
    setRayGrabbable(handleEntity, true);

    const initial = desktopPlacement(this.sizeScale());
    this.runtime = {
      entity: boardEntity,
      handleEntity,
      visual: boardVisual,
      pose: initial.pose,
      placement: initial,
      version: 0,
      placeBoard: () => this.placeNow(),
    };
    setBoard(this.world, this.runtime);
    this.apply(initial);

    this.cleanupFuncs.push(
      this.visibilityState.subscribe((state) => this.onVisibility(state)),
      this.queries.planes.subscribe('qualify', () => {
        this.planesDirty = true;
      }),
      this.queries.grabbed.subscribe('qualify', () => {
        this.grabbedSincePlacement = true;
      }),
    );
  }

  update(): void {
    const size = getSettings(this.world).boardSize;
    if (size !== this.boardSize && !this.runtime.handleEntity.hasComponent(Grabbed)) {
      this.boardSize = size;
      this.apply(resizedPlacement(this.runtime.placement, BOARD_SIZE_SCALE[size]));
    }

    const visibility = this.visibilityState.peek();
    if (visibility === VisibilityState.NonImmersive) return;

    if (this.pendingXRPlacement && this.world.xrFrame) {
      this.pendingXRPlacement = false;
      this.apply(fallbackPlacement(this.headPose(), this.sizeScale()));
      this.planeWaitUntil = performance.now() + BOARD.planeWaitMs;
      this.grabbedSincePlacement = false;
      this.planesDirty = true;
    }

    if (
      this.planesDirty &&
      !this.grabbedSincePlacement &&
      performance.now() <= this.planeWaitUntil &&
      this.queries.planes.entities.size > 0
    ) {
      this.planesDirty = false;
      const placement = chooseBoardPlacement(this.collectPlanes(), this.headPose(), this.sizeScale());
      if (placement.source !== 'fallback') this.apply(placement);
    }

    this.followHandle();
  }

  /** While the handle is held the board follows it; the pose commits on release. */
  private followHandle(): void {
    const handle = this.runtime.handleEntity;
    const grabbed = handle.hasComponent(Grabbed);
    const root = this.runtime.entity.object3D!;
    if (grabbed) {
      handle.object3D!.getWorldPosition(this.v);
      root.position.copy(this.v).sub(this.handleOffset);
    } else if (this.handleWasGrabbed) {
      const { pose, placement } = this.runtime;
      this.apply({
        ...placement,
        pose: { ...pose, center: [root.position.x, root.position.y, root.position.z] },
      });
    }
    this.handleWasGrabbed = grabbed;
  }

  private onVisibility(state: VisibilityState): void {
    const handle = this.runtime.handleEntity.object3D!;
    if (state === VisibilityState.NonImmersive) {
      this.pendingXRPlacement = false;
      handle.visible = false;
      this.apply(desktopPlacement(this.sizeScale()));
      const [px, py, pz] = DESKTOP_VIEW.viewPosition;
      const [lx, ly, lz] = DESKTOP_VIEW.viewLookAt;
      this.camera.position.set(px, py, pz);
      this.camera.lookAt(lx, ly, lz);
    } else if (state === VisibilityState.Visible) {
      handle.visible = true;
      if (this.runtime.placement.source === 'desktop') this.pendingXRPlacement = true;
    }
  }

  /** Debug/manual re-placement: desktop pose, else best plane or fallback. */
  private placeNow(): void {
    if (this.visibilityState.peek() === VisibilityState.NonImmersive) {
      this.apply(desktopPlacement(this.sizeScale()));
      return;
    }
    this.apply(chooseBoardPlacement(this.collectPlanes(), this.headPose(), this.sizeScale()));
  }

  /** Radius factor of the board size the board is (or is about to be) placed at. */
  private sizeScale(): number {
    return BOARD_SIZE_SCALE[this.boardSize];
  }

  private apply(placement: BoardPlacement): void {
    const { center, quaternion, radius } = placement.pose;
    const root = this.runtime.entity.object3D!;
    root.position.set(center[0], center[1], center[2]);
    root.quaternion.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
    root.scale.setScalar(radius);
    this.runtime.pose = placement.pose;
    this.runtime.placement = placement;
    this.runtime.version++;

    const handlePose = boardHandlePose(placement.pose);
    const handle = this.runtime.handleEntity.object3D!;
    handle.position.set(handlePose.position[0], handlePose.position[1], handlePose.position[2]);
    handle.quaternion.set(
      handlePose.quaternion[0],
      handlePose.quaternion[1],
      handlePose.quaternion[2],
      handlePose.quaternion[3],
    );
    this.handleOffset.set(
      handlePose.position[0] - center[0],
      handlePose.position[1] - center[1],
      handlePose.position[2] - center[2],
    );
  }

  private headPose(): HeadPose {
    const head = this.player.head;
    head.getWorldPosition(this.v);
    head.getWorldDirection(this.v2); // +Z of the head; it looks along -Z
    return {
      position: [this.v.x, this.v.y, this.v.z],
      forward: [-this.v2.x, -this.v2.y, -this.v2.z],
    };
  }

  /** Adapts XRPlane entities (world pose + native polygon) to PlaneInfo. */
  private collectPlanes(): PlaneInfo[] {
    const planes: PlaneInfo[] = [];
    for (const entity of this.queries.planes.entities) {
      const info = this.planeInfo(entity);
      if (info) planes.push(info);
    }
    return planes;
  }

  private planeInfo(entity: Entity): PlaneInfo | null {
    const native = entity.getValue(XRPlane, '_plane') as NativePlane | undefined;
    const object = entity.object3D;
    if (!native || !object || native.polygon.length < 3) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of native.polygon) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    object.getWorldPosition(this.v);
    object.getWorldQuaternion(this.q);
    const orientation = native.orientation === 'horizontal' || native.orientation === 'vertical' ? native.orientation : undefined;
    return {
      id: `plane-${entity.index}`,
      label: native.semanticLabel,
      orientation,
      center: [this.v.x, this.v.y, this.v.z],
      quaternion: [this.q.x, this.q.y, this.q.z, this.q.w],
      extents: { minX, maxX, minZ, maxZ },
    };
  }
}
