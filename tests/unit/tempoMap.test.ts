import { describe, expect, it } from 'vitest';
import { TempoMap } from '../../src/engine/tempoMap';

describe('TempoMap', () => {
  it('maps linearly in a single segment', () => {
    const m = new TempoMap();
    m.reset(0, 1, 0.001);
    expect(m.timeAt(500)).toBeCloseTo(1.5, 12);
    expect(m.tickAt(1.5)).toBeCloseTo(500, 9);
  });

  it('extrapolates before the first segment', () => {
    const m = new TempoMap();
    m.reset(100, 2, 0.01);
    expect(m.timeAt(0)).toBeCloseTo(1, 12);
    expect(m.tickAt(1)).toBeCloseTo(0, 9);
  });

  it('is continuous across changes', () => {
    const m = new TempoMap();
    m.reset(0, 0, 0.001);
    m.change(1000, 0.002);
    m.change(1500, 0.0005);
    expect(m.timeAt(1000)).toBeCloseTo(1, 12);
    expect(m.timeAt(1500)).toBeCloseTo(2, 12);
    expect(m.timeAt(2500)).toBeCloseTo(2.5, 12);
    expect(m.timeAt(1000 - 1e-9)).toBeCloseTo(1, 6);
  });

  it('tickAt and timeAt are inverses and monotonic', () => {
    const m = new TempoMap();
    m.reset(0, 0.5, 0.001);
    m.change(960, 0.0013);
    m.change(2000, 0.0007);
    let prev = -Infinity;
    for (let t = -10; t < 3000; t += 7.3) {
      const time = m.timeAt(t);
      expect(m.tickAt(time)).toBeCloseTo(t, 6);
      expect(time).toBeGreaterThan(prev);
      prev = time;
    }
  });

  it('replaces the rate when changing at the last segment tick', () => {
    const m = new TempoMap();
    m.reset(0, 0, 0.001);
    m.change(0, 0.002);
    expect(m.segments).toHaveLength(1);
    expect(m.timeAt(100)).toBeCloseTo(0.2, 12);
    m.change(100, 0.001);
    m.change(100, 0.004);
    expect(m.segments).toHaveLength(2);
    expect(m.timeAt(200)).toBeCloseTo(0.2 + 0.4, 12);
  });

  it('prunes superseded segments but keeps at least one', () => {
    const m = new TempoMap();
    m.reset(0, 0, 0.001);
    m.change(1000, 0.002); // t=1
    m.change(2000, 0.001); // t=3
    m.prune(0.5);
    expect(m.segments).toHaveLength(3);
    m.prune(1.5);
    expect(m.segments).toHaveLength(2);
    expect(m.timeAt(2500)).toBeCloseTo(3.5, 12);
    m.prune(1000);
    expect(m.segments).toHaveLength(1);
    expect(m.timeAt(2500)).toBeCloseTo(3.5, 12);
  });
});
