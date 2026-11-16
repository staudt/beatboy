import type { Feel } from '../../domain/types';
import type { SoundId } from '../../domain/types';

/** Result of reading a pasted drum tab (see docs/tab-formats.md section 7). */
export interface TabImport {
  /** Not a drum tab (guitar tab, prose, nothing recognisable): no sections. */
  reject: boolean;
  /** 0..1. Clean 0.9+, noisy 0.5..0.9, rejected below 0.5. */
  confidence: number;
  song: { name: string; bpm: number | null };
  sections: TabSection[];
  /** Human-readable notes about guesses and repairs. */
  warnings: string[];
}

export interface TabSection {
  name: string;
  feel: Feel;
  /** Plays of `beat` (1..64). */
  times: number;
  /** Beatboy beat text at full grid resolution, one line. */
  beat: string;
}

/** One 4/4-ish bar after grid inference: `n` steps of one feel, sparse hits per step. */
export interface Bar {
  feel: Feel;
  n: number;
  /** Characters per bar in the source tab (before grid conversion). */
  src: number;
  /** Per step: sound -> velocity. Length n. */
  steps: Map<SoundId, number>[];
  sig: string;
  repStart?: boolean;
  repEnd?: boolean;
  /** 1 or 2: first / second ending. */
  ending?: number;
}

/** What a legend or label resolved to. */
export type InstKind =
  | 'kick'
  | 'snare'
  | 'sidestick'
  | 'clap'
  | 'hat'
  | 'hatOpenLine'
  | 'hatPedal'
  | 'crash'
  | 'crash2'
  | 'ride'
  | 'rideBell'
  | 'tomHigh'
  | 'tomMid'
  | 'tomFloor'
  | 'tambourine'
  | 'cowbell';
