import { describe, it, expect } from 'vitest';
import { barTicks, beatTicks, pulseTicks, secondsPerTick, swingOffset, stepTicks, stepsPerBar } from '../../src/domain/time';
import type { TimeSignature } from '../../src/domain/types';

const ts = (num: number, den: TimeSignature['den']): TimeSignature => ({ num, den });

describe('time signatures', () => {
  it.each([
    [4, 4, 480, 1920, 480],
    [3, 4, 480, 1440, 480],
    [6, 8, 240, 1440, 720],
    [7, 8, 240, 1680, 240],
    [12, 8, 240, 2880, 720],
    [5, 4, 480, 2400, 480],
  ] as const)('%i/%i: beat, bar, pulse', (n, d, beat, bar, pulse) => {
    expect(beatTicks(ts(n, d))).toBe(beat);
    expect(barTicks(ts(n, d))).toBe(bar);
    expect(pulseTicks(ts(n, d))).toBe(pulse);
  });

  it('step ticks and steps per bar', () => {
    expect(stepTicks(ts(4, 4), 4)).toBe(120);
    expect(stepTicks(ts(4, 4), 3)).toBe(160);
    expect(stepsPerBar(ts(6, 8), 2)).toBe(12);
  });

  it('secondsPerTick', () => {
    expect(secondsPerTick(120, ts(4, 4)) * 480).toBeCloseTo(0.5, 10);
    expect(secondsPerTick(60, ts(6, 8)) * barTicks(ts(6, 8))).toBeCloseTo(2, 10);
  });
});

describe('swingOffset', () => {
  it('is zero when straight', () => {
    expect(swingOffset(120, 120, 0.5)).toBe(0);
  });
  it('delays odd steps only', () => {
    expect(swingOffset(120, 120, 0.75)).toBeCloseTo(60);
    expect(swingOffset(0, 120, 0.75)).toBe(0);
    expect(swingOffset(240, 120, 0.75)).toBe(0);
    expect(swingOffset(360, 120, 0.75)).toBeCloseTo(60);
  });
  it('triplet feel at 0.66', () => {
    expect(swingOffset(120, 120, 0.66)).toBeCloseTo(0.32 * 120);
  });
  it('ignores off-grid notes and bad steps', () => {
    expect(swingOffset(130, 120, 0.7)).toBe(0);
    expect(swingOffset(120, 0, 0.7)).toBe(0);
  });
});
