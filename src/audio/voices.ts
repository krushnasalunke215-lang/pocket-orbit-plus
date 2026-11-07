import { midiToHz, phraseSchedule } from '../game/song.js';

/*
 * Procedural voices built only from Web Audio nodes (no sound files). Every
 * function takes a BaseAudioContext and a destination node, so the same code
 * plays live through the AudioEngine and renders in an OfflineAudioContext
 * (renderVoiceOffline). Each voice creates its own short-lived nodes,
 * schedules them at `at` (context seconds) and disconnects them when its
 * last source ends.
 */

/** Master gain before the settings volume. */
export const MASTER_LEVEL = 0.8;
/** Seconds of the generated reverb impulse. */
export const REVERB_SECONDS = 2.2;
/** Share of the voice bus sent into the reverb. */
export const REVERB_SEND = 0.32;
/** Default peak gain of one flyby bell. */
export const BELL_GAIN = 0.22;
/** Seconds a bell takes to fade out. */
export const BELL_DECAY = 1.6;
/** Modulator frequency / carrier frequency of the FM bell. */
export const BELL_RATIO = 3.5;

const SILENT = 0.0001;

/** Small deterministic LCG; returns a function giving numbers in [-1, 1). */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2147483648 - 1;
  };
}

/** Stereo seeded noise with an exponential tail (about -60 dB at the end). */
export function createImpulse(ctx: BaseAudioContext, seconds = REVERB_SECONDS, seed = 0x2f6b): AudioBuffer {
  const length = Math.max(1, Math.ceil(seconds * ctx.sampleRate));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  const fadeIn = Math.ceil(0.004 * ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const next = lcg(seed + ch * 7919);
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / ctx.sampleRate;
      const ramp = i < fadeIn ? i / fadeIn : 1;
      data[i] = next() * ramp * Math.exp((-6.9 * t) / seconds);
    }
  }
  return buffer;
}

/** Mono seeded white noise (the whoosh loops it). */
export function createNoiseBuffer(ctx: BaseAudioContext, seconds = 2, seed = 0x9e37): AudioBuffer {
  const length = Math.max(1, Math.ceil(seconds * ctx.sampleRate));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const next = lcg(seed);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = next();
  return buffer;
}

/** The fixed output graph: voices -> (dry + reverb) -> master -> limiter -> destination. */
export interface OutputChain {
  /** Settings write its gain (MASTER_LEVEL x volume, x quiet, or 0 muted). */
  readonly master: GainNode;
  /** A limiter-like compressor that keeps the sum below clipping. */
  readonly limiter: DynamicsCompressorNode;
  /** Voices connect here: dry into master plus a send into the reverb. */
  readonly voices: GainNode;
  readonly reverb: ConvolverNode;
}

/** Builds the output graph once (the engine at start, each offline render). */
export function createOutputChain(ctx: BaseAudioContext, destination: AudioNode): OutputChain {
  const master = ctx.createGain();
  master.gain.value = MASTER_LEVEL;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  master.connect(limiter);
  limiter.connect(destination);

  const voices = ctx.createGain();
  voices.connect(master);
  const send = ctx.createGain();
  send.gain.value = REVERB_SEND;
  const reverb = ctx.createConvolver();
  reverb.buffer = createImpulse(ctx);
  voices.connect(send);
  send.connect(reverb);
  reverb.connect(master);
  return { master, limiter, voices, reverb };
}

/** Disconnects `nodes` once `source` has ended. */
function releaseOnEnd(source: AudioScheduledSourceNode, nodes: readonly AudioNode[]): void {
  source.addEventListener('ended', () => {
    for (const node of nodes) node.disconnect();
  });
}

/**
 * A two-operator FM bell: a sine carrier whose frequency a sine modulator
 * (BELL_RATIO x the carrier) wobbles with a decaying modulation index, under
 * a 4 ms attack and an exponential fade of `decay` seconds. Returns the
 * source that ends last.
 */
export function bell(
  ctx: BaseAudioContext,
  dest: AudioNode,
  hz: number,
  at: number,
  gain = BELL_GAIN,
  decay = BELL_DECAY,
): AudioScheduledSourceNode {
  const carrier = ctx.createOscillator();
  carrier.frequency.value = hz;
  const modulator = ctx.createOscillator();
  const modHz = hz * BELL_RATIO;
  modulator.frequency.value = modHz;
  // Frequency deviation = index x modulator frequency; the index falls from 1.8 to 0.15.
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(1.8 * modHz, at);
  depth.gain.exponentialRampToValueAtTime(0.15 * modHz, at + decay * 0.6);
  modulator.connect(depth);
  depth.connect(carrier.frequency);

  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, at);
  amp.gain.linearRampToValueAtTime(gain, at + 0.004);
  amp.gain.exponentialRampToValueAtTime(SILENT, at + decay);
  carrier.connect(amp);
  amp.connect(dest);

  const end = at + decay + 0.05;
  carrier.start(at);
  modulator.start(at);
  carrier.stop(end);
  modulator.stop(end);
  releaseOnEnd(carrier, [carrier, modulator, depth, amp]);
  return carrier;
}

/** The success chord: bells strummed 40 ms apart with a longer ring. */
export function successChord(
  ctx: BaseAudioContext,
  dest: AudioNode,
  midis: readonly number[],
  at: number,
  gain = 0.13,
): AudioScheduledSourceNode | null {
  let last: AudioScheduledSourceNode | null = null;
  for (let i = 0; i < midis.length; i++) {
    last = bell(ctx, dest, midiToHz(midis[i]), at + i * 0.04, gain, 2.6);
  }
  return last;
}

/** MIDI notes of the miss glide (G4, E4, C4). */
export const MISS_MIDIS: readonly number[] = [67, 64, 60];

/** A soft descending three-note glide through a low-pass filter. */
export function miss(ctx: BaseAudioContext, dest: AudioNode, at: number, gain = 0.1): AudioScheduledSourceNode {
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  const step = 0.22;
  osc.frequency.setValueAtTime(midiToHz(MISS_MIDIS[0]), at);
  for (let i = 1; i < MISS_MIDIS.length; i++) {
    osc.frequency.setValueAtTime(midiToHz(MISS_MIDIS[i - 1]), at + i * step - 0.06);
    osc.frequency.exponentialRampToValueAtTime(midiToHz(MISS_MIDIS[i]), at + i * step);
  }
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1400;
  const amp = ctx.createGain();
  const end = at + MISS_MIDIS.length * step + 0.5;
  amp.gain.setValueAtTime(0, at);
  amp.gain.linearRampToValueAtTime(gain, at + 0.03);
  amp.gain.setValueAtTime(gain, at + (MISS_MIDIS.length - 1) * step);
  amp.gain.exponentialRampToValueAtTime(SILENT, end);
  osc.connect(filter);
  filter.connect(amp);
  amp.connect(dest);
  osc.start(at);
  osc.stop(end + 0.02);
  releaseOnEnd(osc, [osc, filter, amp]);
  return osc;
}

/** A short pickup (up, rising) or drop (falling) tick. */
export function tick(ctx: BaseAudioContext, dest: AudioNode, at: number, up: boolean, gain = 0.07): AudioScheduledSourceNode {
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(up ? 1400 : 1200, at);
  osc.frequency.exponentialRampToValueAtTime(up ? 1900 : 800, at + 0.035);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, at);
  amp.gain.linearRampToValueAtTime(gain, at + 0.002);
  amp.gain.exponentialRampToValueAtTime(SILENT, at + 0.07);
  osc.connect(amp);
  amp.connect(dest);
  osc.start(at);
  osc.stop(at + 0.09);
  releaseOnEnd(osc, [osc, amp]);
  return osc;
}

export type OfflineVoice = 'bell' | 'chord' | 'miss' | 'tick';

export interface OfflineRender {
  /** Largest absolute sample over both channels. */
  peak: number;
  rms: number;
  seconds: number;
  sampleRate: number;
}

/** Chapter 1's closing chord, as the solve phrase builds it. */
const OFFLINE_CHORD: readonly number[] = phraseSchedule([]).chord.midis;

/**
 * Renders one voice through the real output chain (reverb, master at full
 * volume, limiter) into an OfflineAudioContext and measures it: proof that
 * the voice is audible and does not clip.
 */
export async function renderVoiceOffline(voice: OfflineVoice, seconds = 2, sampleRate = 44_100): Promise<OfflineRender> {
  if (!['bell', 'chord', 'miss', 'tick'].includes(voice)) throw new Error(`Unknown voice: ${String(voice)}`);
  if (!(Number.isFinite(seconds) && seconds > 0 && seconds <= 10)) throw new RangeError('seconds must be in (0, 10]');
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const chain = createOutputChain(ctx, ctx.destination);
  const at = 0.05;
  if (voice === 'bell') bell(ctx, chain.voices, midiToHz(72), at);
  else if (voice === 'chord') successChord(ctx, chain.voices, OFFLINE_CHORD, at);
  else if (voice === 'miss') miss(ctx, chain.voices, at);
  else tick(ctx, chain.voices, at, true);
  const buffer = await ctx.startRendering();
  let peak = 0;
  let sum = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v;
    }
  }
  const rms = Math.sqrt(sum / (buffer.length * buffer.numberOfChannels));
  return { peak, rms, seconds: buffer.duration, sampleRate: buffer.sampleRate };
}
