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
import { toBeatGrid } from '../domain/patternOps';
import { SECTION_KINDS, SECTION_LABELS, SONG_LIMITS, type Section, type SectionKind, type Song } from '../domain/song';
import { PATTERN_SCHEMA_VERSION, SONG_SCHEMA_VERSION } from './db';

type Rec = Record<string, unknown>;

/** Migration steps keyed by the schemaVersion they upgrade FROM. */
const STEPS: Record<number, (r: Rec) => Rec> = {
  // v1 -> v2: any meter becomes the beats × steps model (den 4, 1..4 steps per beat).
  1: (r) => {
    const legacy = validatePattern(r, 1);
    return legacy ? (toBeatGrid(legacy) as unknown as Rec) : r;
  },
  // v2 -> v3: the grid is always 16ths (4) or triplets (3): quarter/8th grids become 4 (ticks are already
  // aligned, nothing moves). Bars are flattened into beats: `bars: b, num: k` -> `bars: 1, num: k * b`
  // (clamped to 32 beats, dropping notes beyond), which keeps every tick unchanged.
  2: (r) => {
    let out: Rec = r.stepsPerBeat === 1 || r.stepsPerBeat === 2 ? { ...r, stepsPerBeat: 4 } : r;
    const ts = out.timeSig;
    if (isRec(ts) && isInt(ts.num) && isInt(out.bars) && out.bars >= 1 && ts.den === 4) {
      const beats = clamp(ts.num * out.bars, PATTERN_LIMITS.minBeats, PATTERN_LIMITS.maxBeats);
      out = { ...out, bars: 1, timeSig: { ...ts, num: beats } };
    }
    return out;
  },
};

const V2_STEPS: readonly number[] = [1, 2, 3, 4];
const LEGACY_STEPS: readonly number[] = [1, 2, 3, 4, 6, 8];
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

/** Validates a record. v1 (legacy) accepts any meter/grid; v2 requires den 4; v3 (current) also requires 3 or 4 steps per beat and a single bar of 1..32 beats. */
export function validatePattern(raw: unknown, version: number = PATTERN_SCHEMA_VERSION): Pattern | null {
  if (!isRec(raw)) return null;
  if (typeof raw.id !== 'string' || raw.id === '') return null;

  const ts = raw.timeSig;
  if (!isRec(ts)) return null;
  if (!isInt(ts.num) || ts.num < 1 || ts.num > 32) return null;
  if (!isInt(ts.den) || ![2, 4, 8, 16].includes(ts.den)) return null;
  const timeSig = { num: ts.num, den: ts.den as BeatUnit };
  const legacy = version < 2;
  if (!legacy && (ts.den !== 4 || ts.num > PATTERN_LIMITS.maxBeats)) return null;
  if (version >= 3 && raw.bars !== 1) return null;

  if (!isInt(raw.bars) || raw.bars < PATTERN_LIMITS.minBars || raw.bars > PATTERN_LIMITS.maxBars) return null;
  if (!isInt(raw.stepsPerBeat) || !(version < 2 ? LEGACY_STEPS : version === 2 ? V2_STEPS : PATTERN_LIMITS.stepsPerBeat).includes(raw.stepsPerBeat)) return null;
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

// ───────────────────────── songs ─────────────────────────

/** Song migration steps keyed by the schemaVersion they upgrade FROM (none yet: v1 is current). */
const SONG_STEPS: Record<number, (r: Rec) => Rec> = {};

export function migrateSong(raw: unknown): Song | null {
  if (!isRec(raw)) return null;
  const sv = raw.schemaVersion ?? 1;
  if (!isInt(sv) || sv < 1 || sv > SONG_SCHEMA_VERSION) return null; // unknown/future
  let rec: Rec = raw;
  for (let v = sv; v < SONG_SCHEMA_VERSION; v++) {
    const step = SONG_STEPS[v];
    if (!step) return null;
    rec = step(rec);
  }
  return validateSong(rec);
}

const clampRound = (v: unknown, lo: number, hi: number, fallback: number) =>
  isFiniteNum(v) ? clamp(Math.round(v), lo, hi) : fallback;

/** Repairs what is reasonable (clamps, drops broken sections, fixes kinds/names); rejects non-objects and records without an id. */
export function validateSong(raw: unknown): Song | null {
  if (!isRec(raw)) return null;
  if (typeof raw.id !== 'string' || raw.id === '') return null;

  const sections: Section[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.sections)) {
    for (const s of raw.sections) {
      if (sections.length >= SONG_LIMITS.maxSections) break;
      if (!isRec(s)) continue;
      if (typeof s.id !== 'string' || s.id === '') continue;
      if (typeof s.patternId !== 'string' || s.patternId === '') continue;
      const kind: SectionKind = (SECTION_KINDS as readonly unknown[]).includes(s.kind) ? (s.kind as SectionKind) : 'custom';
      const f = isRec(s.fill) ? s.fill : {};
      let id = s.id;
      if (seen.has(id)) id = crypto.randomUUID();
      seen.add(id);
      sections.push({
        id,
        kind,
        name: cleanString(s.name, SECTION_LABELS[kind]),
        patternId: s.patternId,
        bars: clampRound(s.bars, SONG_LIMITS.minBars, SONG_LIMITS.maxBars, 4),
        fill: {
          enabled: f.enabled === true,
          patternId: typeof f.patternId === 'string' && f.patternId !== '' ? f.patternId : null,
        },
        loop: s.loop === true,
      });
    }
  }

  return {
    id: raw.id,
    name: cleanString(raw.name, 'Untitled song'),
    bpm: clampRound(raw.bpm, 30, 300, 100),
    beatsPerBar: clampRound(raw.beatsPerBar, SONG_LIMITS.minBeatsPerBar, SONG_LIMITS.maxBeatsPerBar, 4),
    fillId: typeof raw.fillId === 'string' && raw.fillId !== '' ? raw.fillId : null,
    sections,
    createdAt: isFiniteNum(raw.createdAt) ? raw.createdAt : 0,
    updatedAt: isFiniteNum(raw.updatedAt) ? raw.updatedAt : 0,
  };
}
