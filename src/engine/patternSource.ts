import { DEFAULT_MIX, SOUND_IDS } from '../domain/types';
import type { Pattern, TimeSignature } from '../domain/types';
import { beatTicks, patternTicks, swingOffset } from '../domain/time';
import type { EventSource, NoteOut } from './types';

/**
 * Emits every note of `p`, looped forever from tick 0, with grid tick in [from, to).
 * Notes whose tick falls inside `silence` ([from, to) half-open) are skipped.
 */
export function collectLoopNotes(
  p: Pattern,
  from: number,
  to: number,
  out: NoteOut[],
  silence?: { from: number; to: number } | null,
): void {
  if (to <= from) return;
  const len = patternTicks(p);
  if (len <= 0) return;
  const beat = beatTicks(p.timeSig);
  const swing = p.stepsPerBeat === 3 ? 0.5 : p.swing;
  const kFirst = Math.floor(from / len);
  const kLast = Math.floor((to - 1) / len);
  for (const sound of SOUND_IDS) {
    const notes = p.notes[sound];
    if (!notes || notes.length === 0) continue;
    const mix = p.mix[sound] ?? DEFAULT_MIX;
    if (mix.muted) continue;
    for (let k = kFirst; k <= kLast; k++) {
      const base = k * len;
      for (const n of notes) {
        if (n.tick < 0 || n.tick >= len) continue;
        const abs = base + n.tick;
        if (abs < from || abs >= to) continue;
        if (silence && abs >= silence.from && abs < silence.to) continue;
        out.push({
          tick: abs,
          offsetTicks: swingOffset(n.tick, beat, swing),
          sound,
          vel: n.vel,
          gain: mix.gain,
        });
      }
    }
  }
}

/** Loops a (live-read) pattern forever from transport tick 0. */
export class PatternLoopSource implements EventSource {
  constructor(private readonly getPattern: () => Pattern) {}

  timeSig(): TimeSignature {
    return this.getPattern().timeSig;
  }

  collect(from: number, to: number, out: NoteOut[]): void {
    collectLoopNotes(this.getPattern(), from, to, out);
  }
}
