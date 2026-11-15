import { DEFAULT_MIX, SOUND_IDS } from '../domain/types';
import type { Pattern } from '../domain/types';
import { TPQ, beatTicks, patternTicks, swingOffset } from '../domain/time';
import type { NoteOut, SinkSound } from './types';

/** Building blocks shared by the song source. */

export const BEAT = TPQ;
/** Count-in clicks are always at least this loud, even if the user's click volume is low. */
export const COUNT_IN_MIN_GAIN = 0.6;
export const CLICK_VEL = 100;
export const CRASH_VEL = 120;
export const KICK_VEL = 110;

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Shortest count-in bar: a groove shorter than 4 beats (e.g. a 3-step beat) would give a uselessly short count-in. */
export const MIN_COUNT_IN_BAR = 4 * BEAT;

/**
 * Count-in clicks for ticks in [from, min(to, 0)): bars of `bar` ticks end at tick 0, a click on every beat from each
 * bar start, accent on bar starts, always audible.
 */
export function collectCountIn(from: number, to: number, bar: number, volume: number, out: NoteOut[]): void {
  const gain = Math.max(volume, COUNT_IN_MIN_GAIN);
  const end = Math.min(to, 0);
  if (end <= from || bar <= 0) return;
  for (let k = Math.ceil(-from / bar); k >= 1; k--) {
    const barStart = -k * bar;
    for (let t = barStart; t < barStart + bar && t < end; t += BEAT) {
      if (t >= from) out.push({ tick: t, offsetTicks: 0, sound: t === barStart ? 'clickAccent' : 'click', vel: CLICK_VEL, gain });
    }
  }
}

/** One click per beat (480 ticks) counted from `origin` (the bar start) in [from, to); 'clickAccent' on the origin beat of each `bar`. Never swung. */
export function collectClicks(from: number, to: number, bar: number, volume: number, out: NoteOut[], origin = 0): void {
  for (let t = origin + Math.ceil((from - origin) / BEAT) * BEAT; t < to; t += BEAT) {
    out.push({
      tick: t,
      offsetTicks: 0,
      sound: mod(t - origin, bar) === 0 ? 'clickAccent' : 'click',
      vel: CLICK_VEL,
      gain: volume,
    });
  }
}

/**
 * The tail of fill `fp` aligned so ITS END is `end` (fill tick f plays at end - fillLen + f), restricted to
 * ticks in [max(start, from), min(end, to)).
 */
export function collectFillTail(fp: Pattern, start: number, end: number, from: number, to: number, out: NoteOut[]): void {
  const fillLen = patternTicks(fp);
  if (fillLen <= 0) return;
  const beat = beatTicks(fp.timeSig);
  const swing = fp.stepsPerBeat === 3 ? 0.5 : fp.swing;
  const origin = end - fillLen;
  for (const sound of SOUND_IDS) {
    const notes = fp.notes[sound];
    if (!notes || notes.length === 0) continue;
    const mix = fp.mix[sound] ?? DEFAULT_MIX;
    if (mix.muted) continue;
    for (const n of notes) {
      if (n.tick < 0 || n.tick >= fillLen) continue;
      const abs = origin + n.tick;
      if (abs < start || abs >= end || abs < from || abs >= to) continue;
      out.push({ tick: abs, offsetTicks: swingOffset(n.tick, beat, swing), sound, vel: n.vel, gain: mix.gain });
    }
  }
}

/** Adds a hit; if the same sound already sits on that tick the louder velocity wins. */
export function addHit(notes: NoteOut[], tick: number, sound: SinkSound, vel: number): void {
  const existing = notes.find((n) => n.tick === tick && n.sound === sound);
  if (existing) existing.vel = Math.max(existing.vel, vel);
  else notes.push({ tick, offsetTicks: 0, sound, vel, gain: 1 });
}
