import { describe, expect, it } from 'vitest';
import { gridRows, gridRowsLabeled, stepLabel } from '../../src/ui/gridLayout';

const ts = (num: number) => ({ num, den: 4 as const });
const sizes = (n: number, spb: number) => gridRows(ts(n), spb).map((r) => r.length);

describe('gridRows', () => {
  it('one row per beat, cells = steps', () => {
    expect(sizes(4, 4)).toEqual([4, 4, 4, 4]);
    expect(sizes(4, 3)).toEqual([3, 3, 3, 3]);
    expect(sizes(4, 2)).toEqual([2, 2, 2, 2]);
    expect(sizes(2, 3)).toEqual([3, 3]);
    expect(sizes(7, 4)).toEqual([4, 4, 4, 4, 4, 4, 4]);
  });

  it('one step per beat: a single row with every beat', () => {
    expect(sizes(4, 1)).toEqual([4]);
    expect(sizes(7, 1)).toEqual([7]);
    expect(sizes(1, 1)).toEqual([1]);
  });

  it('covers every step of the bar exactly once, in order', () => {
    for (let n = 1; n <= 7; n++) {
      for (const spb of [1, 2, 3, 4]) {
        expect(gridRows(ts(n), spb).flat()).toEqual(Array.from({ length: n * spb }, (_, i) => i));
      }
    }
  });

  it('labels rows with the beat number', () => {
    expect(gridRowsLabeled(ts(4), 2).map((r) => r.label)).toEqual(['1', '2', '3', '4']);
    expect(gridRowsLabeled(ts(3), 4).map((r) => r.label)).toEqual(['1', '2', '3']);
    expect(gridRowsLabeled(ts(4), 1).map((r) => r.label)).toEqual(['1']);
  });
});

describe('stepLabel', () => {
  it('names the four resolutions', () => {
    expect(stepLabel(1)).toBe('quarters');
    expect(stepLabel(2)).toBe('8ths');
    expect(stepLabel(3)).toBe('triplets');
    expect(stepLabel(4)).toBe('16ths');
  });
});
