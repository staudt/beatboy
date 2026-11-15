import type { SoundId, TimeSignature } from '../domain/types';

/** What a sink can play: a kit sound or a synthesized metronome click. */
export type SinkSound = SoundId | 'click' | 'clickAccent';

/**
 * A note produced by an EventSource for the scheduler.
 * `tick` is the absolute transport tick of the note's *grid* position and is what
 * windowing uses; `offsetTicks` (e.g. swing) shifts only the playback time.
 */
export interface NoteOut {
  tick: number;
  offsetTicks: number;
  sound: SinkSound;
  /** 1..127 */
  vel: number;
  /** Linear track gain (pattern mix), already accounting for mute (muted notes are not emitted). */
  gain: number;
}

/**
 * Produces notes for a half-open window of absolute transport ticks [fromTick, toTick).
 * Must emit every note with fromTick <= tick < toTick exactly once across consecutive,
 * contiguous windows. Implementations may read live (mutable) state, so edits made while
 * playing become audible as soon as their ticks enter the look-ahead window.
 */
export interface EventSource {
  collect(fromTick: number, toTick: number, out: NoteOut[]): void;
  /** Time signature currently in effect (used for tempo → seconds conversion). */
  timeSig(): TimeSignature;
}

/** Monotonic audio clock in seconds (AudioContext.currentTime in the browser). */
export interface Clock {
  now(): number;
}

/** Receives fully resolved notes with absolute audio times. */
export interface NoteSink {
  play(time: number, sound: SinkSound, vel: number, gain: number): void;
  /** Silence everything (short fade to avoid clicks) and cancel notes scheduled in the future. */
  stopAll(): void;
}

/** A tempo segment of the transport's tempo map. */
export interface TempoSegment {
  /** Absolute tick where this segment starts. */
  tick: number;
  /** Audio time (s) at `tick`. */
  time: number;
  secondsPerTick: number;
}
