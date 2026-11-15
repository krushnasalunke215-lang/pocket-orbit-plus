import { createSystem, DepthOccludable, OcclusionShadersMode } from '@iwsdk/core';
import { VISUAL_LIFT } from '../config.js';
import { colliderLocalRadius } from '../game/board-math.js';
import { GameController } from '../game/controller.js';
import { createBodyVisual } from '../render/body-visuals.js';
import { createCometVisual } from '../render/comet-visual.js';
import { createTargetVisual } from '../render/target-visual.js';
import { createTrailVisual } from '../render/trail-visual.js';
import { ALL_LEVELS } from '../sim/levels/index.js';
import { SANDBOX_LEVELS } from '../sim/levels/sandbox.js';
import { BoardBody } from './components.js';
import { setRayGrabbable } from './ray-grab.js';
import { getBoard, getPause, setGame, setVisuals, type BoardRuntime, type GameVisuals } from './runtime.js';

/** Most flight time (seconds) one frame may play back. */
const MAX_TICK = 0.1;

/**
 * Owns the GameController and the level's entities. Each body becomes an
 * entity under the board root; movable ones are grabbed with the built-in
 * ray / distance grab (RayInteractable + DistanceGrabbable MoveFromTarget),
 * which serves hand rays, near pinches (via the oversized collider), gaze
 * and the desktop mouse. Advances flight playback every frame, except while
 * paused (XR blurred or hidden, page hidden; see LifecycleSystem).
 */
export class GameSystem extends createSystem({
  bodies: { required: [BoardBody] },
}) {
  private game!: GameController;
  private board!: BoardRuntime;
  private visuals!: GameVisuals;
  private builtRevision = -1;
  private readonly tmp = [0, 0, 0];

  init(): void {
    const board = getBoard(this.world);
    if (!board) throw new Error('GameSystem needs BoardPlacementSystem registered first');
    this.board = board;
    this.game = new GameController(ALL_LEVELS, SANDBOX_LEVELS);
    setGame(this.world, this.game);

    const comet = createCometVisual();
    const target = createTargetVisual();
    const trail = createTrailVisual();
    for (const visual of [trail, target, comet]) {
      const entity = this.world.createTransformEntity(visual.root, { parent: board.entity });
      entity.addComponent(DepthOccludable, { mode: OcclusionShadersMode.HardOcclusion });
    }
    // The comet and its trail fly VISUAL_LIFT above the glass (visual only).
    comet.root.position.y = VISUAL_LIFT;
    trail.root.position.y = VISUAL_LIFT;
    this.visuals = { bodies: new Map(), builtRevision: -1, comet, target, trail };
    setVisuals(this.world, this.visuals);
    this.buildLevel();
  }

  update(delta: number): void {
    if (this.game.levelRevision !== this.builtRevision) this.buildLevel();
    if (getPause(this.world).paused) return;
    // A long frame (after a pause, a hitch) plays at most MAX_TICK of the flight.
    this.game.tick(Math.min(delta, MAX_TICK));
  }

  /** Replaces the body entities with the current level's bodies. */
  private buildLevel(): void {
    // Body geometry and materials are shared module resources, so keep them.
    for (const entity of [...this.queries.bodies.entities]) entity.dispose({ disposeResources: false });
    for (const visual of this.visuals.bodies.values()) visual.dispose();
    this.visuals.bodies.clear();

    const level = this.game.level;
    const colliderRadius = colliderLocalRadius(this.board.pose.radius);
    for (const def of level.bodies) {
      const visual = createBodyVisual(def);
      this.game.bodyBoardPosition(def.id, this.tmp);
      // The whole body entity floats VISUAL_LIFT above the glass, so its grab
      // collider stays centered on what the player sees.
      visual.root.position.set(this.tmp[0], this.tmp[1] + VISUAL_LIFT, this.tmp[2]);
      visual.collider?.scale.setScalar(colliderRadius);
      const entity = this.world.createTransformEntity(visual.root, { parent: this.board.entity });
      entity.addComponent(BoardBody, { bodyId: def.id, movable: Boolean(def.movable) });
      // Real objects hide the body where they stand in front of it (DepthSensingSystem).
      entity.addComponent(DepthOccludable, { mode: OcclusionShadersMode.HardOcclusion });
      if (def.movable) setRayGrabbable(entity, true);
      this.visuals.bodies.set(def.id, visual);
    }

    const { target } = level;
    this.visuals.target.root.position.set(target.position[0], target.height ?? 0, target.position[1]);
    this.visuals.target.root.scale.setScalar(target.radius);
    this.builtRevision = this.game.levelRevision;
    this.visuals.builtRevision = this.builtRevision;
  }
}
