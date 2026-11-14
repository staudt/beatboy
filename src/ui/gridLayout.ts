import { isCompound } from '../domain/time';
import type { TimeSignature } from '../domain/types';

export interface GridRow {
  /** Label for the row: the beat number of its first step ("1", "3", …). */
  label: string;
  /** Step indices within one bar. */
  steps: number[];
}

/** How many beats go in each row, in order. */
function beatGroups(ts: TimeSignature, spb: number): number[] {
  const n = ts.num;
  const compound = isCompound(ts);
  if (spb >= 3) return Array<number>(n).fill(1);
  if (compound) return Array<number>(n / 3).fill(3);
  if (spb === 2) {
    if (n <= 2) return [n];
    if (n === 3) return [1, 1, 1];
    const groups = Array<number>(Math.floor(n / 2)).fill(2);
    if (n % 2 === 1) groups[groups.length - 1] = 3;
    return groups;
  }
  // spb === 1 (or anything unexpected below 3), simple meter
  if (n <= 8) return [n];
  const rows = Math.ceil(n / 8);
  const base = Math.floor(n / rows);
  const extra = n % rows;
  return Array.from({ length: rows }, (_, i) => base + (i < extra ? 1 : 0));
}

export function gridRowsLabeled(ts: TimeSignature, stepsPerBeat: number): GridRow[] {
  const out: GridRow[] = [];
  let beat = 0;
  for (const g of beatGroups(ts, stepsPerBeat)) {
    const steps: number[] = [];
    for (let i = 0; i < g * stepsPerBeat; i++) steps.push(beat * stepsPerBeat + i);
    out.push({ label: String(beat + 1), steps });
    beat += g;
  }
  return out;
}

/** Step indices (within one bar) grouped into rows for the mobile step grid. */
export function gridRows(ts: TimeSignature, stepsPerBeat: number): number[][] {
  return gridRowsLabeled(ts, stepsPerBeat).map((r) => r.steps);
}

const NOTE_NAMES: Record<number, string> = {
  1: 'whole notes',
  2: 'halves',
  4: 'quarters',
  6: 'quarter triplets',
  8: '8ths',
  12: '8th triplets',
  16: '16ths',
  24: '16th triplets',
  32: '32nds',
  48: '32nd triplets',
  64: '64ths',
};

/** Human name of a grid resolution, from the note value of one step. */
export function stepLabel(ts: TimeSignature, stepsPerBeat: number): string {
  const n = ts.den * stepsPerBeat;
  return NOTE_NAMES[n] ?? `1/${n} notes`;
}
