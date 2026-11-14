import {
  isSoundId,
  PATTERN_LIMITS,
  type BeatUnit,
  type NoteEvent,
  type Pattern,
  type SoundId,
  type TrackMix,
} from '../domain/types';
import { barTicks } from '../domain/time';
import { PATTERN_SCHEMA_VERSION } from './db';

type Rec = Record<string, unknown>;

/** Migration steps keyed by the schemaVersion they upgrade FROM. */
const STEPS: Record<number, (r: Rec) => Rec> = {
  1: (r) => r, // v1 -> v2 placeholder (identity until v2 exists)
};

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function migratePattern(raw: unknown): Pattern | null {
  if (!isRec(raw)) return null;
  const sv = raw.schemaVersion ?? 1;
  if (!isInt(sv) || sv < 1 || sv > PATTERN_SCHEMA_VERSION) return null; // unknown/future
  let rec: Rec = raw;
  for (let v = sv; v < PATTERN_SCHEMA_VERSION; v++) {
    const step = STEPS[v];
    if (!step) return null;
    rec = step(rec);
  }
  return validatePattern(rec);
}

function cleanString(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const t = v.trim();
  return t || fallback;
}

export function validatePattern(raw: unknown): Pattern | null {
  if (!isRec(raw)) return null;
  if (typeof raw.id !== 'string' || raw.id === '') return null;

  const ts = raw.timeSig;
  if (!isRec(ts)) return null;
  if (!isInt(ts.num) || ts.num < 1 || ts.num > 32) return null;
  if (!isInt(ts.den) || ![2, 4, 8, 16].includes(ts.den)) return null;
  const timeSig = { num: ts.num, den: ts.den as BeatUnit };

  if (!isInt(raw.bars) || raw.bars < PATTERN_LIMITS.minBars || raw.bars > PATTERN_LIMITS.maxBars) return null;
  if (!isInt(raw.stepsPerBeat) || !PATTERN_LIMITS.stepsPerBeat.includes(raw.stepsPerBeat)) return null;
  if (!isFiniteNum(raw.swing) || !isFiniteNum(raw.bpm)) return null;
  if (!isFiniteNum(raw.createdAt) || !isFiniteNum(raw.updatedAt)) return null;
  if (typeof raw.builtIn !== 'boolean') return null;
  if (raw.kind !== 'groove' && raw.kind !== 'fill') return null;
  if (!isRec(raw.notes)) return null;

  const bars = raw.bars;
  const maxTick = barTicks(timeSig) * bars;

  const notes: Pattern['notes'] = {};
  for (const [key, list] of Object.entries(raw.notes)) {
    if (!isSoundId(key) || !Array.isArray(list)) continue;
    const byTick = new Map<number, number>();
    for (const n of list) {
      if (!isRec(n)) continue;
      if (!isInt(n.tick) || n.tick < 0 || n.tick >= maxTick) continue;
      if (!isInt(n.vel) || n.vel < 1 || n.vel > 127) continue;
      byTick.set(n.tick, n.vel); // later duplicate wins
    }
    const out: NoteEvent[] = [...byTick.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([tick, vel]) => ({ tick, vel }));
    notes[key as SoundId] = out;
  }

  const mix: Pattern['mix'] = {};
  if (isRec(raw.mix)) {
    for (const [key, m] of Object.entries(raw.mix)) {
      if (!isSoundId(key) || !isRec(m)) continue;
      if (!isFiniteNum(m.gain) || m.gain < 0 || m.gain > 1.5 || typeof m.muted !== 'boolean') continue;
      const t: TrackMix = { gain: m.gain, muted: m.muted };
      mix[key as SoundId] = t;
    }
  }

  return {
    id: raw.id,
    name: cleanString(raw.name, 'Untitled'),
    category: cleanString(raw.category, 'My beats'),
    kind: raw.kind,
    timeSig,
    bars,
    stepsPerBeat: raw.stepsPerBeat,
    swing: clamp(raw.swing, PATTERN_LIMITS.minSwing, PATTERN_LIMITS.maxSwing),
    bpm: clamp(raw.bpm, PATTERN_LIMITS.minBpm, PATTERN_LIMITS.maxBpm),
    notes,
    mix,
    builtIn: raw.builtIn,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}
