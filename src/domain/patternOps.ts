import {
  DEFAULT_MIX,
  PATTERN_LIMITS,
  SOUND_IDS,
  VELOCITY,
  type NoteEvent,
  type Pattern,
  type SoundId,
  type TimeSignature,
  type TrackMix,
  type VelocityLevel,
} from './types';
import { barTicks, patternSteps, patternTicks, stepTicks } from './time';

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

export function setBars(p: Pattern, bars: number, now: number = Date.now()): Pattern {
  const target = clamp(Math.round(bars), PATTERN_LIMITS.minBars, PATTERN_LIMITS.maxBars);
  const bt = barTicks(p.timeSig);
  const oldLen = bt * p.bars;
  const newLen = bt * target;
  const notes: Notes = {};
  for (const id of SOUND_IDS) {
    const src = (p.notes[id] ?? []).filter((n) => n.tick < oldLen);
    const out: NoteEvent[] = [];
    if (target <= p.bars) {
      for (const n of src) if (n.tick < newLen) out.push({ ...n });
    } else {
      for (let b = 0; b < target; b++) {
        const srcBar = b % p.bars;
        for (const n of src) {
          if (n.tick >= srcBar * bt && n.tick < (srcBar + 1) * bt) {
            out.push({ tick: n.tick + (b - srcBar) * bt, vel: n.vel });
          }
        }
      }
      out.sort((a, b) => a.tick - b.tick);
    }
    if (out.length > 0) notes[id] = out;
  }
  return touch(p, { bars: target, notes }, now);
}

export function setTimeSig(p: Pattern, ts: TimeSignature, now: number = Date.now()): Pattern {
  const timeSig = { num: ts.num, den: ts.den };
  const len = patternTicks({ timeSig, bars: p.bars });
  const notes: Notes = {};
  for (const id of SOUND_IDS) {
    const out = (p.notes[id] ?? []).filter((n) => n.tick < len).map((n) => ({ ...n }));
    if (out.length > 0) notes[id] = out;
  }
  return touch(p, { timeSig, notes }, now);
}

/** Non-destructive. Values outside PATTERN_LIMITS.stepsPerBeat leave the pattern unchanged. */
export function setStepsPerBeat(p: Pattern, n: number, now: number = Date.now()): Pattern {
  if (!PATTERN_LIMITS.stepsPerBeat.includes(n)) return p;
  return touch(p, { stepsPerBeat: n }, now);
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
  return {
    ...p,
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
