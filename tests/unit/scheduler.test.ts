import { describe, expect, it } from 'vitest';
import { Scheduler } from '../../src/engine/scheduler';
import { PatternLoopSource } from '../../src/engine/patternSource';
import type { Clock, EventSource, NoteOut, NoteSink, SinkSound } from '../../src/engine/types';
import type { Pattern, TimeSignature } from '../../src/domain/types';
import { mkPattern } from './helpers';

class FakeClock implements Clock {
  t = 10;
  now() {
    return this.t;
  }
}

interface Rec {
  time: number;
  sound: SinkSound;
  vel: number;
  gain: number;
  at: number; // clock when scheduled
  tick: number; // transport tick at scheduling time
}

function setup(src: EventSource, opts: { lookahead?: number } = {}) {
  const clock = new FakeClock();
  const rec: Rec[] = [];
  let stops = 0;
  const sink: NoteSink = {
    play: (time, sound, vel, gain) => rec.push({ time, sound, vel, gain, at: clock.t, tick: s.tickAt(time) }),
    stopAll: () => void stops++,
  };
  const s = new Scheduler({ clock, sink, source: src, ...opts });
  return { clock, rec, s, stops: () => stops };
}

const kicks = (ticks: number[], extra: Partial<Pattern> = {}) =>
  mkPattern({ notes: { kick: ticks.map((tick) => ({ tick, vel: 100 })) }, ...extra });

function run(h: ReturnType<typeof setup>, seconds: number, step: (() => number) | number = 0.025) {
  const end = h.clock.t + seconds;
  while (h.clock.t < end) {
    h.clock.t += typeof step === 'number' ? step : step();
    h.s.pump();
  }
}

function lcg(seed: number) {
  let x = seed;
  return () => ((x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

describe('Scheduler', () => {
  it('plays quarter kicks on an exact grid, once each, over 1000 bars, never beyond lookahead', () => {
    const p = kicks([0, 480, 960, 1440]);
    const h = setup(new PatternLoopSource(() => p));
    h.s.setBpm(120);
    const t0 = h.clock.t + 0.06;
    h.s.start();
    run(h, 2000 * 1.0); // 1000 bars of 2 s
    const bars = 1000;
    const wanted = bars * 4;
    expect(h.rec.length).toBeGreaterThanOrEqual(wanted);
    h.rec.slice(0, wanted).forEach((r, n) => expect(Math.abs(r.time - (t0 + n * 0.5))).toBeLessThan(1e-9));
    for (const r of h.rec) expect(r.time).toBeLessThanOrEqual(r.at + 0.12 + 1e-9);
    const times = h.rec.map((r) => r.time);
    expect(new Set(times.map((t) => t.toFixed(6))).size).toBe(times.length);
  });

  it('keeps exact timing with jittery timer intervals', () => {
    const p = kicks([0, 480, 960, 1440]);
    const h = setup(new PatternLoopSource(() => p));
    h.s.setBpm(120);
    const t0 = h.clock.t + 0.06;
    h.s.start();
    const rnd = lcg(42);
    run(h, 200, () => 0.005 + rnd() * 0.055);
    expect(h.rec.length).toBeGreaterThan(390);
    h.rec.forEach((r, n) => {
      expect(Math.abs(r.time - (t0 + n * 0.5))).toBeLessThan(1e-9);
      expect(r.time).toBeLessThanOrEqual(r.at + 0.12 + 1e-9);
    });
  });

  it('changes tempo mid-run without gap or overlap', () => {
    // a kick on every beat, 4/4
    const p = kicks([0, 480, 960, 1440]);
    const h = setup(new PatternLoopSource(() => p));
    h.s.setBpm(120);
    h.s.start();
    run(h, 3);
    h.s.setBpm(60);
    const changeAt = h.clock.t;
    let prev = -Infinity;
    for (let i = 0; i < 400; i++) {
      h.clock.t += 0.025;
      h.s.pump();
      const tk = h.s.tickAt(h.clock.t);
      expect(tk).toBeGreaterThan(prev);
      prev = tk;
    }
    const times = h.rec.map((r) => r.time);
    const gaps = times.slice(1).map((t, i) => t - times[i]!);
    // boundary gap mixes both rates (change lands mid-beat): bounded by the two tempos
    gaps.forEach((g) => {
      expect(g).toBeGreaterThan(0.5 - 1e-9);
      expect(g).toBeLessThan(1 + 1e-9);
    });
    expect(Math.abs(gaps[gaps.length - 1]! - 1)).toBeLessThan(1e-9);
    expect(gaps.filter((g) => Math.abs(g - 0.5) < 1e-9).length).toBeGreaterThan(4);
    // after change everything scheduled at/after change+lookahead is slow
    const late = h.rec.filter((r) => r.at > changeAt + 0.2);
    late.slice(1).forEach((r, i) => expect(r.time - late[i]!.time).toBeCloseTo(1, 9));
    // tick of each note is exactly on beat grid → position continuous
    h.rec.forEach((r) => {
      const tk = r.tick;
      expect(Math.abs(tk / 480 - Math.round(tk / 480))).toBeLessThan(1e-6);
    });
  });

  it('re-anchors on a time-signature change from the source', () => {
    let ts: TimeSignature = { num: 4, den: 4 };
    const events: number[] = [];
    const src: EventSource = {
      timeSig: () => ts,
      collect(from, to, out) {
        for (let t = Math.ceil(from / 240) * 240; t < to; t += 240) {
          if (t % 240 === 0) out.push({ tick: t, offsetTicks: 0, sound: 'kick', vel: 100, gain: 1 });
          events.push(t);
        }
      },
    };
    const h = setup(src);
    h.s.setBpm(120);
    h.s.start();
    run(h, 2); // 4/4: 120 pulses/min over 480-tick quarter => 0.5 s per 480 ticks, 0.25 s per 240
    ts = { num: 6, den: 8 }; // compound: pulse = dotted quarter = 720 ticks at 120 => 0.5 s
    run(h, 3);
    const times = h.rec.map((r) => r.time);
    const gaps = times.slice(1).map((t, i) => t - times[i]!);
    const fast = gaps.filter((g) => Math.abs(g - 0.25) < 1e-9).length;
    const slow = gaps.filter((g) => Math.abs(g - (0.5 * 240) / 720) < 1e-9).length;
    expect(fast).toBeGreaterThan(5);
    expect(slow).toBeGreaterThan(5);
    expect(gaps.length - fast - slow).toBeLessThanOrEqual(1); // only the boundary gap mixes rates
    // ticks are unique and consecutive
    const ticks = h.rec.map((r) => Math.round(r.tick));
    ticks.slice(1).forEach((t, i) => expect(t - ticks[i]!).toBe(240));
  });

  it('warps the 16ths and the "&" inside each beat by the swing amount', () => {
    const p = mkPattern({
      swing: 2 / 3,
      notes: { hatClosed: [0, 120, 240, 360].map((tick) => ({ tick, vel: 90 })) },
    });
    const h = setup(new PatternLoopSource(() => p));
    h.s.setBpm(120);
    const t0 = h.clock.t + 0.06;
    h.s.start();
    run(h, 2);
    const spt = 0.5 / 480;
    const expectTicks = [0, 120 + 40, 240 + 80, 360 + 40];
    h.rec.slice(0, 8).forEach((r, i) => {
      const k = Math.floor(i / 4);
      expect(r.time).toBeCloseTo(t0 + (k * 1920 + expectTicks[i % 4]!) * spt, 9);
    });
  });

  it('drops stale notes after a stall and stays on the grid afterwards', () => {
    const p = kicks([0, 480, 960, 1440]);
    const h = setup(new PatternLoopSource(() => p));
    h.s.setBpm(120);
    const t0 = h.clock.t + 0.06;
    h.s.start();
    run(h, 1);
    const before = h.rec.length;
    h.clock.t += 2;
    h.s.pump();
    const burst = h.rec.slice(before);
    for (const r of burst) {
      expect(r.time).toBeGreaterThanOrEqual(h.clock.t - 1e-9);
    }
    expect(burst.length).toBeLessThanOrEqual(1); // lookahead 0.12 s covers at most one 0.5 s note
    run(h, 3);
    h.rec.forEach((r) => {
      const n = (r.time - t0) / 0.5;
      expect(Math.abs(n - Math.round(n))).toBeLessThan(1e-9);
    });
  });

  it('clamps slightly late notes to now', () => {
    const p = kicks([0]);
    const h = setup(new PatternLoopSource(() => p));
    h.s.setBpm(120);
    h.s.start();
    h.rec.length = 0;
    // jump to just after the second loop's kick (t0 + 2.0) within tolerance
    h.clock.t = 10.06 + 2.0 + 0.05 - 0.12; // so look-ahead window covers kick at 2.0 only... pump skips earlier
    h.s.pump();
    for (const r of h.rec) expect(r.time).toBeGreaterThanOrEqual(r.at);
  });

  it('stop() silences and makes pump inert; start(fromTick) re-anchors', () => {
    const p = kicks([0, 480, 960, 1440]);
    const h = setup(new PatternLoopSource(() => p));
    h.s.setBpm(120);
    h.s.start();
    run(h, 1);
    h.s.stop();
    expect(h.stops()).toBe(1);
    expect(h.s.playing).toBe(false);
    expect(h.s.currentTick()).toBeNull();
    const n = h.rec.length;
    run(h, 1);
    expect(h.rec.length).toBe(n);
    h.clock.t += 5;
    const t0 = h.clock.t + 0.06;
    h.s.start(960);
    expect(h.s.playing).toBe(true);
    expect(h.s.timeAt(960)).toBeCloseTo(t0, 12);
    run(h, 0.5);
    expect(h.rec[n]!.time).toBeCloseTo(t0, 9); // kick at tick 960 plays first
    expect(h.rec[n + 1]!.time).toBeCloseTo(t0 + 0.5, 9);
    expect(h.s.currentTick()).toBeCloseTo(960 + (h.clock.t - t0) / (0.5 / 480), 6);
  });

  it('plays live edits at unscheduled ticks, never double-plays scheduled ones', () => {
    let p = kicks([0]);
    const h = setup(new PatternLoopSource(() => p));
    h.s.setBpm(120);
    const t0 = h.clock.t + 0.06;
    h.s.start();
    run(h, 0.5);
    // tick 0 of loop 0 already scheduled; adding a note at tick 0 again must not retrigger loop 0
    const n0 = h.rec.length;
    p = kicks([0], { notes: { kick: [{ tick: 0, vel: 100 }], snare: [{ tick: 0, vel: 100 }, { tick: 1440, vel: 100 }] } });
    run(h, 2.5);
    const snares = h.rec.filter((r) => r.sound === 'snare').map((r) => r.time);
    // tick 0 of loop 0 skipped (already past), tick 1440 played, loop 1 tick 0 played
    expect(snares[0]).toBeCloseTo(t0 + 1440 * (0.5 / 480), 9);
    expect(snares[1]).toBeCloseTo(t0 + 2, 9);
    expect(h.rec.slice(0, n0).filter((r) => r.sound === 'snare')).toHaveLength(0);
    expect(new Set(snares.map((t) => t.toFixed(6))).size).toBe(snares.length);
  });

  it('reuses its note buffer (no leakage between passes)', () => {
    const calls: NoteOut[][] = [];
    const src: EventSource = {
      timeSig: () => ({ num: 4, den: 4 }),
      collect(_f, _t, out) {
        calls.push(out);
        expect(out).toHaveLength(0);
        out.push({ tick: _f, offsetTicks: 0, sound: 'kick', vel: 1, gain: 1 });
      },
    };
    const h = setup(src);
    h.s.start();
    run(h, 0.5);
    expect(calls.length).toBeGreaterThan(3);
    expect(new Set(calls).size).toBe(1);
  });
});
