import { describe, it, expect } from 'vitest';
import { lengthLabel, patternSteps, patternTicks, barTicks, beatTicks, pulseTicks, secondsPerTick, swingOffset, stepTicks, stepsPerBar } from '../../src/domain/time';
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
  const B = 480;
  const at = (tick: number, swing: number) => tick + swingOffset(tick, B, swing);
  it('is zero when straight', () => {
    for (const t of [0, 120, 240, 360]) expect(swingOffset(t, B, 0.5)).toBe(0);
  });
  it('never moves the beat start, in any beat', () => {
    expect(swingOffset(0, B, 0.75)).toBe(0);
    expect(swingOffset(480, B, 0.75)).toBe(0);
    expect(swingOffset(1920, B, 0.67)).toBe(0);
  });
  it('0.67: the "&" lands on the 3rd triplet and the "e" on 1/3 of the beat', () => {
    expect(at(240, 2 / 3)).toBeCloseTo(320, 9);
    expect(at(120, 2 / 3)).toBeCloseTo(160, 9); // the 16th "e" scales proportionally
    expect(at(360, 2 / 3)).toBeCloseTo(400, 9);
    expect(at(480 + 240, 2 / 3)).toBeCloseTo(480 + 320, 9); // second beat
  });
  it('0.75 puts the "&" on the dotted-8th position', () => {
    expect(at(240, 0.75)).toBeCloseTo(360, 9);
  });
  it('is monotonic so notes never change order', () => {
    for (const sw of [0.55, 0.67, 0.75]) {
      let prev = -1;
      for (let t = 0; t < 480; t += 10) {
        const w = at(t, sw);
        expect(w).toBeGreaterThan(prev);
        prev = w;
      }
    }
  });
  it('ignores bad beat lengths', () => {
    expect(swingOffset(120, 0, 0.7)).toBe(0);
  });
});

describe('pattern length in steps', () => {
  const p = (over: object = {}) => ({ timeSig: ts(4, 4), bars: 1, stepsPerBeat: 4, ...over });
  it('without steps: whole beats x bars', () => {
    expect(patternSteps(p())).toBe(16);
    expect(patternTicks(p())).toBe(1920);
    expect(patternSteps(p({ stepsPerBeat: 3, timeSig: ts(2, 4) }))).toBe(6);
  });
  it('steps win: 3 straight steps = 360 ticks, 2 triplet steps = 320', () => {
    expect(patternSteps(p({ steps: 3, timeSig: ts(1, 4) }))).toBe(3);
    expect(patternTicks(p({ steps: 3, timeSig: ts(1, 4) }))).toBe(360);
    expect(patternTicks(p({ steps: 2, stepsPerBeat: 3, timeSig: ts(1, 4) }))).toBe(320);
    expect(patternTicks(p({ steps: 7, timeSig: ts(2, 4) }))).toBe(840);
  });
  it('lengthLabel', () => {
    expect(lengthLabel(p())).toBe('4 beats');
    expect(lengthLabel(p({ timeSig: ts(1, 4), steps: 4 }))).toBe('1 beat');
    expect(lengthLabel(p({ timeSig: ts(1, 4), steps: 3 }))).toBe('3 steps');
    expect(lengthLabel(p({ timeSig: ts(1, 4), steps: 1 }))).toBe('1 step');
  });
});
