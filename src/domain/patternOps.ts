import {
  DEFAULT_MIX,
  PATTERN_LIMITS,
  SOUND_IDS,
  VELOCITY,
  type Feel,
  type NoteEvent,
  type Pattern,
  type SoundId,
  type TimeSignature,
  type TrackMix,
  type VelocityLevel,
} from './types';
import { barTicks, beatTicks, patternSteps, patternTicks, pulsesPerBar, pulseTicks, stepTicks, TPQ } from './time';

type Notes = Partial<Record<SoundId, NoteEvent[]>>;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function cloneNotes(notes: Notes): Notes {
  const out: Notes = {};
  for (const id of SOUND_IDS) {
    const arr = notes[id];
    if (arr && arr.length > 0) out[id] = arr.map((n) => ({ tick: n.tick, vel: n.vel }));
  }
  return out;
}

function cloneMix(mix: Pattern['mix']): Pattern['mix'] {
  const out: Pattern['mix'] = {};
  for (const id of SOUND_IDS) {
    const m = mix[id];
    if (m) out[id] = { ...m };
  }
  return out;
}

function touch(p: Pattern, changes: Partial<Pattern>, now: number): Pattern {
  return { ...p, ...changes, updatedAt: now };
}

export function createPattern(init: Partial<Pattern> = {}, now: number = Date.now()): Pattern {
  return {
    id: crypto.randomUUID(),
    name: 'New beat',
    category: 'My beats',
    kind: 'groove',
    timeSig: { num: 4, den: 4 },
    bars: 1,
    stepsPerBeat: 4,
    swing: 0.5,
    bpm: 100,
    notes: {},
    mix: {},
    builtIn: false,
    createdAt: now,
    updatedAt: now,
    ...init,
  };
}

export function velocityLevel(vel: number): VelocityLevel {
  if (vel < 64) return 'ghost';
  if (vel < 112) return 'normal';
  return 'accent';
}

export function getStep(p: Pattern, sound: SoundId, step: number): number {
  const tick = step * stepTicks(p.timeSig, p.stepsPerBeat);
  return p.notes[sound]?.find((n) => n.tick === tick)?.vel ?? 0;
}

export function setStep(p: Pattern, sound: SoundId, step: number, vel: number, now: number = Date.now()): Pattern {
  if (!Number.isInteger(step) || step < 0 || step >= patternSteps(p)) return p;
  const tick = step * stepTicks(p.timeSig, p.stepsPerBeat);
  const others = (p.notes[sound] ?? []).filter((n) => n.tick !== tick).map((n) => ({ ...n }));
  if (vel > 0) {
    others.push({ tick, vel: clamp(Math.round(vel), 1, 127) });
    others.sort((a, b) => a.tick - b.tick);
  }
  const notes = cloneNotes(p.notes);
  if (others.length > 0) notes[sound] = others;
  else delete notes[sound];
  return touch(p, { notes }, now);
}

export function cycleStep(p: Pattern, sound: SoundId, step: number, now: number = Date.now()): Pattern {
  const cur = getStep(p, sound, step);
  let next: number;
  if (cur === 0) next = VELOCITY.normal;
  else {
    const lvl = velocityLevel(cur);
    next = lvl === 'normal' ? VELOCITY.accent : lvl === 'accent' ? VELOCITY.ghost : 0;
  }
  return setStep(p, sound, step, next, now);
}

/**
 * Re-maps every note when the bar length changes. Notes are stored as absolute ticks over ALL bars, so
 * each `(bar, tickInBar)` becomes `bar * newBarTicks + round(tickInBar * scale)`; notes that no longer
 * fit inside their bar are dropped.
 */
function remapBars(notes: Notes, oldBar: number, newBar: number, bars: number, scale = 1): Notes {
  const out: Notes = {};
  for (const id of SOUND_IDS) {
    const list: NoteEvent[] = [];
    for (const n of notes[id] ?? []) {
      const bar = Math.floor(n.tick / oldBar);
      if (bar >= bars) continue;
      const inBar = Math.round((n.tick - bar * oldBar) * scale);
      if (inBar >= newBar) continue;
      list.push({ tick: bar * newBar + inBar, vel: n.vel });
    }
    list.sort((a, b) => a.tick - b.tick);
    if (list.length > 0) out[id] = list;
  }
  return out;
}

/** Snap to the nearest multiple of `step`, halves going to the earlier position. */
function snapDown(tick: number, step: number): number {
  const q = Math.floor(tick / step);
  const r = tick - q * step;
  return (r * 2 > step ? q + 1 : q) * step;
}

/**
 * Snaps every note to the grid of `step` ticks. Collisions per sound keep the loudest velocity and
 * anything landing at/after `end` is dropped.
 */
function quantizeNotes(notes: Notes, step: number, end: number): Notes {
  const out: Notes = {};
  for (const id of SOUND_IDS) {
    const byTick = new Map<number, number>();
    for (const n of notes[id] ?? []) {
      const t = snapDown(n.tick, step);
      if (t >= end) continue;
      byTick.set(t, Math.max(byTick.get(t) ?? 0, n.vel));
    }
    if (byTick.size > 0) {
      out[id] = [...byTick.entries()].sort((a, b) => a[0] - b[0]).map(([tick, vel]) => ({ tick, vel }));
    }
  }
  return out;
}

/** Fields describing a loop of `steps` squares: `timeSig.num` = beats covering it, `steps` kept only for partial beats. */
function lengthFields(steps: number, spb: number): Pick<Pattern, 'timeSig' | 'bars'> & { steps?: number } {
  return {
    timeSig: { num: Math.ceil(steps / spb), den: 4 },
    bars: 1,
    ...(steps % spb === 0 ? {} : { steps }),
  };
}

/** `p` without its (partial-beat) `steps`: the rest of the fields are untouched. */
function withoutSteps(p: Pattern): Pattern {
  const { steps: _steps, ...rest } = p;
  return rest;
}

/** Longest loop in steps for a grid of `spb` squares per beat. */
export const maxStepsFor = (spb: number): number => PATTERN_LIMITS.maxBeats * spb;

/**
 * Length of the loop in steps (grid squares, 1 .. 32 beats' worth): any number, not just whole beats. `bars` becomes 1
 * (a multi-bar pattern is flattened with every tick unchanged). Shrinking drops the notes beyond the new end.
 */
export function setSteps(p: Pattern, steps: number, now: number = Date.now()): Pattern {
  const spb = p.stepsPerBeat;
  const n = clamp(Math.round(steps), PATTERN_LIMITS.minSteps, maxStepsFor(spb));
  const end = n * stepTicks({ num: 1, den: 4 }, spb);
  const notes: Notes = {};
  for (const id of SOUND_IDS) {
    const out = (p.notes[id] ?? []).filter((x) => x.tick < end).map((x) => ({ tick: x.tick, vel: x.vel }));
    if (out.length > 0) notes[id] = out;
  }
  return touch(withoutSteps(p), { ...lengthFields(n, spb), notes }, now);
}

/** Length of the loop in whole beats (1..32). See `setSteps`. */
export function setBeats(p: Pattern, beats: number, now: number = Date.now()): Pattern {
  const n = clamp(Math.round(beats), PATTERN_LIMITS.minBeats, PATTERN_LIMITS.maxBeats);
  return setSteps(p, n * p.stepsPerBeat, now);
}

/** Appends one beat's worth of empty squares (4 straight / 3 triplet), up to 32 beats' worth. Returns `p` when already full. */
export function addBeat(p: Pattern, now: number = Date.now()): Pattern {
  const cur = patternSteps(p);
  const next = Math.min(maxStepsFor(p.stepsPerBeat), cur + p.stepsPerBeat);
  return next === cur ? p : setSteps(p, next, now);
}

/** Removes the last beat's worth of squares (4 / 3) and their notes; never below 1 step. Returns `p` at 1 step. */
export function removeLastBeat(p: Pattern, now: number = Date.now()): Pattern {
  const cur = patternSteps(p);
  const next = Math.max(PATTERN_LIMITS.minSteps, cur - p.stepsPerBeat);
  return next === cur ? p : setSteps(p, next, now);
}

/** True when the squares `removeLastBeat` would remove contain any note (used to confirm before removing). */
export function lastBeatHasNotes(p: Pattern): boolean {
  const end = patternTicks(p);
  const start = Math.max(PATTERN_LIMITS.minSteps, patternSteps(p) - p.stepsPerBeat) * stepTicks(p.timeSig, p.stepsPerBeat);
  return SOUND_IDS.some((id) => (p.notes[id] ?? []).some((n) => n.tick >= start && n.tick < end));
}

/**
 * Steps per beat: 4 (straight 16ths) or 3 (triplets). A loop of whole beats keeps its beats; a partial one converts
 * proportionally (rounded, min 1 step). Notes are quantized to the new grid so none are ever invisible: nearest step
 * (ties go earlier), collisions keep the loudest velocity.
 */
export function setStepsPerBeat(p: Pattern, n: number, now: number = Date.now()): Pattern {
  if (!PATTERN_LIMITS.stepsPerBeat.includes(n)) return p;
  const old = p.stepsPerBeat;
  const cur = patternSteps(p);
  const steps =
    cur % old === 0
      ? (cur / old) * n
      : clamp(Math.round((cur * n) / old), PATTERN_LIMITS.minSteps, maxStepsFor(n));
  const notes = quantizeNotes(p.notes, stepTicks({ num: 1, den: 4 }, n), steps * stepTicks({ num: 1, den: 4 }, n));
  return touch(withoutSteps(p), { stepsPerBeat: n, ...lengthFields(steps, n), notes }, now);
}

export function feelOf(p: Pick<Pattern, 'stepsPerBeat'>): Feel {
  return p.stepsPerBeat === 3 ? 'triplet' : 'straight';
}

/** Straight = 4 squares per beat, triplet = 3. Quantizes notes (see setStepsPerBeat). */
export function setFeel(p: Pattern, feel: Feel, now: number = Date.now()): Pattern {
  return setStepsPerBeat(p, feel === 'triplet' ? 3 : 4, now);
}

/** The familiar signature for a beat count and feel: 4/4, 3/4, 6/8 (2 triplet beats), 12/8 … */
export function signatureLabel(beats: number, feel: Feel): string {
  if (feel === 'straight') return `${beats}/4`;
  if (beats === 2) return '6/8';
  if (beats === 3) return '9/8';
  if (beats === 4) return '12/8';
  return `${beats} × triplets`;
}

function isBeatGrid(p: Pattern): boolean {
  return (
    p.timeSig.den === 4 &&
    p.bars === 1 &&
    p.timeSig.num >= PATTERN_LIMITS.minBeats &&
    p.timeSig.num <= PATTERN_LIMITS.maxBeats &&
    PATTERN_LIMITS.stepsPerBeat.includes(p.stepsPerBeat)
  );
}

/** Legacy steps-per-beat → 3 or 4: multiples of 4 stay straight (8, 12 → 4); 3, 6, 9 → 3; the rest → 4. */
function allowedSteps(n: number): number {
  return n % 4 === 0 ? 4 : n % 3 === 0 ? 3 : 4;
}

/**
 * Normalizes any (legacy) pattern to the beats × steps model: `timeSig = {num: beats, den: 4}`,
 * `stepsPerBeat` 3 or 4. The pulse (beat in simple meters, dotted beat in 6/8, 9/8, 12/8) becomes
 * the new beat, so the same BPM number sounds identical. Ticks are scaled by `TPQ / pulseTicks` per
 * bar; if the pulse needs another grid (e.g. 8 steps), 3 or 4 is used and notes
 * are quantized. Returns the same object when nothing needs to change.
 */
export function toBeatGrid(p: Pattern): Pattern {
  if (isBeatGrid(p)) return p;
  const ts = p.timeSig;
  const pulse = pulseTicks(ts);
  const beats = clamp(Math.round(pulsesPerBar(ts)), PATTERN_LIMITS.minBeats, PATTERN_LIMITS.maxBeats);
  const stepsPerBeat = allowedSteps(Math.round((p.stepsPerBeat * pulse) / beatTicks(ts)));
  const perBar: TimeSignature = { num: beats, den: 4 };
  const scaled = remapBars(p.notes, barTicks(ts), barTicks(perBar), p.bars, TPQ / pulse);
  // Bars are flattened into one long bar of beats: contiguous ticks stay where they are.
  const timeSig: TimeSignature = { num: clamp(beats * p.bars, PATTERN_LIMITS.minBeats, PATTERN_LIMITS.maxBeats), den: 4 };
  const notes = quantizeNotes(scaled, TPQ / stepsPerBeat, barTicks(timeSig));
  return { ...p, timeSig, bars: 1, stepsPerBeat, notes, mix: cloneMix(p.mix) };
}

/** Number of notes that do not sit exactly on the current step grid. */
export function offGridCount(p: Pattern): number {
  const st = stepTicks(p.timeSig, p.stepsPerBeat);
  let count = 0;
  for (const id of SOUND_IDS) for (const n of p.notes[id] ?? []) if (n.tick % st !== 0) count++;
  return count;
}

export function setSwing(p: Pattern, swing: number, now: number = Date.now()): Pattern {
  return touch(p, { swing: clamp(swing, PATTERN_LIMITS.minSwing, PATTERN_LIMITS.maxSwing) }, now);
}

export function setBpm(p: Pattern, bpm: number, now: number = Date.now()): Pattern {
  return touch(p, { bpm: clamp(bpm, PATTERN_LIMITS.minBpm, PATTERN_LIMITS.maxBpm) }, now);
}

export function rename(p: Pattern, name: string, now: number = Date.now()): Pattern {
  const trimmed = name.trim();
  return touch(p, { name: trimmed === '' ? 'Untitled' : trimmed }, now);
}

export function getMix(p: Pattern, sound: SoundId): TrackMix {
  return { ...DEFAULT_MIX, ...p.mix[sound] };
}

export function setMix(p: Pattern, sound: SoundId, partial: Partial<TrackMix>, now: number = Date.now()): Pattern {
  const merged: TrackMix = { ...getMix(p, sound), ...partial };
  merged.gain = clamp(merged.gain, 0, 1.5);
  return touch(p, { mix: { ...cloneMix(p.mix), [sound]: merged } }, now);
}

export function clearTrack(p: Pattern, sound: SoundId, now: number = Date.now()): Pattern {
  const notes = cloneNotes(p.notes);
  delete notes[sound];
  return touch(p, { notes }, now);
}

export function clearPattern(p: Pattern, now: number = Date.now()): Pattern {
  return touch(p, { notes: {} }, now);
}

export function duplicatePattern(p: Pattern, now: number = Date.now(), name?: string): Pattern {
  const { ownerSongId: _owner, ...rest } = p; // a duplicate is a normal library pattern
  return {
    ...rest,
    id: crypto.randomUUID(),
    name: name ?? `${p.name} copy`,
    builtIn: false,
    timeSig: { ...p.timeSig },
    notes: cloneNotes(p.notes),
    mix: cloneMix(p.mix),
    createdAt: now,
    updatedAt: now,
  };
}

export function hasNotes(p: Pattern, sound: SoundId): boolean {
  return (p.notes[sound]?.length ?? 0) > 0;
}

export function noteCount(p: Pattern): number {
  let c = 0;
  for (const id of SOUND_IDS) c += p.notes[id]?.length ?? 0;
  return c;
}
