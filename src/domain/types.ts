/**
 * Core domain model shared by Beat Lab, Drum Assistant, the engine and storage.
 *
 * Timing is expressed in integer ticks (see TPQ in time.ts). Notes are stored
 * sparsely at tick positions relative to the pattern start; the step grid is
 * only a *view* over those ticks, so changing grid resolution is non-destructive.
 */

/** Instrument slots. Order here is the pad order (4×4, row-major). */
export const SOUND_IDS = [
  'kick',
  'snare',
  'sidestick',
  'clap',
  'hatClosed',
  'hatPedal',
  'hatOpen',
  'ride',
  'rideBell',
  'crash',
  'crash2',
  'tomHigh',
  'tomMid',
  'tomFloor',
  'tambourine',
  'cowbell',
] as const;

export type SoundId = (typeof SOUND_IDS)[number];

export function isSoundId(v: unknown): v is SoundId {
  return typeof v === 'string' && (SOUND_IDS as readonly string[]).includes(v);
}

/** Denominator of a time signature. */
export type BeatUnit = 2 | 4 | 8 | 16;

export interface TimeSignature {
  /** Beats per bar (numerator), 1..32. */
  num: number;
  /** Note value of one beat (denominator). */
  den: BeatUnit;
}

/** MIDI-style velocity, 1..127. Three canonical levels are used by the UI. */
export const VELOCITY = {
  ghost: 40,
  normal: 96,
  accent: 127,
} as const;

export type VelocityLevel = keyof typeof VELOCITY;

export interface NoteEvent {
  /** Position in ticks from the pattern start, 0 <= tick < patternTicks. */
  tick: number;
  /** 1..127 */
  vel: number;
}

export interface TrackMix {
  /** Linear gain multiplier, 0..1.5 (1 = unity). */
  gain: number;
  muted: boolean;
}

export type PatternKind = 'groove' | 'fill';

export interface Pattern {
  id: string;
  name: string;
  /** Free-form category used for browsing, e.g. "Rock", "Funk", "Fills". */
  category: string;
  kind: PatternKind;
  timeSig: TimeSignature;
  /** Length in bars, 1..8. */
  bars: number;
  /** Grid resolution: steps per beat (beat = 1/den note). 4 in 4/4 = 16ths. */
  stepsPerBeat: number;
  /** 0.5 = straight, up to 0.75 = hard swing. Applied to odd grid steps. */
  swing: number;
  /** Preferred/preview tempo in pulse BPM (see pulseTicks in time.ts). */
  bpm: number;
  /** Sparse note lists per sound, each sorted by tick, at most one note per tick. */
  notes: Partial<Record<SoundId, NoteEvent[]>>;
  /** Per-track mix; missing entries mean { gain: 1, muted: false }. */
  mix: Partial<Record<SoundId, TrackMix>>;
  /** Factory patterns are read-only; editing creates a copy. */
  builtIn: boolean;
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_MIX: TrackMix = { gain: 1, muted: false };

export const PATTERN_LIMITS = {
  minBars: 1,
  maxBars: 8,
  minBpm: 30,
  maxBpm: 300,
  minSwing: 0.5,
  maxSwing: 0.75,
  /** Allowed grid resolutions (steps per beat). */
  stepsPerBeat: [1, 2, 3, 4, 6, 8] as readonly number[],
} as const;
