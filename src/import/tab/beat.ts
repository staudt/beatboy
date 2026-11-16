import { formatBeatText } from '../../domain/notation';
import { createPattern, setSteps } from '../../domain/patternOps';
import { stepTicks } from '../../domain/time';
import type { Feel, NoteEvent, SoundId } from '../../domain/types';
import type { Bar } from './types';

export const maxStepsFor = (feel: Feel): number => (feel === 'triplet' ? 96 : 128);

/** Bars -> Beatboy beat text (one line, one token per grid square), through the domain model so the text is canonical. */
export function beatText(bars: readonly Bar[], feel: Feel): string {
  const spb = feel === 'triplet' ? 3 : 4;
  const total = bars.reduce((a, b) => a + b.n, 0);
  const st = stepTicks({ num: 1, den: 4 }, spb);
  const notes: Partial<Record<SoundId, NoteEvent[]>> = {};
  let at = 0;
  for (const bar of bars) {
    bar.steps.forEach((m, i) => {
      for (const [sound, vel] of m) (notes[sound] ??= []).push({ tick: (at + i) * st, vel });
    });
    at += bar.n;
  }
  const p = setSteps(createPattern({ id: 'tab', stepsPerBeat: spb }, 0), total, 0);
  return formatBeatText({ ...p, notes }, { lineBreaks: false }).text;
}
