import { createSystem } from '@iwsdk/core';
import { getCosmos, getSpaceFx, getVisuals } from './runtime.js';

/*
 * Shader prewarm (final-report #4). Hidden or not-yet-used meshes compile
 * their programs the first time they draw: the SpaceFx bursts (invisible
 * until the first flyby or solve), the constellation links (no instances
 * until a second level is solved), and every cosmos and board program on
 * the first frames. As soon as the level's bodies, the cosmos and SpaceFx
 * exist, renderer.compileAsync compiles every material in the scene,
 * visible or not (three's compile walks the whole graph), with
 * KHR_parallel_shader_compile where the browser has it, so the frames keep
 * coming while the driver compiles. ?prewarm=0 turns it off (and starts the
 * planet atlas on frame 3 as before) to measure the difference.
 *
 * It also notes the startup timing for the debug snapshot: the first frame
 * (this system's first update), and the prewarm's start, end and program
 * counts.
 */

export interface StartupTiming {
  /** performance.now() of the first world update (the first frame), ms since navigation. */
  firstFrameMs: number | null;
  /** ?prewarm=0 on this page. */
  prewarmDisabled: boolean;
  prewarm: { startedMs: number; doneMs: number | null; programsBefore: number; programsAfter: number | null } | null;
}

const timing: StartupTiming = {
  firstFrameMs: null,
  prewarmDisabled: typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('prewarm') === '0',
  prewarm: null,
};

/** The startup timing so far (debug snapshot). */
export function startupTiming(): StartupTiming {
  return { ...timing, prewarm: timing.prewarm && { ...timing.prewarm } };
}

/** ?prewarm=0: no shader prewarm, and the space textures all start on frame 3. */
export function prewarmDisabled(): boolean {
  return timing.prewarmDisabled;
}

export class ShaderPrewarmSystem extends createSystem({}) {
  private started = false;

  update(): void {
    if (timing.firstFrameMs === null) timing.firstFrameMs = performance.now();
    if (this.started || timing.prewarmDisabled) return;
    if (!getVisuals(this.world)?.bodies.size || !getCosmos(this.world) || !getSpaceFx(this.world)) return;
    this.started = true;
    const renderer = this.world.renderer;
    const programs = () => renderer.info.programs?.length ?? 0;
    const record = { startedMs: performance.now(), doneMs: null as number | null, programsBefore: programs(), programsAfter: null as number | null };
    timing.prewarm = record;
    renderer.compileAsync(this.world.scene, this.world.camera).then(
      () => {
        record.doneMs = performance.now();
        record.programsAfter = programs();
      },
      (error: unknown) => console.warn('[prewarm] shader compile failed', error),
    );
  }
}
