import { createSystem, VisibilityState } from '@iwsdk/core';
import { setPause, type PauseReason } from './runtime.js';

/**
 * Computes the Pause record (src/xr/runtime.ts) from the XR visibility state
 * (visible-blurred: a system overlay has focus; hidden) and the page's
 * visibility (a hidden tab, a page being unloaded or put in the back/forward
 * cache). Runs first each frame, so every system sees the same value, and
 * also recomputes right away on each change: a hidden page may get no more
 * frames, and the audio must still be suspended.
 */
export class LifecycleSystem extends createSystem({}) {
  private pageHidden = false;

  init(): void {
    this.pageHidden = document.visibilityState === 'hidden';
    const onVisibility = () => {
      this.pageHidden = document.visibilityState === 'hidden';
      this.refresh();
    };
    const onPageHide = () => {
      this.pageHidden = true;
      this.refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onVisibility);
    this.cleanupFuncs.push(
      () => document.removeEventListener('visibilitychange', onVisibility),
      () => window.removeEventListener('pagehide', onPageHide),
      () => window.removeEventListener('pageshow', onVisibility),
      this.visibilityState.subscribe(() => this.refresh()),
    );
    this.refresh();
  }

  update(): void {
    this.refresh();
  }

  private refresh(): void {
    const xr = this.visibilityState.peek();
    let reason: PauseReason = 'none';
    if (xr === VisibilityState.VisibleBlurred) reason = 'xr-blurred';
    else if (xr === VisibilityState.Hidden) reason = 'xr-hidden';
    else if (this.pageHidden) reason = 'page-hidden';
    setPause(this.world, reason);
  }
}
