import { createSystem, Grabbed, Hovered, VisibilityState, type Entity } from '@iwsdk/core';
import { colliderLocalRadius } from '../game/board-math.js';
import type { GamePhase } from '../game/controller.js';
import { createStarfield } from '../render/starfield.js';
import type { InteractionState } from '../render/visual-types.js';
import { BoardBody } from './components.js';
import { getBoard, getGame, getVisuals } from './runtime.js';
import { currentSessionMode } from './session.js';

const EMPTY_SAMPLES = new Float32Array(0);

/**
 * Copies game state into the visuals every frame: body and moon positions
 * (held bodies belong to BoardConstraintSystem), the comet, the flight trail,
 * the preview arc while placing, the target's solved state, collider sizes
 * for the current board radius, and starfield visibility (desktop and VR,
 * never over passthrough).
 */
export class RenderSyncSystem extends createSystem({
  bodies: { required: [BoardBody] },
}) {
  private readonly pos = [0, 0, 0];
  private readonly comet = [0, 0, 0];
  private starfield!: Entity;
  private lastLevelRevision = -1;
  private lastBoardVersion = -1;
  private lastFlightId = -1;
  private lastPlacementRevision = -1;
  private lastTeleportsPassed = 0;
  private lastPhase: GamePhase | null = null;
  private previewShown = false;

  init(): void {
    this.starfield = this.world.createTransformEntity(createStarfield().root, { persistent: true });
  }

  update(delta: number, time: number): void {
    const game = getGame(this.world);
    const visuals = getVisuals(this.world);
    const board = getBoard(this.world);
    if (!game || !visuals || !board) return;

    const levelChanged = game.levelRevision !== this.lastLevelRevision;
    const resizeColliders = levelChanged || board.version !== this.lastBoardVersion;
    const colliderRadius = colliderLocalRadius(board.pose.radius);

    for (const entity of this.queries.bodies.entities) {
      const id = entity.getValue(BoardBody, 'bodyId') as string;
      const visual = visuals.bodies.get(id);
      const held = entity.hasComponent(Grabbed);
      if (!held && game.bodyBoardPosition(id, this.pos)) {
        entity.object3D?.position.set(this.pos[0], this.pos[1], this.pos[2]);
      }
      if (!visual) continue;
      const state: InteractionState = held ? 'held' : entity.hasComponent(Hovered) ? 'hover' : 'idle';
      visual.setState(state);
      if (resizeColliders) visual.collider?.scale.setScalar(colliderRadius);
      visual.update(time);
    }

    game.cometBoardPosition(this.comet);
    visuals.comet.setPosition(this.comet);
    visuals.comet.setVisible(true);
    visuals.comet.update(delta, time);

    const trail = visuals.trail;
    if (levelChanged) {
      trail.clear();
      this.previewShown = false;
      this.lastPlacementRevision = -1;
      this.lastFlightId = game.flightId;
    }
    if (game.flightId !== this.lastFlightId) {
      trail.beginFlight();
      this.lastFlightId = game.flightId;
      this.lastTeleportsPassed = 0;
    }
    if (game.phase === 'flying') {
      // A teleport jump starts a new line, so no streak joins entry and exit.
      const passed = game.teleportsPassed;
      if (passed !== this.lastTeleportsPassed) {
        trail.breakLine();
        this.lastTeleportsPassed = passed;
      }
      trail.pushPoint(this.comet);
    } else if (this.lastPhase === 'flying') trail.endFlight();

    if (game.phase === 'placing') {
      if (game.placementRevision !== this.lastPlacementRevision || !this.previewShown) {
        const preview = game.preview();
        trail.showPreview(preview.samples, preview.count, preview.breaks, preview.breakCount);
        this.previewShown = true;
        this.lastPlacementRevision = game.placementRevision;
      }
    } else if (this.previewShown) {
      trail.showPreview(EMPTY_SAMPLES, 0);
      this.previewShown = false;
    }

    visuals.target.setSolved(game.phase === 'solved');
    visuals.target.update(time);

    const visibility = this.visibilityState.peek();
    this.starfield.object3D!.visible =
      visibility === VisibilityState.NonImmersive || currentSessionMode(this.world) === 'immersive-vr';

    this.lastPhase = game.phase;
    this.lastLevelRevision = game.levelRevision;
    this.lastBoardVersion = board.version;
  }
}
