import { describe, expect, it } from 'vitest';
import { registerTap } from '../../src/input/tapTempo';

describe('registerTap', () => {
  it('needs two taps', () => {
    expect(registerTap([], 1000)).toEqual({ taps: [1000], bpm: null });
  });

  it('computes tempo from the interval', () => {
    const r = registerTap([1000], 1500);
    expect(r.bpm).toBe(120);
  });

  it('averages the last four intervals only', () => {
    let taps: number[] = [];
    let t = 0;
    // one slow interval (1000 ms), then four of 500 ms
    taps = registerTap(taps, t).taps;
    t += 1000;
    taps = registerTap(taps, t).taps;
    let bpm: number | null = null;
    for (let i = 0; i < 4; i++) {
      t += 500;
      ({ taps, bpm } = registerTap(taps, t));
    }
    expect(bpm).toBe(120);
    expect(taps).toHaveLength(5);
  });

  it('resets after a gap longer than 2 s', () => {
    const r = registerTap([1000, 1500], 4000);
    expect(r).toEqual({ taps: [4000], bpm: null });
  });

  it('clamps to the allowed tempo range', () => {
    expect(registerTap([0], 100).bpm).toBe(300);
    expect(registerTap([0], 1999).bpm).toBe(30);
  });
});
