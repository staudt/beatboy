import { secondsPerTick } from '../domain/time';
import { TempoMap } from './tempoMap';
import type { Clock, EventSource, NoteOut, NoteSink } from './types';

export interface SchedulerOptions {
  clock: Clock;
  sink: NoteSink;
  source: EventSource;
  /** Seconds of look-ahead (default 0.12). */
  lookahead?: number;
  /** Seconds between start() and tick `fromTick` (default 0.06). */
  startDelay?: number;
  /** Notes later than this many seconds in the past are dropped (default 0.08). */
  lateTolerance?: number;
}

/**
 * Look-ahead scheduler ("A Tale of Two Clocks"). A timer calls pump() every ~25 ms;
 * everything falling inside the next `lookahead` seconds is handed to the sink with
 * an absolute audio-clock time. Sounds are never triggered from the timer itself.
 */
export class Scheduler {
  private readonly clock: Clock;
  private readonly sink: NoteSink;
  private source: EventSource;
  private readonly lookahead: number;
  private readonly startDelay: number;
  private readonly lateTolerance: number;
  private readonly map = new TempoMap();
  private readonly buf: NoteOut[] = [];
  private _playing = false;
  private _bpm = 100;
  private _scheduledUntil = 0;

  /** First tick not yet handed to the sink; nothing before it can change anymore. */
  get scheduledUntil(): number {
    return this._scheduledUntil;
  }

  constructor(opts: SchedulerOptions) {
    this.clock = opts.clock;
    this.sink = opts.sink;
    this.source = opts.source;
    this.lookahead = opts.lookahead ?? 0.12;
    this.startDelay = opts.startDelay ?? 0.06;
    this.lateTolerance = opts.lateTolerance ?? 0.08;
  }

  get playing(): boolean {
    return this._playing;
  }

  get bpm(): number {
    return this._bpm;
  }

  /** Takes effect at the next not-yet-scheduled tick (applied by the next pump). */
  setBpm(bpm: number): void {
    this._bpm = bpm;
  }

  setSource(src: EventSource): void {
    this.source = src;
  }

  start(fromTick = 0): void {
    this.map.reset(fromTick, this.clock.now() + this.startDelay, secondsPerTick(this._bpm, this.source.timeSig()));
    this._scheduledUntil = fromTick;
    this._playing = true;
    this.pump();
  }

  stop(): void {
    this._playing = false;
    this.sink.stopAll();
  }

  pump(): void {
    if (!this._playing) return;
    const now = this.clock.now();
    const spt = secondsPerTick(this._bpm, this.source.timeSig());
    if (spt !== this.map.rate) this.map.change(this._scheduledUntil, spt);

    const horizon = Math.floor(this.map.tickAt(now + this.lookahead));
    if (horizon > this._scheduledUntil) {
      const buf = this.buf;
      buf.length = 0;
      this.source.collect(this._scheduledUntil, horizon, buf);
      for (let i = 0; i < buf.length; i++) {
        const n = buf[i]!;
        const t = this.map.timeAt(n.tick + n.offsetTicks);
        if (t < now - this.lateTolerance) continue; // stale after a stall: drop, never burst
        this.sink.play(Math.max(t, now), n.sound, n.vel, n.gain);
      }
      buf.length = 0;
      this._scheduledUntil = horizon;
    }
    this.map.prune(now - 1);
  }

  tickAt(time: number): number {
    return this.map.tickAt(time);
  }

  timeAt(tick: number): number {
    return this.map.timeAt(tick);
  }

  currentTick(latency = 0): number | null {
    return this._playing ? this.map.tickAt(this.clock.now() - latency) : null;
  }
}
