import type { Pattern, TimeSignature } from './types';

/** Ticks per quarter note. Divisible by 2,3,4,5,6,8,12,16,32 etc. */
export const TPQ = 480;

/** Ticks in one beat (one 1/den note). 4/4 → 480, 6/8 → 240. */
export function beatTicks(ts: TimeSignature): number {
  return (TPQ * 4) / ts.den;
}

export function barTicks(ts: TimeSignature): number {
  return ts.num * beatTicks(ts);
}

/**
 * Compound meters (6/8, 9/8, 12/8, 6/16 …) are felt in dotted pulses of three beats.
 */
export function isCompound(ts: TimeSignature): boolean {
  return ts.den >= 8 && ts.num > 3 && ts.num % 3 === 0;
}

/**
 * Ticks per *pulse* — the unit a musician counts and that BPM refers to.
 * Simple meters: one beat (4/4 → quarter, 3/8 → eighth).
 * Compound meters: three beats (6/8 → dotted quarter).
 */
export function pulseTicks(ts: TimeSignature): number {
  return isCompound(ts) ? beatTicks(ts) * 3 : beatTicks(ts);
}

export function pulsesPerBar(ts: TimeSignature): number {
  return barTicks(ts) / pulseTicks(ts);
}

export function stepTicks(ts: TimeSignature, stepsPerBeat: number): number {
  return beatTicks(ts) / stepsPerBeat;
}

export function stepsPerBar(ts: TimeSignature, stepsPerBeat: number): number {
  return ts.num * stepsPerBeat;
}

export function patternTicks(p: Pick<Pattern, 'timeSig' | 'bars'>): number {
  return barTicks(p.timeSig) * p.bars;
}

export function patternSteps(p: Pick<Pattern, 'timeSig' | 'bars' | 'stepsPerBeat'>): number {
  return stepsPerBar(p.timeSig, p.stepsPerBeat) * p.bars;
}

/** Seconds per tick when `bpm` pulses (see pulseTicks) happen per minute. */
export function secondsPerTick(bpm: number, ts: TimeSignature): number {
  return 60 / (bpm * pulseTicks(ts));
}

/**
 * Swing offset in ticks for a note at `tick` on a grid of `step` ticks.
 * Notes on odd grid positions are delayed by (swing - 0.5) * 2 * step.
 * swing = 0.5 → straight; 0.6667 → triplet feel; 0.75 → dotted feel.
 * Off-grid notes and triplet grids are left alone by callers choosing swing = 0.5.
 */
export function swingOffset(tick: number, step: number, swing: number): number {
  if (swing <= 0.5 || step <= 0) return 0;
  if (tick % step !== 0) return 0;
  const index = tick / step;
  if (index % 2 === 0) return 0;
  return (swing - 0.5) * 2 * step;
}
