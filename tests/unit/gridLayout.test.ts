import { describe, expect, it } from 'vitest';
import { gridRows, gridRowsLabeled, stepLabel } from '../../src/ui/gridLayout';

const ts = (num: number, den: 2 | 4 | 8 | 16) => ({ num, den });
const sizes = (n: number, d: 2 | 4 | 8 | 16, spb: number) => gridRows(ts(n, d), spb).map((r) => r.length);

describe('gridRows', () => {
  it('one beat per row when stepsPerBeat >= 3', () => {
    expect(sizes(4, 4, 4)).toEqual([4, 4, 4, 4]);
    expect(sizes(4, 4, 3)).toEqual([3, 3, 3, 3]);
    expect(sizes(6, 8, 4)).toEqual([4, 4, 4, 4, 4, 4]);
  });

  it('two beats per row at 2 steps per beat', () => {
    expect(sizes(4, 4, 2)).toEqual([4, 4]);
    expect(sizes(2, 4, 2)).toEqual([4]);
    expect(sizes(3, 4, 2)).toEqual([2, 2, 2]);
    expect(sizes(5, 4, 2)).toEqual([4, 6]);
    expect(sizes(7, 4, 2)).toEqual([4, 4, 6]);
  });

  it('compound meters group by pulse of 3 beats', () => {
    expect(sizes(6, 8, 2)).toEqual([6, 6]);
    expect(sizes(9, 8, 2)).toEqual([6, 6, 6]);
    expect(sizes(12, 8, 1)).toEqual([3, 3, 3, 3]);
    expect(sizes(6, 8, 1)).toEqual([3, 3]);
  });

  it('one step per beat: one row up to 8, else split evenly', () => {
    expect(sizes(4, 4, 1)).toEqual([4]);
    expect(sizes(7, 8, 1)).toEqual([7]);
    expect(sizes(12, 4, 1)).toEqual([6, 6]);
    expect(sizes(11, 4, 1)).toEqual([6, 5]);
  });

  it('covers every step of the bar exactly once, in order', () => {
    for (const [n, d] of [[4, 4], [3, 4], [5, 4], [7, 4], [6, 8], [7, 8], [9, 8], [12, 8], [2, 4]] as const) {
      for (const spb of [1, 2, 3, 4, 6, 8]) {
        expect(gridRows(ts(n, d), spb).flat()).toEqual(Array.from({ length: n * spb }, (_, i) => i));
      }
    }
  });

  it('labels rows with the first beat number', () => {
    expect(gridRowsLabeled(ts(4, 4), 2).map((r) => r.label)).toEqual(['1', '3']);
    expect(gridRowsLabeled(ts(4, 4), 4).map((r) => r.label)).toEqual(['1', '2', '3', '4']);
    expect(gridRowsLabeled(ts(6, 8), 1).map((r) => r.label)).toEqual(['1', '4']);
  });
});

describe('stepLabel', () => {
  it('names resolutions from the note value', () => {
    expect(stepLabel(ts(4, 4), 1)).toBe('quarters');
    expect(stepLabel(ts(4, 4), 2)).toBe('8ths');
    expect(stepLabel(ts(4, 4), 3)).toBe('8th triplets');
    expect(stepLabel(ts(4, 4), 4)).toBe('16ths');
    expect(stepLabel(ts(4, 4), 6)).toBe('16th triplets');
    expect(stepLabel(ts(4, 4), 8)).toBe('32nds');
    expect(stepLabel(ts(6, 8), 1)).toBe('8ths');
    expect(stepLabel(ts(6, 8), 2)).toBe('16ths');
  });
});
