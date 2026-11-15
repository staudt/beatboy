import { describe, expect, it } from 'vitest';
import { GrooveSource, type GrooveConfig } from '../../src/engine/grooveSource';
import { PatternLoopSource } from '../../src/engine/patternSource';
import { Scheduler } from '../../src/engine/scheduler';
import type { Clock, NoteOut, NoteSink, SinkSound } from '../../src/engine/types';
import { mkPattern } from './helpers';

const notes = (ticks: number[], vel = 100) => ticks.map((tick) => ({ tick, vel }));

const groove = mkPattern({
  notes: { kick: notes([0, 960]), snare: notes([480, 1440]), hatClosed: notes([0, 240, 480, 720, 960, 1200, 1440, 1680], 80) },
});
// 4-beat fill: snare 16ths in beat 3, toms in beat 4 (ticks within the fill).
const fill4 = mkPattern({
  id: 'fill4',
  kind: 'fill',
  notes: { snare: notes([960, 1080, 1200, 1320]), tomHigh: notes([1440, 1560]), tomFloor: notes([1680, 1800]) },
});

function cfg(over: Partial<GrooveConfig> = {}): GrooveConfig {
  return {
    pattern: groove,
    beatsPerBar: 4,
    click: { enabled: false, volume: 0.5 },
    countInBars: 0,
    fill: fill4,
    crashAfterFill: true,
    ...over,
  };
}

function mk(over: Partial<GrooveConfig> = {}) {
  let c = cfg(over);
  const src = new GrooveSource(() => c);
  return { src, set: (o: Partial<GrooveConfig>) => (c = { ...c, ...o }) };
}

const collect = (s: { collect(a: number, b: number, o: NoteOut[]): void }, a: number, b: number) => {
  const out: NoteOut[] = [];
  s.collect(a, b, out);
  return out;
};
const key = (n: NoteOut) => `${n.tick}|${n.sound}|${n.vel}|${n.gain}|${n.offsetTicks}`;
const sorted = (o: NoteOut[]) => [...o].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
const at = (o: NoteOut[], tick: number) => o.filter((n) => n.tick === tick);
const ticksOf = (o: NoteOut[], sound: SinkSound) => o.filter((n) => n.sound === sound).map((n) => n.tick).sort((a, b) => a - b);

describe('GrooveSource count-in and click', () => {
  it('1 bar of 4/4: clicks at -1920..-480, accent first, nothing else, then the pattern', () => {
    const { src } = mk({ countInBars: 1 });
    expect(src.startTick()).toBe(-1920);
    const pre = collect(src, -1920, 0);
    expect(pre.map((n) => [n.tick, n.sound])).toEqual([
      [-1920, 'clickAccent'],
      [-1440, 'click'],
      [-960, 'click'],
      [-480, 'click'],
    ]);
    expect(pre.every((n) => n.gain === 0.6 && n.offsetTicks === 0)).toBe(true);
    const post = collect(src, 0, 1920);
    expect(post.some((n) => n.tick === 0 && n.sound === 'kick')).toBe(true);
    expect(post.some((n) => n.sound === 'click' || n.sound === 'clickAccent')).toBe(false);
  });

  it('count-in is audible with click disabled and uses the louder of volume and 0.6', () => {
    const { src } = mk({ countInBars: 1, click: { enabled: false, volume: 0.2 } });
    expect(collect(src, -1920, 0)).toHaveLength(4);
    const { src: s2 } = mk({ countInBars: 1, click: { enabled: true, volume: 0.9 } });
    expect(collect(s2, -1920, 0).every((n) => n.gain === 0.9)).toBe(true);
  });

  it('2 bars of 3/4', () => {
    const { src } = mk({ countInBars: 2, beatsPerBar: 3 });
    expect(src.startTick()).toBe(-2880);
    expect(src.timeSig()).toEqual({ num: 3, den: 4 });
    expect(collect(src, -2880, 0).map((n) => [n.tick, n.sound])).toEqual([
      [-2880, 'clickAccent'],
      [-2400, 'click'],
      [-1920, 'click'],
      [-1440, 'clickAccent'],
      [-960, 'click'],
      [-480, 'click'],
    ]);
  });

  it('clicks: accent every beatsPerBar beats, volume as gain, never swung, none when disabled', () => {
    const { src, set } = mk({ click: { enabled: true, volume: 0.3 }, pattern: null, beatsPerBar: 3 });
    const o = collect(src, 0, 4320);
    expect(o.map((n) => n.sound)).toEqual(['clickAccent', 'click', 'click', 'clickAccent', 'click', 'click', 'clickAccent', 'click', 'click']);
    expect(o.every((n) => n.gain === 0.3 && n.offsetTicks === 0)).toBe(true);
    set({ click: { enabled: false, volume: 0.3 } });
    expect(collect(src, 0, 4320)).toHaveLength(0);
    set({ click: { enabled: true, volume: 1 }, pattern: mkPattern({ swing: 0.7, notes: { hatClosed: notes([240]) } }) });
    expect(collect(src, 0, 480).filter((n) => n.sound === 'click' || n.sound === 'clickAccent').every((n) => n.offsetTicks === 0)).toBe(true);
  });

  it('beatsPerBar change mid-play moves the accent', () => {
    const { src, set } = mk({ click: { enabled: true, volume: 1 }, pattern: null });
    expect(ticksOf(collect(src, 0, 1920), 'clickAccent')).toEqual([0]);
    set({ beatsPerBar: 5 });
    expect(ticksOf(collect(src, 1920, 4800), 'clickAccent')).toEqual([2400]);
  });
});

describe('GrooveSource pattern', () => {
  it('matches PatternLoopSource (swing, triplet, mute, gain)', () => {
    const pats = [
      groove,
      mkPattern({ swing: 2 / 3, notes: { hatClosed: notes([0, 120, 240, 360, 480, 600]), kick: notes([0]) } }),
      mkPattern({ stepsPerBeat: 3, swing: 0.7, timeSig: { num: 6, den: 4 }, notes: { hatClosed: notes([0, 160, 320, 480, 2000]) } }),
      mkPattern({ notes: { kick: notes([0, 480]), snare: notes([960]) }, mix: { snare: { gain: 1, muted: true }, kick: { gain: 0.5, muted: false } } }),
    ];
    for (const p of pats) {
      const g = new GrooveSource(() => cfg({ pattern: p, beatsPerBar: 4 }));
      const ref = new PatternLoopSource(() => p);
      expect(sorted(collect(g, 0, 20000))).toEqual(sorted(collect(ref, 0, 20000)));
      expect(sorted(collect(g, 777, 9001))).toEqual(sorted(collect(ref, 777, 9001)));
    }
  });

  it('pattern length independent of the bar (8 beats in 4-beat bars)', () => {
    const p = mkPattern({ timeSig: { num: 8, den: 4 }, notes: { kick: notes([0, 3840 - 480]) } });
    const { src } = mk({ pattern: p, click: { enabled: true, volume: 1 } });
    const o = collect(src, 0, 7680);
    expect(ticksOf(o, 'kick')).toEqual([0, 3360, 3840, 7200]);
    expect(ticksOf(o, 'clickAccent')).toEqual([0, 1920, 3840, 5760]);
  });

  it('click only: pattern null emits no drums', () => {
    const { src } = mk({ pattern: null, click: { enabled: true, volume: 1 } });
    expect(collect(src, 0, 3840).every((n) => n.sound.startsWith('click'))).toBe(true);
  });

  it('contiguous random windows emit every event exactly once (64 bars, fills, count-in, click)', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (const bpb of [3, 4, 7]) {
      const conf = { click: { enabled: true, volume: 0.7 }, beatsPerBar: bpb, countInBars: 2 as const };
      const small = mk(conf);
      const ref = mk(conf);
      const end = 64 * bpb * 480;
      const start = small.src.startTick();
      const fillAt = [5000, 20000 + 7, 31000];
      const smallOut: NoteOut[] = [];
      const triggers: number[] = [];
      let from = start;
      while (from < end) {
        const to = Math.min(end, from + 1 + Math.floor(rnd() * 2000));
        if (fillAt.length && from >= fillAt[0]!) {
          small.src.triggerFill(from);
          triggers.push(from);
          fillAt.shift();
        }
        small.src.collect(from, to, smallOut);
        from = to;
      }
      // reference: one big window between trigger points
      const refOut: NoteOut[] = [];
      let a = start;
      for (const t of [...triggers, end]) {
        ref.src.collect(a, t, refOut);
        if (t !== end) ref.src.triggerFill(t);
        a = t;
      }
      const keys = smallOut.map((n) => `${n.tick}|${n.sound}`);
      expect(new Set(keys).size).toBe(keys.length);
      expect(smallOut.some((n) => n.sound === 'crash')).toBe(true);
      expect(sorted(smallOut)).toEqual(sorted(refOut));
    }
  });

  it('without fills, random windows equal one big window', () => {
    let seed = 99;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const conf = { click: { enabled: true, volume: 0.7 }, countInBars: 1 as const };
    const a = mk(conf).src;
    const b = mk(conf).src;
    const end = 64 * 1920;
    const whole = collect(a, -1920, end);
    const parts: NoteOut[] = [];
    let from = -1920;
    while (from < end) {
      const to = Math.min(end, from + 1 + Math.floor(rnd() * 2000));
      b.collect(from, to, parts);
      from = to;
    }
    expect(sorted(parts)).toEqual(sorted(whole));
  });

  it('config changes between windows take effect (pattern switch, click toggle)', () => {
    const { src, set } = mk();
    expect(collect(src, 0, 480).some((n) => n.sound === 'kick')).toBe(true);
    set({ pattern: mkPattern({ notes: { snare: notes([0]) } }), click: { enabled: true, volume: 1 } });
    const o = collect(src, 1920, 2400);
    expect(o.map((n) => n.sound).sort()).toEqual(['clickAccent', 'snare']);
  });
});

describe('GrooveSource fill', () => {
  const fillRegion = (o: NoteOut[], a: number, b: number) => o.filter((n) => n.tick >= a && n.tick < b);

  it('(a) mid-bar: start at beat 3, end at bar end, plays last 2 beats of the fill, groove silenced, crash+kick', () => {
    const { src } = mk();
    collect(src, 0, 1000); // scheduled up to 1000 (inside beat 2: 960..1440)
    const plan = src.triggerFill(1000);
    expect(plan).toEqual({ start: 1440, end: 1920, fillId: 'fill4' });
    const o = collect(src, 1000, 3840);
    const region = fillRegion(o, 1440, 1920);
    // tail of the fill: fill ticks 1440 (tomHigh), 1560 and 1680, 1800 (toms floor) -> absolute = 1920-1920+f = f
    expect(region.map((n) => [n.tick, n.sound]).sort((x, y) => (x[0] as number) - (y[0] as number))).toEqual([
      [1440, 'tomHigh'],
      [1560, 'tomHigh'],
      [1680, 'tomFloor'],
      [1800, 'tomFloor'],
    ]);
    // groove before the window is untouched
    expect(o.some((n) => n.tick === 1200 && n.sound === 'hatClosed')).toBe(true);
    const down = at(o, 1920);
    expect(down.find((n) => n.sound === 'crash')!.vel).toBe(120);
    expect(down.find((n) => n.sound === 'kick')!.vel).toBe(110); // groove's own kick (100) merged with max(100, 110)
  });

  it('(b) pressed in the last beat: whole next bar', () => {
    const { src } = mk();
    expect(src.triggerFill(1500)).toEqual({ start: 1920, end: 3840, fillId: 'fill4' });
    // whole bar -> all 8 fill notes are heard
    const o = collect(src, 1500, 3840);
    const fillNotes = fillRegion(o, 1920, 3840);
    expect(fillNotes.map((n) => n.sound).sort()).toEqual(['snare', 'snare', 'snare', 'snare', 'tomFloor', 'tomFloor', 'tomHigh', 'tomHigh']);
    expect(fillNotes.some((n) => n.sound === 'kick' || n.sound === 'hatClosed')).toBe(false);
  });

  it('(c) pressed exactly on a bar boundary: whole bar from there', () => {
    const { src } = mk();
    expect(src.triggerFill(1920)).toEqual({ start: 1920, end: 3840, fillId: 'fill4' });
    const { src: s2 } = mk();
    expect(s2.triggerFill(1921)!.start).toBe(2400);
  });

  it('(d) second press while queued/active is ignored', () => {
    const { src } = mk();
    const p1 = src.triggerFill(1000)!;
    expect(src.triggerFill(1500)).toBe(p1);
    collect(src, 1000, 1500);
    expect(src.triggerFill(1500)).toBe(p1);
    expect(src.triggerFill(1900)).toBe(p1);
    expect(src.fill).toBe(p1);
  });

  it('(e) fillPhase none -> queued -> active -> none; plan cleared a beat after end', () => {
    const { src } = mk();
    expect(src.fillPhase(0)).toBe('none');
    src.triggerFill(1000); // 1440..1920
    expect(src.fillPhase(999)).toBe('queued');
    expect(src.fillPhase(1439)).toBe('queued');
    expect(src.fillPhase(1440)).toBe('active');
    expect(src.fillPhase(1919)).toBe('active');
    expect(src.fillPhase(1920)).toBe('none');
    collect(src, 1000, 2399);
    expect(src.fill).not.toBeNull();
    collect(src, 2399, 2500); // lo = 2399 < 1920+480
    expect(src.fill).not.toBeNull();
    collect(src, 2500, 2600);
    expect(src.fill).toBeNull();
    expect(src.triggerFill(2600)).not.toBeNull(); // new fill possible again
  });

  it('cancelFill removes a queued fill', () => {
    const { src } = mk();
    src.triggerFill(1000);
    src.cancelFill();
    expect(src.fill).toBeNull();
    const o = collect(src, 1000, 1920);
    expect(o.some((n) => n.sound === 'tomHigh')).toBe(false);
    expect(o.some((n) => n.sound === 'crash')).toBe(false);
  });

  it('(f) 3/4 bar with a 4-beat fill pressed on a bar boundary: tail of 3 beats', () => {
    const { src } = mk({ beatsPerBar: 3 });
    expect(src.triggerFill(1440)).toEqual({ start: 1440, end: 2880, fillId: 'fill4' });
    const o = collect(src, 1440, 2881);
    const f = fillRegion(o, 1440, 2880).filter((n) => ['snare', 'tomHigh', 'tomFloor'].includes(n.sound));
    // fill tick f -> 2880-1920+f = 960+f; window [1440,2880) -> f in [480,1920): drops the first beat's notes (none) -> all 8
    expect(f).toHaveLength(8 - 0);
    expect(Math.min(...f.map((n) => n.tick))).toBe(960 + 960);
  });

  it('(g) 7-beat bar with a 4-beat fill: first 3 beats keep the groove', () => {
    const p = mkPattern({ timeSig: { num: 7, den: 4 }, notes: { kick: notes([0, 480, 960, 1440, 1920, 2400, 2880]) } });
    const { src } = mk({ beatsPerBar: 7, pattern: p });
    const plan = src.triggerFill(0)!;
    expect(plan).toEqual({ start: 0, end: 3360, fillId: 'fill4' });
    const o = collect(src, 0, 3360);
    // fill occupies [1440, 3360): groove silenced there
    expect(ticksOf(o, 'kick')).toEqual([0, 480, 960]);
    expect(fillRegion(o, 1440, 3360).some((n) => n.sound === 'kick')).toBe(false);
    expect(ticksOf(o, 'snare')[0]).toBe(1440 + 960);
  });

  it('(h) no fill pattern or count-in -> null', () => {
    const { src } = mk({ fill: null });
    expect(src.triggerFill(1000)).toBeNull();
    expect(src.fill).toBeNull();
    const { src: s2 } = mk({ countInBars: 1 });
    expect(s2.triggerFill(-960)).toBeNull();
    expect(s2.fill).toBeNull();
    expect(s2.triggerFill(0)).not.toBeNull();
  });

  it('(i) crash dedupe when the groove already has crash/kick at end', () => {
    const p = mkPattern({ notes: { crash: notes([0], 90), kick: notes([0], 127), hatClosed: notes([480]) } });
    const { src } = mk({ pattern: p });
    src.triggerFill(1000);
    const o = collect(src, 1000, 2400);
    expect(at(o, 1920).filter((n) => n.sound === 'crash')).toHaveLength(1);
    expect(at(o, 1920).find((n) => n.sound === 'crash')!.vel).toBe(120);
    expect(at(o, 1920).filter((n) => n.sound === 'kick')).toHaveLength(1);
    expect(at(o, 1920).find((n) => n.sound === 'kick')!.vel).toBe(127);
  });

  it('crashAfterFill off: no crash; short fill keeps the groove before its own start', () => {
    const short = mkPattern({ id: 's', timeSig: { num: 1, den: 4 }, notes: { snare: notes([0, 240]) } });
    const { src } = mk({ fill: short, crashAfterFill: false });
    src.triggerFill(1000); // 1440..1920, fill covers 1440..1920? len 480 -> 1440..1920
    const o = collect(src, 1000, 2400);
    expect(o.some((n) => n.sound === 'crash')).toBe(false);
    expect(ticksOf(fillRegion(o, 1440, 1920), 'snare')).toEqual([1440, 1680]);
    // groove kicks at 960 and snare at 1440 of the groove are replaced
    expect(fillRegion(o, 1440, 1920).some((n) => n.sound === 'hatClosed')).toBe(false);
    // shorter than window: 2-beat window with a 1-beat fill -> beat 1 groove stays
    const { src: s2 } = mk({ fill: short, crashAfterFill: false });
    s2.triggerFill(480); // start 480, end 1920? 480 not bar boundary -> end 1920; fill covers 1440..1920
    const o2 = collect(s2, 480, 1920);
    expect(o2.some((n) => n.tick === 960 && n.sound === 'kick')).toBe(true);
    expect(o2.some((n) => n.tick === 1440 && n.sound === 'hatClosed')).toBe(false);
  });

  it('fill uses its own swing', () => {
    const f = mkPattern({ id: 'sw', swing: 2 / 3, notes: { hatClosed: notes([1680]) } });
    const { src } = mk({ fill: f });
    src.triggerFill(1000);
    const o = collect(src, 1000, 1920).filter((n) => n.sound === 'hatClosed' && n.tick === 1680);
    // tick 1680 is the "&"-less 16th: tickInBeat 240 -> offset 40*... = (2/3 - 0.5)*480
    expect(o[0]!.offsetTicks).toBeCloseTo(80);
  });
});

describe('GrooveSource with the Scheduler', () => {
  class FakeClock implements Clock {
    t = 10;
    now() {
      return this.t;
    }
  }
  function rig(over: Partial<GrooveConfig>) {
    const clock = new FakeClock();
    const rec: { time: number; sound: SinkSound; tick: number }[] = [];
    const sink: NoteSink = {
      play: (time, sound) => rec.push({ time, sound, tick: s.tickAt(time) }),
      stopAll: () => {},
    };
    const src = new GrooveSource(() => cfg(over));
    const s = new Scheduler({ clock, sink, source: src });
    s.setBpm(120);
    const run = (sec: number) => {
      const end = clock.t + sec;
      while (clock.t < end) {
        clock.t += 0.025;
        s.pump();
      }
    };
    return { clock, rec, src, s, run };
  }

  it('count-in: first click at start time, downbeat 2.0 s later', () => {
    const h = rig({ countInBars: 1, click: { enabled: true, volume: 0.5 } });
    const t0 = h.clock.t + 0.06;
    h.s.start(h.src.startTick());
    h.run(3);
    const clicks = h.rec.filter((r) => r.sound.startsWith('click'));
    expect(clicks[0]!.time).toBeCloseTo(t0, 9);
    expect(clicks[0]!.sound).toBe('clickAccent');
    const down = h.rec.find((r) => r.sound === 'kick')!;
    expect(down.time).toBeCloseTo(t0 + 2.0, 9);
    expect(clicks.find((c) => Math.abs(c.time - (t0 + 2)) < 1e-9)!.sound).toBe('clickAccent');
    expect(h.rec.filter((r) => r.time < t0 + 2 - 1e-9).every((r) => r.sound.startsWith('click'))).toBe(true);
  });

  it('a fill triggered while running lands on the computed ticks/times', () => {
    const h = rig({ countInBars: 0, click: { enabled: false, volume: 1 } });
    const t0 = h.clock.t + 0.06;
    h.s.start(0);
    h.run(0.7); // scheduledUntil ~ tick of (0.7+0.12-0.06) s
    const su = h.s.scheduledUntil;
    expect(su).toBeGreaterThan(600);
    const plan = h.src.triggerFill(su)!;
    expect(plan.start).toBe(Math.ceil(su / 480) * 480);
    expect(plan.end).toBe(1920 * Math.ceil((plan.start + 1) / 1920));
    h.run(3);
    const spt = 0.5 / 480;
    const crash = h.rec.find((r) => r.sound === 'crash')!;
    expect(crash.time).toBeCloseTo(t0 + plan.end * spt, 9);
    const toms = h.rec.filter((r) => r.sound === 'tomFloor' || r.sound === 'tomHigh');
    expect(toms.length).toBeGreaterThan(0);
    for (const n of toms) {
      expect(n.tick).toBeGreaterThanOrEqual(plan.start - 1e-6);
      expect(n.tick).toBeLessThan(plan.end);
    }
  });
});
