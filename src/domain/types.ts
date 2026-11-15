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

/** What the user picks: 4 squares per beat (straight) or 3 (triplet). */
export type Feel = 'straight' | 'triplet';

export type PatternKind = 'groove' | 'fill';

export interface Pattern {
  id: string;
  name: string;
  /** Free-form category used for browsing, e.g. "Rock", "Funk", "Fills". */
  category: string;
  kind: PatternKind;
  /**
   * Engine-level meter. The product model is "beats × steps": every pattern created by the app has
   * `den === 4` and `num` = beats per bar. (Legacy meters are converted by `toBeatGrid`.)
   */
  timeSig: TimeSignature;
  /** Length in bars. Beat Lab patterns always use 1 bar of `timeSig.num` beats. */
  bars: number;
  /** Grid resolution: steps per beat, 4 (straight 16ths) or 3 (triplet feel). */
  stepsPerBeat: number;
  /** 8th-note swing: where the "&" lands in the beat. 0.5 = straight, 0.67 = shuffle, 0.75 = hard. Ignored in triplet feel. */
  swing: number;
  /** Preferred/preview tempo in pulse BPM (see pulseTicks in time.ts). */
  bpm: number;
  /** Sparse note lists per sound, each sorted by tick, at most one note per tick. */
  notes: Partial<Record<SoundId, NoteEvent[]>>;
  /** Per-track mix; missing entries mean { gain: 1, muted: false }. */
  mix: Partial<Record<SoundId, TrackMix>>;
  /** Factory patterns are read-only; editing creates a copy. */
  builtIn: boolean;
  /**
   * Song-local beat: owned by one song (created by typing beat text in a section). Hidden from the groove library
   * pickers and the Beat Editor's list; otherwise a normal user pattern. Cleared by "Save as groove".
   */
  ownerSongId?: string;
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_MIX: TrackMix = { gain: 1, muted: false };

export const PATTERN_LIMITS = {
  /** Total beats in the loop (the UI "BEATS" stepper): a pattern is one bar of N beats. */
  minBeats: 1,
  maxBeats: 32,
  /** Bars are kept for the engine/songs; Beat Lab patterns always have exactly 1. */
  minBars: 1,
  maxBars: 8,
  minBpm: 30,
  maxBpm: 300,
  minSwing: 0.5,
  maxSwing: 0.75,
  /** Allowed grid resolutions (steps per beat): 3 = triplet feel, 4 = straight (16ths). */
  stepsPerBeat: [3, 4] as readonly number[],
} as const;
