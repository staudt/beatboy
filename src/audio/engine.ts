import type { Pattern, SoundId } from '../domain/types';
import { VELOCITY } from '../domain/types';
import { SongSource, type SongConfig, type SongInfo } from '../engine/songSource';
import type { SongAction } from '../domain/song';
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

export type EngineMode = 'idle' | 'lab' | 'song';

const DEBUG = import.meta.env.DEV || import.meta.env.MODE === 'test';
const LOG_MAX = 500;
/** Seconds after the final hit before a song stops itself (cymbal ring-out). */
const SONG_RING_OUT = 2.5;

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
  private song: SongSource | null = null;
  private songConfig: (() => SongConfig) | null = null;

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
    this.ticker = createTicker(25, () => {
      this.scheduler.pump();
      this.checkSongEnd();
    });
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

  /** Start looping a pattern, or (if already playing, in lab or song mode) switch to it without restarting the transport. */
  async playPattern(getPattern: () => Pattern): Promise<void> {
    const ready = this.ensureReady();
    const source = new PatternLoopSource(getPattern);
    await ready;
    this.song = null;
    this.songConfig = null;
    if (this.scheduler.playing) {
      // Already playing (lab loop or song): swap the source, keep the transport position (the loop is
      // indexed by absolute tick, so the phase stays aligned).
      this.scheduler.setSource(source);
      const changed = this._mode !== 'lab';
      this._mode = 'lab';
      if (changed) this.emit();
      return;
    }
    this.scheduler.setSource(source);
    this.scheduler.start(0);
    this.ticker.start();
    this._mode = 'lab';
    this.emit();
  }

  /**
   * Start a song (sections + click + count-in). Call from a user gesture. Already in song mode: just swaps the
   * config getter. From other modes restarts cleanly at the song's start tick (no count-in if `countIn: false`).
   * The engine stops by itself 2.5 s after the song's final hit.
   */
  async playSong(getConfig: () => SongConfig, opts: { startSection?: number; countIn?: boolean } = {}): Promise<void> {
    await this.ensureReady();
    this.songConfig = getConfig;
    if (this.scheduler.playing && this._mode === 'song' && this.song) return;
    if (this.scheduler.playing) {
      this.ticker.stop();
      this.scheduler.stop();
    }
    const source = new SongSource(() => this.songConfig!(), { startSection: opts.startSection });
    this.song = source;
    this.scheduler.setSource(source);
    this.scheduler.start(opts.countIn === false ? 0 : source.startTick());
    this.ticker.start();
    this._mode = 'song';
    this.emit();
  }

  /** Queue a live song action (applied just in time at an unscheduled bar boundary). */
  songAct(action: SongAction): void {
    if (!this.song || !this.scheduler.playing) return;
    this.song.act(action, this.scheduler.scheduledUntil);
    this.emit();
  }

  /** Arrangement state at the audible tick; null unless a song is playing. */
  songInfo(): SongInfo | null {
    const tick = this.currentTick();
    if (!this.song || tick === null || this._mode !== 'song') return null;
    return this.song.infoAt(tick);
  }

  private checkSongEnd(): void {
    const s = this.song;
    if (!s || this._mode !== 'song' || !this.scheduler.playing || s.ended === null) return;
    const c = getAudioContext();
    const audible = c.currentTime - ((c.outputLatency ?? 0) + (c.baseLatency ?? 0));
    if (audible >= this.scheduler.timeAt(s.ended) + SONG_RING_OUT) this.stop();
  }

  stop(): void {
    if (!this.scheduler.playing) return;
    this.ticker.stop();
    this.scheduler.stop();
    this.song = null;
    this.songConfig = null;
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
