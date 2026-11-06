import { createSystem } from '@iwsdk/core';
import { setRenderStats, type RenderCounts, type RenderStats } from './runtime.js';

function zero(counts: RenderCounts): void {
  counts.calls = 0;
  counts.triangles = 0;
  counts.points = 0;
  counts.lines = 0;
}

/**
 * Samples renderer.info every frame for the render budget check. With
 * renderer.info.autoReset (true by default) the counters are cleared at the
 * start of each render, so in update(), which runs before this frame's
 * render, they hold the previous frame's totals (both eyes in stereo XR).
 * Copies them into preallocated last/max records; never allocates.
 */
export class RenderStatsSystem extends createSystem({}) {
  private stats!: RenderStats;

  init(): void {
    this.stats = {
      last: { calls: 0, triangles: 0, points: 0, lines: 0 },
      max: { calls: 0, triangles: 0, points: 0, lines: 0 },
      frames: 0,
      programs: 0,
      geometries: 0,
      textures: 0,
      autoReset: this.world.renderer.info.autoReset,
      reset: () => {
        zero(this.stats.max);
        this.stats.frames = 0;
      },
    };
    setRenderStats(this.world, this.stats);
  }

  update(): void {
    const info = this.world.renderer.info;
    const render = info.render;
    if (render.calls === 0 && render.triangles === 0) return; // nothing rendered yet
    const { last, max } = this.stats;
    last.calls = render.calls;
    last.triangles = render.triangles;
    last.points = render.points;
    last.lines = render.lines;
    if (last.calls > max.calls) max.calls = last.calls;
    if (last.triangles > max.triangles) max.triangles = last.triangles;
    if (last.points > max.points) max.points = last.points;
    if (last.lines > max.lines) max.lines = last.lines;
    this.stats.frames++;
    this.stats.programs = info.programs?.length ?? 0;
    this.stats.geometries = info.memory.geometries;
    this.stats.textures = info.memory.textures;
  }
}
