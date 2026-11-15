import type { TimeSignature } from '../domain/types';

export interface GridRow {
  /** Label for the row: the beat number of its first step ("1", "3", …). */
  label: string;
  /** Step indices within one bar. */
  steps: number[];
}

/**
 * One row per beat (cells = steps). With one step per beat, a single row holds every beat.
 */
export function gridRowsLabeled(ts: TimeSignature, stepsPerBeat: number): GridRow[] {
  if (stepsPerBeat <= 1) {
    return [{ label: '1', steps: Array.from({ length: ts.num }, (_, i) => i) }];
  }
  return Array.from({ length: ts.num }, (_, b) => ({
    label: String(b + 1),
    steps: Array.from({ length: stepsPerBeat }, (_, i) => b * stepsPerBeat + i),
  }));
}

/** Step indices (within one bar) grouped into rows for the mobile step grid. */
export function gridRows(ts: TimeSignature, stepsPerBeat: number): number[][] {
  return gridRowsLabeled(ts, stepsPerBeat).map((r) => r.steps);
}

const STEP_NAMES: Record<number, string> = { 1: 'quarters', 2: '8ths', 3: 'triplets', 4: '16ths' };

/** Human name of a grid resolution (steps per beat). */
export function stepLabel(stepsPerBeat: number): string {
  return STEP_NAMES[stepsPerBeat] ?? `${stepsPerBeat} per beat`;
}
