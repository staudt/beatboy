import type { Pattern, SoundId } from '../domain/types';
import { TPQ } from '../domain/time';
import { GrooveSource, type FillPhase, type FillPlan, type GrooveConfig } from '../engine/grooveSource';
import { VELOCITY } from '../domain/types';
import { PatternLoopSource } from '../engine/patternSource';
import { Scheduler } from '../engine/scheduler';
import { createTicker, type Ticker } from '../engine/timer';
import type { NoteSink, SinkSound } from '../engine/types';
import { ensureRunning, getAudioContext, onAudioStateChange } from './context';
import { loadKit } from './kitLoader';
import { Sampler } from './sampler';

export interface ScheduledLogEntry {
  time: number;
  tick: number;
  sound: SinkSound;
  vel: number;
}

export type EngineMode = 'idle' | 'lab' | 'groove';

export interface BeatInfo {
  tick: number;
  /** Bar index (0 = first bar after the count-in; negative during the count-in). */
  bar: number;
  /** 0-based beat within the bar. */
  beat: number;
  /** Beats remaining in the count-in (e.g. 4,3,2,1), else null. */
  countIn: number | null;
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
  private _mode: EngineMode = 'idle';
  private groove: GrooveSource | null = null;
  private grooveConfig: (() => GrooveConfig) | null = null;

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

  get mode(): EngineMode {
    return this._mode;
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
    if (this.scheduler.playing && this._mode === 'groove') {
      // leaving groove mode: restart cleanly from tick 0
      this.ticker.stop();
      this.scheduler.stop();
    }
    this.groove = null;
    if (this.scheduler.playing) {
      this.scheduler.setSource(source);
      this._mode = 'lab';
      return;
    }
    this.scheduler.setSource(source);
    this.scheduler.start(0);
    this.ticker.start();
    this._mode = 'lab';
    this.emit();
  }

  /**
   * Start the Drum Assistant groove (pattern + click + count-in + fills). Call from a user gesture.
   * Already playing a groove: just swaps the config getter (no restart). Playing from Beat Lab: restarts
   * with the count-in.
   */
  async playGroove(getConfig: () => GrooveConfig): Promise<void> {
    const ready = this.ensureReady();
    await ready;
    this.grooveConfig = getConfig;
    if (this.scheduler.playing && this._mode === 'groove' && this.groove) return;
    if (this.scheduler.playing) {
      this.ticker.stop();
      this.scheduler.stop();
    }
    const source = new GrooveSource(() => this.grooveConfig!());
    this.groove = source;
    this.scheduler.setSource(source);
    this.scheduler.start(source.startTick());
    this.ticker.start();
    this._mode = 'groove';
    this.emit();
  }

  /** Plan a fill at the next beat boundary (see GrooveSource.triggerFill). */
  triggerFill(): FillPlan | null {
    if (!this.groove || !this.scheduler.playing) return null;
    const plan = this.groove.triggerFill(this.scheduler.scheduledUntil);
    this.emit();
    return plan;
  }

  /** Fill phase at the currently audible tick. */
  fillPhase(): FillPhase {
    const tick = this.currentTick();
    if (!this.groove || tick === null) return 'none';
    return this.groove.fillPhase(tick);
  }

  /** Bar/beat position at the audible tick, for the groove UI; null unless a groove is playing. */
  beatInfo(): BeatInfo | null {
    const tick = this.currentTick();
    if (!this.groove || tick === null || this._mode !== 'groove') return null;
    const bpb = this.groove.timeSig().num;
    const barTicks = bpb * TPQ;
    const bar = Math.floor(tick / barTicks);
    const beat = Math.floor((tick - bar * barTicks) / TPQ);
    const countIn = tick < 0 ? Math.min(Math.ceil(-tick / TPQ), 99) : null;
    return { tick, bar, beat, countIn };
  }

  stop(): void {
    if (!this.scheduler.playing) return;
    this.ticker.stop();
    this.scheduler.stop();
    this.groove?.reset();
    this.groove = null;
    this._mode = 'idle';
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
