import type { SoundId } from '../domain/types';
import type { KitSound } from './types';

/** First index in [from, to) where |sample| >= threshold, clamped to the array; null if none. */
export function findOnset(data: Float32Array, from: number, to: number, thresholdDb = -50): number | null {
  const lo = Math.max(0, Math.floor(from));
  const hi = Math.min(data.length, Math.ceil(to));
  const thr = 10 ** (thresholdDb / 20);
  for (let i = lo; i < hi; i++) {
    if (Math.abs(data[i]!) >= thr) return i;
  }
  return null;
}

export interface SliceRegion {
  startSample: number;
  length: number;
}

const SEARCH_BEFORE_S = 0.02;
const SEARCH_AFTER_S = 0.07;
const PREROLL_S = 0.001;
/** Onset = first sample within this many dB of the sound's peak (see sliceRegions). */
const RELATIVE_THRESHOLD_DB = -24;

function peakAbs(data: Float32Array, from: number, to: number): number {
  let p = 0;
  for (let i = Math.max(0, from); i < Math.min(data.length, to); i++) {
    const v = Math.abs(data[i]!);
    if (v > p) p = v;
  }
  return p;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Locate each sound's true start in the decoded sprite, compensating for MP3 encoder delay.
 * Sounds whose onset can't be found use the declared start shifted by the median measured shift.
 */
export function sliceRegions(
  data: Float32Array,
  sampleRate: number,
  sounds: Partial<Record<SoundId, KitSound>>,
  thresholdDb = -50,
): Partial<Record<SoundId, SliceRegion>> {
  const pre = Math.round(PREROLL_S * sampleRate);
  const entries = (Object.entries(sounds) as [SoundId, KitSound][]).filter(([, s]) => !!s);
  const found = new Map<SoundId, number>(); // onset sample
  const shifts: number[] = [];
  const declared = new Map<SoundId, number>();
  for (const [id, s] of entries) {
    const d = Math.round(s.start * sampleRate);
    declared.set(id, d);
    const from = d - Math.round(SEARCH_BEFORE_S * sampleRate);
    const to = d + Math.round(SEARCH_AFTER_S * sampleRate);
    // Threshold relative to the sound's own peak: MP3 pre-echo sits ~30–45 dB below the
    // transient and would otherwise be detected a few ms early. Never below `thresholdDb`.
    const peak = peakAbs(data, from, d + Math.round(Math.min(s.duration, 0.15) * sampleRate));
    const relDb = peak > 0 ? 20 * Math.log10(peak) + RELATIVE_THRESHOLD_DB : thresholdDb;
    const on = findOnset(data, from, to, Math.max(thresholdDb, relDb));
    if (on !== null) {
      found.set(id, on);
      shifts.push(on - d);
    }
  }
  const medShift = Math.round(median(shifts));
  const out: Partial<Record<SoundId, SliceRegion>> = {};
  for (const [id, s] of entries) {
    const d = declared.get(id)!;
    const on = found.get(id);
    const start = Math.min(Math.max(0, on !== undefined ? on - pre : d + medShift), data.length);
    const length = Math.max(0, Math.min(Math.round(s.duration * sampleRate), data.length - start));
    out[id] = { startSample: start, length };
  }
  return out;
}
