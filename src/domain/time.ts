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

/** Loop length in steps (grid squares): the explicit `steps` when set, else whole beats × bars. */
export function patternSteps(p: Pick<Pattern, 'timeSig' | 'bars' | 'stepsPerBeat'> & { steps?: number }): number {
  return p.steps ?? stepsPerBar(p.timeSig, p.stepsPerBeat) * p.bars;
}

/** Loop length in ticks. */
export function patternTicks(p: Pick<Pattern, 'timeSig' | 'bars'> & { steps?: number; stepsPerBeat?: number }): number {
  if (p.steps !== undefined && p.stepsPerBeat) return p.steps * stepTicks(p.timeSig, p.stepsPerBeat);
  return barTicks(p.timeSig) * p.bars;
}

/** Length as a person says it: whole beats "4 beats", anything else in squares "3 steps". */
export function lengthLabel(p: Pick<Pattern, 'timeSig' | 'bars' | 'stepsPerBeat'> & { steps?: number }): string {
  const n = patternSteps(p);
  if (n % p.stepsPerBeat === 0) {
    const b = n / p.stepsPerBeat;
    return `${b} beat${b === 1 ? '' : 's'}`;
  }
  return `${n} step${n === 1 ? '' : 's'}`;
}

/** Seconds per tick when `bpm` pulses (see pulseTicks) happen per minute. */
export function secondsPerTick(bpm: number, ts: TimeSignature): number {
  return 60 / (bpm * pulseTicks(ts));
}

/**
 * Swing offset in ticks (classic 8th-note swing, the guitarist's "shuffle" knob).
 * Time is warped inside each beat so the "&" (half-beat) lands at `swing` of the beat and everything
 * in between scales proportionally. With f = tickInBeat / beat in [0, 1):
 *   f < 0.5  → warped = f * (swing / 0.5)
 *   f >= 0.5 → warped = swing + (f - 0.5) * ((1 - swing) / 0.5)
 * and the offset is (warped - f) * beat. swing 0.5 = straight, 2/3 = triplet shuffle (the "&" lands on
 * the 3rd triplet), 0.75 = dotted feel. Beat starts never move.
 */
export function swingOffset(tick: number, beat: number, swing: number): number {
  if (swing <= 0.5 || beat <= 0) return 0;
  const inBeat = ((tick % beat) + beat) % beat;
  const f = inBeat / beat;
  const warped = f < 0.5 ? f * (swing / 0.5) : swing + (f - 0.5) * ((1 - swing) / 0.5);
  return (warped - f) * beat;
}
