import { Vector3, XRMesh, XRPlane, type World } from '@iwsdk/core';
import { worldToBoard } from '../game/board-math.js';
import { getBoard } from '../xr/runtime.js';

/*
 * Real-object gravity spike: read-only probes of what the XR runtime reports
 * about the room (granted features, planes, meshes, a viewer hit-test). Only
 * installed through the debug API (dev/e2e builds). Every return value is
 * plain JSON.
 */

type Triple = [number, number, number];

export interface SpikePlane {
  id: string;
  label: string | null;
  orientation: string | null;
  /** Polygon AABB size in the plane's local x/z (meters). */
  size: [number, number];
  /** Polygon AABB in the plane's local x/z (meters). */
  extents: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** World center of the polygon AABB. */
  center: Triple;
  /** The board center in this plane's local frame (meters; y = height above the plane). */
  boardCenterLocal: Triple | null;
}

export interface SpikeMesh {
  id: string;
  semanticLabel: string;
  isBounded3D: boolean;
  dimensions: Triple;
  /** World center of the mesh AABB (local min/max midpoint). */
  center: Triple;
}

export interface SpikeHitTest {
  /** Whether a hit-test source could be created (feature granted). */
  sourceCreated: boolean;
  /** Frames read. */
  frames: number;
  /** World hit positions, one per frame with a hit (first result only). */
  hits: Triple[];
  /** Hit heights above the board plane in meters (worldToBoard y × board radius). */
  boardHeights: number[];
}

export interface SpikeApi {
  enabledFeatures(): string[];
  planes(): SpikePlane[];
  meshes(): SpikeMesh[];
  /** Hit-tests straight out of the viewer for `frames` XR frames, then cancels the source. */
  hitTestFromViewer(frames?: number): Promise<SpikeHitTest>;
}

interface NativePlane {
  readonly polygon: ReadonlyArray<{ readonly x: number; readonly z: number }>;
  readonly orientation?: string;
  readonly semanticLabel?: string;
}

export function createSpikeApi(world: World): SpikeApi {
  const planes = world.queryManager.registerQuery({ required: [XRPlane] });
  const meshes = world.queryManager.registerQuery({ required: [XRMesh] });
  const v = new Vector3();

  return {
    enabledFeatures() {
      const session = world.session as (XRSession & { enabledFeatures?: readonly string[] }) | undefined;
      return Array.from(session?.enabledFeatures ?? []);
    },

    planes() {
      const board = getBoard(world);
      const out: SpikePlane[] = [];
      for (const entity of planes.entities) {
        const native = entity.getValue(XRPlane, '_plane') as NativePlane | undefined;
        const object = entity.object3D;
        if (!native || !object) continue;
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        for (const p of native.polygon) {
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minZ = Math.min(minZ, p.z);
          maxZ = Math.max(maxZ, p.z);
        }
        object.updateWorldMatrix(true, false);
        object.localToWorld(v.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2));
        const center: Triple = [v.x, v.y, v.z];
        let boardCenterLocal: Triple | null = null;
        if (board) {
          const [cx, cy, cz] = board.pose.center;
          object.worldToLocal(v.set(cx, cy, cz));
          boardCenterLocal = [v.x, v.y, v.z];
        }
        out.push({
          id: `plane-${entity.index}`,
          label: native.semanticLabel ?? null,
          orientation: native.orientation ?? null,
          size: [maxX - minX, maxZ - minZ],
          extents: { minX, maxX, minZ, maxZ },
          center,
          boardCenterLocal,
        });
      }
      return out;
    },

    meshes() {
      const out: SpikeMesh[] = [];
      for (const entity of meshes.entities) {
        const object = entity.object3D;
        if (!object) continue;
        const min = entity.getVectorView(XRMesh, 'min');
        const max = entity.getVectorView(XRMesh, 'max');
        const dims = entity.getVectorView(XRMesh, 'dimensions');
        object.updateWorldMatrix(true, false);
        object.localToWorld(v.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2));
        out.push({
          id: `mesh-${entity.index}`,
          semanticLabel: entity.getValue(XRMesh, 'semanticLabel') as string,
          isBounded3D: Boolean(entity.getValue(XRMesh, 'isBounded3D')),
          dimensions: [dims[0], dims[1], dims[2]],
          center: [v.x, v.y, v.z],
        });
      }
      return out;
    },

    async hitTestFromViewer(frames = 10) {
      const result: SpikeHitTest = { sourceCreated: false, frames: 0, hits: [], boardHeights: [] };
      const session = world.session;
      if (!session) return result;
      const viewer = await session.requestReferenceSpace('viewer');
      const source = await world.requestHitTestSource({ space: viewer });
      if (!source) return result;
      result.sourceCreated = true;
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(finish, 5000);
        const stop = world.onXRFrame(() => {
          result.frames++;
          const space = world.xrReferenceSpace;
          const [hit] = world.getHitTestResults(source);
          const pose = space ? hit?.getPose(space) : undefined;
          if (pose) {
            const p = pose.transform.position;
            // Locomotion is off, so the XR reference space is the scene's world frame.
            result.hits.push([p.x, p.y, p.z]);
            const board = getBoard(world);
            if (board) result.boardHeights.push(worldToBoard(board.pose, [p.x, p.y, p.z])[1] * board.pose.radius);
          }
          if (result.frames >= frames) finish();
        });
        function finish(): void {
          clearTimeout(timeout);
          stop();
          resolve();
        }
      });
      source.cancel();
      return result;
    },
  };
}
