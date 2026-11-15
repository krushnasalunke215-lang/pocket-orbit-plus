import { createSystem, Grabbed, Hovered } from '@iwsdk/core';
import { VISUAL_LIFT } from '../config.js';
import { colliderLocalRadius } from '../game/board-math.js';
import type { GamePhase } from '../game/controller.js';
import { GRID_MAX_BODIES, wellPull } from '../game/spacetime.js';
import { OUTLINES } from '../render/halo-sprites.js';
import { HIGH_CONTRAST } from '../render/shaders/common.js';
import { WELL_INFLUENCE_RADIUS } from '../sim/wells.js';
import type { InteractionState } from '../render/visual-types.js';
import { BoardBody } from './components.js';
import {
  getBoard,
  getCometOverride,
  getGame,
  getSettings,
  getSettingsRevision,
  getVisuals,
  motionTime,
} from './runtime.js';

const EMPTY_SAMPLES = new Float32Array(0);

/**
 * Copies game state into the visuals every frame: body and moon positions
 * (held bodies belong to BoardConstraintSystem), the comet (or the visual-only
 * CometOverride of the attract and chapter-complete loops), the flight trail,
 * the preview arc while placing, the target's solved state, collider sizes
 * for the current board radius, and the spacetime grid: every body and Your
 * Table well bends the plate (grid entries) and every floating body, the
 * target star and the comet head cast a soft shadow on it (shadow entries). Applies the visual accessibility settings: high
 * contrast (brighter board and body rims, body outlines, the target's star
 * outline) and reduced motion (the decorative clock motionTime() stands
 * still, flight trails stop fading).
 */
export class RenderSyncSystem extends createSystem({
  bodies: { required: [BoardBody] },
}) {
  private readonly pos = [0, 0, 0];
  private readonly comet = [0, 0, 0];
  private readonly pose = [0, 0, 0];
  private lastLevelRevision = -1;
  private lastBoardVersion = -1;
  private lastFlightId = -1;
  private lastPlacementRevision = -1;
  private lastTeleportsPassed = 0;
  private lastPhase: GamePhase | null = null;
  private previewShown = false;
  private lastSettingsRevision = -1;

  update(delta: number, time: number): void {
    const game = getGame(this.world);
    const visuals = getVisuals(this.world);
    const board = getBoard(this.world);
    if (!game || !visuals || !board) return;

    const levelChanged = game.levelRevision !== this.lastLevelRevision;
    const resizeColliders = levelChanged || board.version !== this.lastBoardVersion;
    const colliderRadius = colliderLocalRadius(board.pose.radius);
    const settingsRevision = getSettingsRevision(this.world);
    if (settingsRevision !== this.lastSettingsRevision) {
      const settings = getSettings(this.world);
      HIGH_CONTRAST.value = settings.highContrast ? 1 : 0;
      OUTLINES.mesh.visible = settings.highContrast;
      visuals.target.setHighContrast(settings.highContrast);
      visuals.trail.setStatic(settings.reducedMotion);
      this.lastSettingsRevision = settingsRevision;
    }
    // Decorative animation (spins, pulses, flowing rings) runs on this clock.
    const motion = motionTime(this.world, time);

    const plate = board.visual;
    let grid = 0;
    let shadows = 0;
    for (const entity of this.queries.bodies.entities) {
      const id = entity.getValue(BoardBody, 'bodyId') as string;
      const visual = visuals.bodies.get(id);
      const held = entity.hasComponent(Grabbed);
      if (!held && game.bodyBoardPosition(id, this.pos)) {
        entity.object3D?.position.set(this.pos[0], this.pos[1] + VISUAL_LIFT, this.pos[2]);
      }
      if (!visual) continue;
      const state: InteractionState = held ? 'held' : entity.hasComponent(Hovered) ? 'hover' : 'idle';
      visual.setState(state);
      if (resizeColliders) visual.collider?.scale.setScalar(colliderRadius);
      visual.update(motion);
      // The visual root's position, so a held body bends the grid where it is drawn.
      const p = visual.root.position;
      if (grid < GRID_MAX_BODIES) plate.setGridBody(grid++, p.x, p.z, visual.gridPull, visual.influence);
      if (shadows < GRID_MAX_BODIES && visual.shadowRadius > 0) plate.setShadow(shadows++, p.x, p.y, p.z, visual.shadowRadius);
    }
    const wells = game.activeWells;
    for (let i = 0; i < wells.length && grid < GRID_MAX_BODIES; i++) {
      const w = wells[i];
      plate.setGridBody(grid++, w.position[0], w.position[2], wellPull(w), WELL_INFLUENCE_RADIUS);
    }

    game.cometBoardPosition(this.comet);
    // The attract and chapter-complete loops move the comet visual only.
    const override = getCometOverride(this.world);
    if (override.active) {
      const p = override.position;
      visuals.comet.setPosition(p);
      visuals.comet.setOpacity(override.alpha);
    } else {
      visuals.comet.setPosition(this.comet);
      visuals.comet.setOpacity(1);
    }
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
    visuals.target.update(motion);
    if (shadows < GRID_MAX_BODIES) {
      const r = visuals.target.starPose(this.pose);
      plate.setShadow(shadows++, this.pose[0], this.pose[1], this.pose[2], r);
    }
    if (shadows < GRID_MAX_BODIES) {
      const r = visuals.comet.headPose(this.pose);
      if (r > 0) plate.setShadow(shadows++, this.pose[0], this.pose[1], this.pose[2], r);
    }
    plate.setCounts(grid, shadows);

    this.lastPhase = game.phase;
    this.lastLevelRevision = game.levelRevision;
    this.lastBoardVersion = board.version;
  }
}
