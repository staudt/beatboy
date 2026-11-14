import type { Pattern, SoundId } from '../domain/types';
import { VELOCITY } from '../domain/types';
import { PatternLoopSource } from '../engine/patternSource';
import { Scheduler } from '../engine/scheduler';
import { createTicker, type Ticker } from '../engine/timer';
import type { NoteSink } from '../engine/types';
import { ensureRunning, getAudioContext, onAudioStateChange } from './context';
import { loadKit } from './kitLoader';
import { Sampler } from './sampler';

export interface ScheduledLogEntry {
  time: number;
  tick: number;
  sound: SoundId;
  vel: number;
}

const DEBUG = import.meta.env.DEV || import.meta.env.MODE === 'test';
const LOG_MAX = 500;

export class DrumEngine {
  private readonly kitUrl: string;
  private sampler: Sampler | null = null;
  private kitPromise: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly scheduler: Scheduler;
  private readonly ticker: Ticker;
  readonly scheduledLog: ScheduledLogEntry[] = [];
  kitReady = false;

  constructor(opts: { kitUrl?: string } = {}) {
    this.kitUrl = opts.kitUrl ?? `${import.meta.env.BASE_URL}kits/virtuosity/kit.json`;
    const sink: NoteSink = {
      play: (time, sound, vel, gain) => {
        if (DEBUG) {
          this.scheduledLog.push({ time, tick: this.scheduler.tickAt(time), sound, vel });
          if (this.scheduledLog.length > LOG_MAX) this.scheduledLog.splice(0, this.scheduledLog.length - LOG_MAX);
        }
        this.sampler?.play(time, sound, vel, gain);
      },
      stopAll: () => this.sampler?.stopAll(),
    };
    this.scheduler = new Scheduler({
      clock: { now: () => getAudioContext().currentTime },
      sink,
      source: new PatternLoopSource(() => {
        throw new Error('no pattern');
      }),
    });
    this.ticker = createTicker(25, () => this.scheduler.pump());
    onAudioStateChange(() => this.emit());
  }

  get playing(): boolean {
    return this.scheduler.playing;
  }

  get bpm(): number {
    return this.scheduler.bpm;
  }

  /** Call from a user gesture. Cached; safe to call repeatedly. */
  ensureReady(): Promise<void> {
    const running = ensureRunning(); // synchronous part keeps the gesture
    if (!this.kitPromise) {
      this.kitPromise = running
        .then((ctx) => loadKit(ctx, this.kitUrl))
        .then((kit) => {
          const s = new Sampler(getAudioContext());
          s.setKit(kit);
          this.sampler = s;
          this.kitReady = true;
          this.emit();
        })
        .catch((e) => {
          this.kitPromise = null; // allow retry
          throw e;
        });
    }
    return Promise.all([running, this.kitPromise]).then(() => this.emit());
  }

  /** Start looping a pattern, or (if already playing) switch to it without restarting the transport. */
  async playPattern(getPattern: () => Pattern): Promise<void> {
    const ready = this.ensureReady();
    const source = new PatternLoopSource(getPattern);
    await ready;
    if (this.scheduler.playing) {
      this.scheduler.setSource(source);
      return;
    }
    this.scheduler.setSource(source);
    this.scheduler.start(0);
    this.ticker.start();
    this.emit();
  }

  stop(): void {
    if (!this.scheduler.playing) return;
    this.ticker.stop();
    this.scheduler.stop();
    this.emit();
  }

  setBpm(bpm: number): void {
    this.scheduler.setBpm(bpm);
    this.emit();
  }

  audition(sound: SoundId, vel: number = VELOCITY.normal): void {
    const ready = this.ensureReady();
    if (this.sampler) {
      this.sampler.audition(sound, vel);
      return;
    }
    ready.then(() => this.sampler?.audition(sound, vel)).catch(() => {});
  }

  currentTick(): number | null {
    if (!this.scheduler.playing) return null;
    const c = getAudioContext();
    const latency = (c.outputLatency ?? 0) + (c.baseLatency ?? 0);
    return this.scheduler.currentTick(latency);
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }
}

export const engine = new DrumEngine();

declare global {
  interface Window {
    __beatboy?: { engine: DrumEngine; scheduledLog: ScheduledLogEntry[] };
  }
}

if (DEBUG && typeof window !== 'undefined') {
  window.__beatboy = { engine, scheduledLog: engine.scheduledLog };
}
