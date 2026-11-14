import { PATTERN_LIMITS } from '../domain/types';

/** A gap longer than this restarts the tap sequence. */
export const TAP_RESET_MS = 2000;
/** Number of most recent intervals averaged. */
export const TAP_MAX_INTERVALS = 4;

export interface TapResult {
  /** Retained tap timestamps (ms), at most TAP_MAX_INTERVALS + 1. */
  taps: number[];
  /** Tempo derived from the taps, or null until two taps exist. */
  bpm: number | null;
}

/** Pure tap-tempo step: feed the previous taps and the new timestamp. */
export function registerTap(prev: readonly number[], now: number): TapResult {
  const last = prev[prev.length - 1];
  let taps = last !== undefined && now - last <= TAP_RESET_MS && now >= last ? [...prev, now] : [now];
  if (taps.length > TAP_MAX_INTERVALS + 1) taps = taps.slice(taps.length - (TAP_MAX_INTERVALS + 1));
  if (taps.length < 2) return { taps, bpm: null };
  const avg = ((taps[taps.length - 1] as number) - (taps[0] as number)) / (taps.length - 1);
  if (avg <= 0) return { taps, bpm: null };
  const raw = 60000 / avg;
  const bpm = Math.round(Math.min(PATTERN_LIMITS.maxBpm, Math.max(PATTERN_LIMITS.minBpm, raw)));
  return { taps, bpm };
}
