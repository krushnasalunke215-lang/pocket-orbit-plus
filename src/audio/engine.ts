import { midiToHz } from '../game/song.js';
import {
  bell,
  BELL_GAIN,
  createNoiseBuffer,
  createOutputChain,
  MASTER_LEVEL,
  miss,
  successChord,
  tick,
  type OutputChain,
} from './voices.js';

/*
 * The game's sound: one AudioEngine per page on the shared three.js
 * AudioContext, whose listener IWSDK's AudioSystem keeps on the player's
 * head, so the HRTF PannerNodes place notes relative to the head. The
 * constructor builds the long-lived graph once: the output chain (voices ->
 * dry + convolution reverb -> master -> limiter), a soft ambient pad and a
 * comet whoosh (looping noise -> band-pass -> gain -> HRTF panner). Their
 * sources start at unlock(), never before a user gesture or an XR session
 * start. Per-frame calls (setWhoosh) only move AudioParams; nodes are
 * created only per note.
 */

/** Master multiplier of the quiet setting. */
export const QUIET_FACTOR = 0.35;
/** Gain the pad fades in to (very low), and the seconds it takes. */
export const PAD_LEVEL = 0.04;
const PAD_FADE_SECONDS = 4;
/** Whoosh gain at and above WHOOSH_FULL_SPEED, and its floor while flying. */
const WHOOSH_MAX_GAIN = 0.11;
const WHOOSH_FLOOR_GAIN = 0.012;
/** Comet speed (m/s) that drives the whoosh fully open. */
export const WHOOSH_FULL_SPEED = 0.35;
/** Gain of a phrase note (non-spatial). */
const PHRASE_GAIN = 0.16;
/** Seconds between the notes of the chapter-complete arpeggio. */
export const ARPEGGIO_STEP = 0.2;
/** PannerNode refDistance (m) of spatial notes and the whoosh. */
const REF_DISTANCE = 0.5;
/** Small offset so a note scheduled "now" never starts in the past. */
const SCHEDULE_AHEAD = 0.005;

export type AudioEventKind = 'flyby' | 'phrase' | 'chord' | 'miss' | 'pickup' | 'drop' | 'arpeggio';

export interface AudioEvent {
  kind: AudioEventKind;
  /** Level body or well id ('' for the chord and the miss). */
  bodyId: string;
  /** Flyby source ('level' or a well source; '' when not a flyby). */
  source: string;
  /** GameController.flightId when it was played. */
  flightId: number;
  /** GameController.flightTime when it was played (seconds). */
  flightTime: number;
  /** AudioContext time the sound starts at. */
  ctxTime: number;
  /** MIDI note (the chord's root; -1 for ticks and the miss glide). */
  midi: number;
}

/** A preallocated ring buffer of the last `capacity` audio events. */
export class AudioEventLog {
  readonly capacity: number;
  /** Events recorded since the start (including overwritten ones). */
  total = 0;
  private readonly slots: AudioEvent[];
  private next = 0;
  private size = 0;

  constructor(capacity = 64) {
    this.capacity = capacity;
    this.slots = Array.from({ length: capacity }, () => ({
      kind: 'flyby' as AudioEventKind,
      bodyId: '',
      source: '',
      flightId: 0,
      flightTime: 0,
      ctxTime: 0,
      midi: 0,
    }));
  }

  /** Overwrites the oldest slot in place (no allocation). */
  record(
    kind: AudioEventKind,
    bodyId: string,
    source: string,
    flightId: number,
    flightTime: number,
    ctxTime: number,
    midi: number,
  ): void {
    const e = this.slots[this.next];
    e.kind = kind;
    e.bodyId = bodyId;
    e.source = source;
    e.flightId = flightId;
    e.flightTime = flightTime;
    e.ctxTime = ctxTime;
    e.midi = midi;
    this.next = (this.next + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
    this.total++;
  }

  /** Copies of the kept events, oldest first. */
  toArray(): AudioEvent[] {
    const out: AudioEvent[] = [];
    const start = (this.next - this.size + this.capacity) % this.capacity;
    for (let i = 0; i < this.size; i++) out.push({ ...this.slots[(start + i) % this.capacity] });
    return out;
  }
}

export interface AudioEngineState {
  contextState: AudioContextState;
  unlocked: boolean;
  muted: boolean;
  volume: number;
  quiet: boolean;
  sampleRate: number;
}

export interface AudioLevelSettings {
  readonly muted: boolean;
  readonly volume: number;
  readonly quiet: boolean;
}

function configurePanner(panner: PannerNode): void {
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = REF_DISTANCE;
  panner.rolloffFactor = 1;
  panner.maxDistance = 50;
}

export class AudioEngine {
  readonly context: AudioContext;
  readonly log = new AudioEventLog(64);
  private readonly chain: OutputChain;
  private readonly padSources: OscillatorNode[];
  private readonly padGain: GainNode;
  private readonly whooshSource: AudioBufferSourceNode;
  private readonly whooshFilter: BiquadFilterNode;
  private readonly whooshGain: GainNode;
  private readonly whooshPanner: PannerNode;
  private isUnlocked = false;
  private whooshOn = false;
  private muted = false;
  private volume = 0.8;
  private quiet = false;

  constructor(context: AudioContext) {
    this.context = context;
    const ctx = context;
    this.chain = createOutputChain(ctx, ctx.destination);
    this.chain.master.gain.value = this.masterTarget();

    // Pad: three detuned low oscillators under a slowly breathing low-pass.
    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 650;
    padFilter.Q.value = 0.6;
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0;
    const voices: [number, OscillatorType, number][] = [
      [midiToHz(48), 'sine', 0],
      [midiToHz(55), 'triangle', 6],
      [midiToHz(60), 'sine', -5],
    ];
    this.padSources = voices.map(([hz, type, detune]) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = hz;
      osc.detune.value = detune;
      osc.connect(padFilter);
      return osc;
    });
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 220;
    lfo.connect(lfoDepth);
    lfoDepth.connect(padFilter.frequency);
    this.padSources.push(lfo);
    padFilter.connect(this.padGain);
    this.padGain.connect(this.chain.master);

    // Whoosh: looping seeded noise, band-passed, at the comet.
    this.whooshSource = ctx.createBufferSource();
    this.whooshSource.buffer = createNoiseBuffer(ctx);
    this.whooshSource.loop = true;
    this.whooshFilter = ctx.createBiquadFilter();
    this.whooshFilter.type = 'bandpass';
    this.whooshFilter.frequency.value = 400;
    this.whooshFilter.Q.value = 1.4;
    this.whooshGain = ctx.createGain();
    this.whooshGain.gain.value = 0;
    this.whooshPanner = ctx.createPanner();
    configurePanner(this.whooshPanner);
    this.whooshSource.connect(this.whooshFilter);
    this.whooshFilter.connect(this.whooshGain);
    this.whooshGain.connect(this.whooshPanner);
    this.whooshPanner.connect(this.chain.master);
  }

  /** True once a gesture or an XR session start unlocked audio. */
  get unlocked(): boolean {
    return this.isUnlocked;
  }

  /** Context time a sound played "now" starts at. */
  get now(): number {
    return this.context.currentTime + SCHEDULE_AHEAD;
  }

  /**
   * Resumes the context and, the first time, starts the pad (fading in) and
   * the whoosh source. Call from a user gesture or an XR session start.
   */
  unlock(): void {
    if (this.context.state === 'suspended') void this.context.resume().catch(() => undefined);
    if (this.isUnlocked) return;
    this.isUnlocked = true;
    const t = this.context.currentTime;
    for (const source of this.padSources) source.start(t);
    this.whooshSource.start(t);
    this.padGain.gain.setValueAtTime(0, t);
    this.padGain.gain.linearRampToValueAtTime(PAD_LEVEL, t + PAD_FADE_SECONDS);
  }

  /** Pause: silences the whoosh at once and suspends the context. */
  suspend(): void {
    const t = this.context.currentTime;
    this.whooshGain.gain.cancelScheduledValues(t);
    this.whooshGain.gain.setValueAtTime(0, t);
    this.whooshOn = false;
    // Unconditional (not only when 'running'): the context queues suspend and
    // resume in call order, so a quick pause/resume pair still ends running.
    if (this.context.state !== 'closed') void this.context.suspend().catch(() => undefined);
  }

  /** Resume after a pause; does nothing before unlock() (no sound before a gesture). */
  resume(): void {
    if (!this.isUnlocked || this.context.state === 'closed') return;
    void this.context.resume().catch(() => undefined);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMaster();
  }

  /** Volume 0..1 (clamped). */
  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 0));
    this.applyMaster();
  }

  /** Quiet multiplies the master level by QUIET_FACTOR. */
  setQuiet(quiet: boolean): void {
    this.quiet = quiet;
    this.applyMaster();
  }

  applySettings(settings: AudioLevelSettings): void {
    this.muted = settings.muted;
    this.volume = Math.min(1, Math.max(0, settings.volume));
    this.quiet = settings.quiet;
    this.applyMaster();
  }

  state(): AudioEngineState {
    return {
      contextState: this.context.state,
      unlocked: this.isUnlocked,
      muted: this.muted,
      volume: this.volume,
      quiet: this.quiet,
      sampleRate: this.context.sampleRate,
    };
  }

  /** A flyby bell at a world position, spatialized around the head. Returns its start time. */
  playNoteAt(midi: number, x: number, y: number, z: number): number {
    const ctx = this.context;
    const at = this.now;
    const panner = ctx.createPanner();
    configurePanner(panner);
    panner.positionX.value = x;
    panner.positionY.value = y;
    panner.positionZ.value = z;
    panner.connect(this.chain.voices);
    const source = bell(ctx, panner, midiToHz(midi), at, BELL_GAIN);
    source.addEventListener('ended', () => panner.disconnect());
    return at;
  }

  /** A non-spatial phrase bell at context time `at`. */
  playBell(midi: number, at: number): void {
    bell(this.context, this.chain.voices, midiToHz(midi), at, PHRASE_GAIN);
  }

  playChord(midis: readonly number[], at: number): void {
    successChord(this.context, this.chain.voices, midis, at);
  }

  playMiss(at: number): void {
    miss(this.context, this.chain.voices, at);
  }

  /**
   * The chord as an arpeggio: its notes rise one bell every `step` seconds
   * from `at`, then ring together as the success chord. Returns each note's
   * start time (the last entry is the closing chord).
   */
  playArpeggio(midis: readonly number[], at: number, step = ARPEGGIO_STEP): number[] {
    const times: number[] = [];
    for (let i = 0; i < midis.length; i++) {
      const t = at + i * step;
      bell(this.context, this.chain.voices, midiToHz(midis[i]), t, PHRASE_GAIN);
      times.push(t);
    }
    const chordAt = at + midis.length * step + ARPEGGIO_STEP;
    successChord(this.context, this.chain.voices, midis, chordAt);
    times.push(chordAt);
    return times;
  }

  playTick(up: boolean, at: number): void {
    tick(this.context, this.chain.voices, at, up);
  }

  /**
   * Per frame while the comet flies: speed (m/s) opens the band-pass and the
   * gain; the panner follows the comet's world position. Sets AudioParams only.
   */
  setWhoosh(speed: number, x: number, y: number, z: number): void {
    if (!this.isUnlocked) return;
    const t = this.context.currentTime;
    const norm = Math.min(1, Math.max(0, speed / WHOOSH_FULL_SPEED));
    this.whooshGain.gain.setTargetAtTime(WHOOSH_FLOOR_GAIN + (WHOOSH_MAX_GAIN - WHOOSH_FLOOR_GAIN) * norm, t, 0.06);
    this.whooshFilter.frequency.setTargetAtTime(300 + 2400 * norm, t, 0.06);
    this.whooshPanner.positionX.setTargetAtTime(x, t, 0.02);
    this.whooshPanner.positionY.setTargetAtTime(y, t, 0.02);
    this.whooshPanner.positionZ.setTargetAtTime(z, t, 0.02);
    this.whooshOn = true;
  }

  /** Fades the whoosh out (once per flight end). */
  silenceWhoosh(): void {
    if (!this.whooshOn) return;
    this.whooshGain.gain.setTargetAtTime(0, this.context.currentTime, 0.08);
    this.whooshOn = false;
  }

  private masterTarget(): number {
    return this.muted ? 0 : MASTER_LEVEL * this.volume * (this.quiet ? QUIET_FACTOR : 1);
  }

  private applyMaster(): void {
    this.chain.master.gain.setTargetAtTime(this.masterTarget(), this.context.currentTime, 0.03);
  }
}
