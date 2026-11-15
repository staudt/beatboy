import { describe, expect, it } from 'vitest';
import { PatternLoopSource } from '../../src/engine/patternSource';
import type { NoteOut } from '../../src/engine/types';

import { mkPattern } from './helpers';

const collect = (s: PatternLoopSource, a: number, b: number) => {
  const out: NoteOut[] = [];
  s.collect(a, b, out);
  return out;
};

describe('PatternLoopSource', () => {
  const p = mkPattern({
    notes: {
      kick: [
        { tick: 0, vel: 100 },
        { tick: 960, vel: 90 },
      ],
      snare: [{ tick: 480, vel: 80 }],
    },
  });

  it('uses half-open window [from,to)', () => {
    const s = new PatternLoopSource(() => p);
    expect(collect(s, 0, 480).map((n) => n.tick)).toEqual([0]);
    expect(collect(s, 1, 480)).toHaveLength(0);
    expect(collect(s, 480, 481).map((n) => n.sound)).toEqual(['snare']);
    expect(collect(s, 0, 0)).toHaveLength(0);
  });

  it('wraps across loop iterations', () => {
    const s = new PatternLoopSource(() => p);
    const ticks = collect(s, 1500, 4000).map((n) => n.tick).sort((a, b) => a - b);
    expect(ticks).toEqual([1920, 2400, 2880, 3840]);
  });

  it('contiguous windows emit each note exactly once', () => {
    const s = new PatternLoopSource(() => p);
    const seen: number[] = [];
    let from = 0;
    let w = 7;
    while (from < 1920 * 10) {
      const to = from + w;
      for (const n of collect(s, from, to)) seen.push(n.tick);
      from = to;
      w = (w * 31) % 997 + 1;
    }
    const expected: number[] = [];
    for (let k = 0; k < 12; k++) expected.push(k * 1920, k * 1920 + 480, k * 1920 + 960);
    expect(seen.filter((t) => t < from).sort((a, b) => a - b)).toEqual(expected.filter((t) => t < from));
  });

  it('omits muted tracks and applies mix gain', () => {
    const q = mkPattern({ ...p, mix: { snare: { gain: 1, muted: true }, kick: { gain: 0.5, muted: false } } });
    const out = collect(new PatternLoopSource(() => q), 0, 1920);
    expect(out.every((n) => n.sound === 'kick')).toBe(true);
    expect(out.every((n) => n.gain === 0.5)).toBe(true);
    expect(collect(new PatternLoopSource(() => p), 0, 1920).every((n) => n.gain === 1)).toBe(true);
  });

  it('warps notes inside the beat (the "&" lands on 2/3)', () => {
    const q = mkPattern({
      swing: 2 / 3,
      notes: { hatClosed: [{ tick: 0, vel: 90 }, { tick: 120, vel: 90 }, { tick: 240, vel: 90 }, { tick: 360, vel: 90 }] },
    });
    const out = collect(new PatternLoopSource(() => q), 0, 480).sort((a, b) => a.tick - b.tick);
    expect(out.map((n) => Math.round(n.offsetTicks * 1000) / 1000)).toEqual([0, 40, 80, 40]);
  });

  it('ignores swing on triplet grids', () => {
    for (const spb of [3]) {
      const q = mkPattern({ stepsPerBeat: spb, swing: 0.7, notes: { hatClosed: [{ tick: 80, vel: 90 }, { tick: 160, vel: 90 }] } });
      expect(collect(new PatternLoopSource(() => q), 0, 480).every((n) => n.offsetTicks === 0)).toBe(true);
    }
  });

  it('reads the pattern live and survives length changes', () => {
    let cur = p;
    const s = new PatternLoopSource(() => cur);
    expect(collect(s, 0, 1920)).toHaveLength(3);
    cur = mkPattern({ ...p, bars: 2, notes: { kick: [{ tick: 3000, vel: 100 }] } });
    expect(collect(s, 1920, 3840).map((n) => n.tick)).toEqual([3000]);
    cur = mkPattern({ ...p, bars: 1, notes: { kick: [{ tick: 3000, vel: 100 }, { tick: 10, vel: 1 }] } });
    expect(() => collect(s, 0, 9999)).not.toThrow();
    expect(collect(s, 0, 1920).map((n) => n.tick)).toEqual([10]);
    expect(s.timeSig()).toEqual({ num: 4, den: 4 });
  });
});

describe('PatternLoopSource with a partial-beat length', () => {
  it('loops every 3 steps (360 ticks) and every 2 triplet steps (320)', () => {
    const three = mkPattern({ steps: 3, timeSig: { num: 1, den: 4 }, notes: { snare: [{ tick: 0, vel: 90 }, { tick: 240, vel: 90 }], kick: [{ tick: 120, vel: 90 }] } });
    const out = collect(new PatternLoopSource(() => three), 0, 1080);
    expect(out.filter((n) => n.sound === 'snare').map((n) => n.tick)).toEqual([0, 240, 360, 600, 720, 960]);
    const tri = mkPattern({ steps: 2, stepsPerBeat: 3, timeSig: { num: 1, den: 4 }, notes: { kick: [{ tick: 0, vel: 90 }, { tick: 160, vel: 90 }] } });
    expect(collect(new PatternLoopSource(() => tri), 0, 960).map((n) => n.tick)).toEqual([0, 160, 320, 480, 640, 800]);
  });
});
