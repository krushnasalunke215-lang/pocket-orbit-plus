import { Matrix4, Quaternion, Vector3 } from '@iwsdk/core';

/*
 * Director mode's handle on IWER (IWSDK's browser XR emulator). The dev
 * server injects IWER on localhost and exposes the emulated device as
 * window.IWER_DEVICE; its remote-control queue moves the headset, hands
 * and gaze frame by frame, the same queue the IWSDK CLI drives. Dev builds
 * only (index.ts imports src/demo only when import.meta.env.DEV).
 */

export type Triple = [number, number, number];
export type HandDevice = 'hand-left' | 'hand-right';
export type PoseDevice = 'headset' | HandDevice | 'gaze';

interface XYZ {
  x: number;
  y: number;
  z: number;
}
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** The parts of IWER's XRDevice the director uses. */
export interface IwerDevice {
  readonly name: string;
  readonly remote: { dispatch(method: string, params?: Record<string, unknown>): Promise<unknown> };
  readonly sessionOffered: boolean;
  readonly activeSession?: unknown;
  primaryInputMode: 'hand' | 'controller';
  stereoEnabled: boolean;
  visibilityMaskEnabled: boolean;
  readonly devui?: { readonly devUICanvas: HTMLCanvasElement; readonly devUIContainer: HTMLDivElement };
  readonly sem?: { planesVisible: boolean; boundingBoxesVisible: boolean; meshesVisible: boolean };
}

declare global {
  interface Window {
    IWER_DEVICE?: IwerDevice;
  }
}

/** IWER's name for the metaVRGlasses emulator profile. */
export const GLASSES_DEVICE_NAME = 'Meta VR Glasses';

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `test` with timers (window rAF does not run during XR) until it is truthy. */
export async function waitFor<T>(label: string, test: () => T, timeoutMs: number, intervalMs = 50): Promise<NonNullable<T>> {
  const started = performance.now();
  for (;;) {
    const value = test();
    if (value) return value as NonNullable<T>;
    if (performance.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await sleep(intervalMs);
  }
}

const xyz = (p: Triple): XYZ => ({ x: p[0], y: p[1], z: p[2] });

const UP = new Vector3(0, 1, 0);
const eye = new Vector3();
const target = new Vector3();
const lookMatrix = new Matrix4();
const lookQuat = new Quaternion();

/** The rotation whose -Z axis (a headset's view, a hand's target ray) points from `from` to `to`, with no roll. */
export function lookRotation(from: Triple, to: Triple): Quat {
  lookMatrix.lookAt(eye.set(from[0], from[1], from[2]), target.set(to[0], to[1], to[2]), UP);
  lookQuat.setFromRotationMatrix(lookMatrix);
  return { x: lookQuat.x, y: lookQuat.y, z: lookQuat.z, w: lookQuat.w };
}

/**
 * Promise wrappers over device.remote.dispatch. Positions and orientations
 * are in the XR origin, which is the app's world here (no locomotion).
 * Timed commands (animate_to, pinch ramps, select) resolve when IWER has
 * played them out over XR frames.
 */
export class IwerRemote {
  constructor(readonly device: IwerDevice) {}

  private call(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return Promise.resolve(this.device.remote.dispatch(method, params));
  }

  /** Grants the session the app offers (IWSDK offers one on load), with hands as the input. */
  async startSession(): Promise<void> {
    if (this.device.activeSession) return;
    this.device.primaryInputMode = 'hand';
    await waitFor('the offered XR session', () => this.device.sessionOffered, 60_000, 200);
    await this.call('accept_session');
    await waitFor('the XR session', () => this.device.activeSession, 10_000);
    await this.call('set_input_mode', { mode: 'hand' });
  }

  async transform(device: PoseDevice): Promise<{ position: Triple; orientation: Quat }> {
    const t = (await this.call('get_transform', { device })) as { position: XYZ; orientation: Quat };
    return { position: [t.position.x, t.position.y, t.position.z], orientation: t.orientation };
  }

  async place(device: PoseDevice, position: Triple, orientation?: Quat): Promise<void> {
    await this.call('set_transform', { device, position: xyz(position), ...(orientation ? { orientation } : {}) });
  }

  /** A smooth (minimum-jerk) move of a pose over `seconds`. */
  async move(device: PoseDevice, position: Triple, orientation: Quat, seconds: number): Promise<void> {
    await this.call('animate_to', { device, position: xyz(position), orientation, duration: seconds, easing: 'minimum-jerk' });
  }

  async lookAt(device: PoseDevice, point: Triple): Promise<void> {
    await this.call('look_at', { device, target: xyz(point) });
  }

  /** Ramps the hand's pinch to `value` (1 closes it: a select starts; 0 opens it: the select ends). */
  async pinch(device: HandDevice, value: number, seconds = 0.12): Promise<void> {
    await this.call('set_select_value', { device, value, duration: seconds });
  }

  /** A short pinch: press, hold `seconds`, release (a click). */
  async click(device: HandDevice, seconds = 0.12): Promise<void> {
    await this.call('select', { device, duration: seconds });
  }
}
