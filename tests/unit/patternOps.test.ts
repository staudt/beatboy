import { describe, it, expect } from 'vitest';
import * as ops from '../../src/domain/patternOps';
import { secondsPerTick } from '../../src/domain/time';
import { DEFAULT_MIX, VELOCITY, type Pattern } from '../../src/domain/types';

const NOW = 1000;
const LATER = 2000;
const clone = <T>(x: T): T => structuredClone(x);

function base(init: Partial<Pattern> = {}): Pattern {
  return ops.createPattern({ id: 'p1', ...init }, NOW);
}

describe('createPattern', () => {
  it('has defaults', () => {
    const p = ops.createPattern({}, 5);
    expect(p).toMatchObject({
      name: 'New beat', category: 'My beats', kind: 'groove', timeSig: { num: 4, den: 4 },
      bars: 1, stepsPerBeat: 4, swing: 0.5, bpm: 100, notes: {}, mix: {}, builtIn: false, createdAt: 5, updatedAt: 5,
    });
    expect(p.id).toMatch(/[0-9a-f-]{36}/);
    expect(ops.createPattern({}, 5).id).not.toBe(p.id);
  });
  it('applies overrides', () => {
    expect(ops.createPattern({ name: 'X', bpm: 77 }).name).toBe('X');
  });
});

describe('velocityLevel', () => {
  it('maps thresholds', () => {
    expect(ops.velocityLevel(1)).toBe('ghost');
    expect(ops.velocityLevel(63)).toBe('ghost');
    expect(ops.velocityLevel(64)).toBe('normal');
    expect(ops.velocityLevel(111)).toBe('normal');
    expect(ops.velocityLevel(112)).toBe('accent');
    expect(ops.velocityLevel(127)).toBe('accent');
  });
});

describe('setStep / getStep', () => {
  it('sets, reads and removes', () => {
    const p = base();
    const q = ops.setStep(p, 'kick', 4, 100, LATER);
    expect(ops.getStep(q, 'kick', 4)).toBe(100);
    expect(q.notes.kick).toEqual([{ tick: 480, vel: 100 }]);
    expect(q.updatedAt).toBe(LATER);
    expect(ops.getStep(q, 'kick', 3)).toBe(0);
    const r = ops.setStep(q, 'kick', 4, 0, LATER);
    expect(r.notes.kick).toBeUndefined();
    expect('kick' in r.notes).toBe(false);
  });
  it('keeps sorted and unique', () => {
    let p = base();
    for (const s of [8, 0, 4, 4, 12]) p = ops.setStep(p, 'snare', s, 90);
    expect(p.notes.snare!.map((n) => n.tick)).toEqual([0, 480, 960, 1440]);
    p = ops.setStep(p, 'snare', 4, 50);
    expect(ops.getStep(p, 'snare', 4)).toBe(50);
    expect(p.notes.snare).toHaveLength(4);
  });
  it('out of range returns same object', () => {
    const p = base();
    expect(ops.setStep(p, 'kick', 16, 100)).toBe(p);
    expect(ops.setStep(p, 'kick', -1, 100)).toBe(p);
  });
  it('is immutable', () => {
    const p = ops.setStep(base(), 'kick', 0, 100);
    const before = clone(p);
    ops.setStep(p, 'kick', 2, 100);
    ops.setStep(p, 'kick', 0, 0);
    expect(p).toEqual(before);
  });
  it('does not match off-grid notes', () => {
    const p = base({ notes: { kick: [{ tick: 130, vel: 90 }] } });
    expect(ops.getStep(p, 'kick', 1)).toBe(0);
  });
});

describe('cycleStep', () => {
  it('off → normal → accent → ghost → off', () => {
    let p = base();
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      p = ops.cycleStep(p, 'kick', 0, LATER);
      seen.push(ops.getStep(p, 'kick', 0));
    }
    expect(seen).toEqual([VELOCITY.normal, VELOCITY.accent, VELOCITY.ghost, 0]);
    expect(p.notes.kick).toBeUndefined();
  });
  it('uses level of existing non-canonical velocity', () => {
    const p = ops.setStep(base(), 'kick', 0, 100);
    expect(ops.getStep(ops.cycleStep(p, 'kick', 0), 'kick', 0)).toBe(VELOCITY.accent);
  });
  it('out of range is no-op', () => {
    const p = base();
    expect(ops.cycleStep(p, 'kick', 99)).toBe(p);
  });
});

const nt = (p: Pattern, id: 'kick' | 'snare' | 'hatClosed' = 'kick') => p.notes[id]?.map((n) => [n.tick, n.vel]);

describe('setBeats', () => {
  it('sets the loop length in beats (1..32) as one bar of x/4', () => {
    expect(ops.setBeats(base(), 3, LATER)).toMatchObject({ timeSig: { num: 3, den: 4 }, bars: 1, updatedAt: LATER });
    expect(ops.setBeats(base(), 0).timeSig).toEqual({ num: 1, den: 4 });
    expect(ops.setBeats(base(), 99).timeSig).toEqual({ num: 32, den: 4 });
  });
  it('shrinking drops notes beyond the new end, growing keeps every tick', () => {
    const p = base({ timeSig: { num: 8, den: 4 }, notes: { kick: [{ tick: 0, vel: 100 }, { tick: 1440, vel: 90 }, { tick: 1920, vel: 80 }, { tick: 3360, vel: 70 }] } });
    expect(nt(ops.setBeats(p, 4))).toEqual([[0, 100], [1440, 90]]);
    expect(nt(ops.setBeats(p, 12))).toEqual([[0, 100], [1440, 90], [1920, 80], [3360, 70]]);
  });
  it('flattens a multi-bar pattern without moving ticks', () => {
    const p = base({ bars: 2, notes: { kick: [{ tick: 1920, vel: 80 }] } });
    const q = ops.setBeats(p, 8);
    expect(q.bars).toBe(1);
    expect(nt(q)).toEqual([[1920, 80]]);
  });
  it('is immutable', () => {
    const p = ops.setStep(base(), 'kick', 12, 100);
    const before = clone(p);
    ops.setBeats(p, 2);
    expect(p).toEqual(before);
  });
});

describe('setStepsPerBeat', () => {
  it('moves nothing when going from triplets to straight on aligned notes', () => {
    let p = ops.setStepsPerBeat(base(), 3);
    p = ops.setStep(p, 'kick', 3, 100); // triplet grid: tick 480
    const q = ops.setStepsPerBeat(p, 4, LATER);
    expect(q.stepsPerBeat).toBe(4);
    expect(q.notes).toEqual(p.notes);
  });
  it('4 -> 3 snaps to triplets (160)', () => {
    const p = base({ notes: { kick: [{ tick: 120, vel: 90 }, { tick: 240, vel: 90 }, { tick: 360, vel: 90 }] } });
    // 120 -> 160, 240 -> 160 (tie goes earlier), 360 -> 320
    expect(nt(ops.setStepsPerBeat(p, 3))).toEqual([[160, 90], [320, 90]]);
  });
  it('merges collisions keeping the max velocity per sound', () => {
    const p = base({ notes: { kick: [{ tick: 0, vel: 60 }, { tick: 60, vel: 120 }, { tick: 70, vel: 80 }], snare: [{ tick: 40, vel: 40 }] } });
    const q = ops.setStepsPerBeat(p, 3);
    expect(nt(q)).toEqual([[0, 120]]);
    expect(nt(q, 'snare')).toEqual([[0, 40]]);
  });
  it('drops notes snapped to the end', () => {
    const p = base({ notes: { kick: [{ tick: 1900, vel: 90 }, { tick: 1700, vel: 90 }] } });
    expect(nt(ops.setStepsPerBeat(p, 3))).toEqual([[1760, 90]]);
  });
  it('leaves nothing off-grid afterwards', () => {
    const p = base({ notes: { kick: [17, 133, 479, 481, 1001].map((tick) => ({ tick, vel: 90 })) } });
    for (const n of [3, 4]) expect(ops.offGridCount(ops.setStepsPerBeat(p, n))).toBe(0);
  });
  it('rejects unsupported resolutions', () => {
    const p = base();
    for (const n of [1, 2, 5, 6, 8]) expect(ops.setStepsPerBeat(p, n)).toBe(p);
  });
});

describe('feel', () => {
  it('feelOf / setFeel', () => {
    const p = base();
    expect(ops.feelOf(p)).toBe('straight');
    const t = ops.setFeel(p, 'triplet', LATER);
    expect(t.stepsPerBeat).toBe(3);
    expect(t.updatedAt).toBe(LATER);
    expect(ops.feelOf(t)).toBe('triplet');
    expect(ops.setFeel(t, 'straight').stepsPerBeat).toBe(4);
  });
  it('setFeel quantizes notes', () => {
    const p = base({ notes: { kick: [{ tick: 120, vel: 90 }] } });
    expect(nt(ops.setFeel(p, 'triplet'))).toEqual([[160, 90]]);
  });
  it('signatureLabel', () => {
    expect(ops.signatureLabel(4, 'straight')).toBe('4/4');
    expect(ops.signatureLabel(3, 'straight')).toBe('3/4');
    expect(ops.signatureLabel(7, 'straight')).toBe('7/4');
    expect(ops.signatureLabel(2, 'triplet')).toBe('6/8');
    expect(ops.signatureLabel(3, 'triplet')).toBe('9/8');
    expect(ops.signatureLabel(4, 'triplet')).toBe('12/8');
    expect(ops.signatureLabel(5, 'triplet')).toBe('5 × triplets');
    expect(ops.signatureLabel(1, 'triplet')).toBe('1 × triplets');
  });
});

describe('addBeat / removeLastBeat / lastBeatHasNotes', () => {
  it('addBeat appends one EMPTY beat', () => {
    const p = base({ notes: { kick: [{ tick: 1440, vel: 100 }] } });
    const q = ops.addBeat(p, LATER);
    expect(q.timeSig).toEqual({ num: 5, den: 4 });
    expect(q.bars).toBe(1);
    expect(q.updatedAt).toBe(LATER);
    expect(nt(q)).toEqual([[1440, 100]]); // no copy
  });
  it('addBeat caps at 32 and is pure', () => {
    const p = base({ timeSig: { num: 32, den: 4 } });
    expect(ops.addBeat(p)).toBe(p);
    const q = base({ notes: { kick: [{ tick: 0, vel: 100 }] } });
    const before = clone(q);
    ops.addBeat(q);
    expect(q).toEqual(before);
  });
  it('removeLastBeat drops the last beat and its notes, min 1', () => {
    const p = base({ notes: { kick: [{ tick: 0, vel: 100 }], snare: [{ tick: 1500, vel: 90 }] } });
    const q = ops.removeLastBeat(p);
    expect(q.timeSig.num).toBe(3);
    expect(nt(q)).toEqual([[0, 100]]);
    expect(q.notes.snare).toBeUndefined();
    const one = base({ timeSig: { num: 1, den: 4 } });
    expect(ops.removeLastBeat(one)).toBe(one);
  });
  it('lastBeatHasNotes', () => {
    expect(ops.lastBeatHasNotes(base({ notes: { kick: [{ tick: 0, vel: 100 }] } }))).toBe(false);
    expect(ops.lastBeatHasNotes(base({ notes: { kick: [{ tick: 1440, vel: 100 }] } }))).toBe(true);
    expect(ops.lastBeatHasNotes(base({ notes: { kick: [{ tick: 1919, vel: 100 }] } }))).toBe(true);
    expect(ops.lastBeatHasNotes(base({ timeSig: { num: 5, den: 4 }, notes: { kick: [{ tick: 1440, vel: 100 }] } }))).toBe(false);
  });
});

describe('toBeatGrid', () => {
  const secs = (p: Pattern, tick: number) => secondsPerTick(p.bpm, p.timeSig) * tick;
  const times = (p: Pattern, id: 'kick' | 'snare' = 'kick') => p.notes[id]?.map((n) => secs(p, n.tick)) ?? [];
  const same = (a: Pattern, b: Pattern, id: 'kick' | 'snare' = 'kick') => {
    const x = times(a, id);
    const y = times(b, id);
    expect(y).toHaveLength(x.length);
    x.forEach((v, i) => expect(y[i]).toBeCloseTo(v, 9));
  };
  const mk = (num: number, den: 2 | 4 | 8 | 16, spb: number, ticks: number[], bars = 1, bpm = 90) =>
    base({ timeSig: { num, den }, stepsPerBeat: spb, bars, bpm, notes: { kick: ticks.map((tick) => ({ tick, vel: 100 })) } });

  it('returns the same object for 4/4 and other den-4 patterns on allowed grids', () => {
    const a = base();
    expect(ops.toBeatGrid(a)).toBe(a);
    const b = mk(7, 4, 3, [0]);
    expect(ops.toBeatGrid(b)).toBe(b);
  });
  it('6/8 @1 -> 2 beats x 3, ticks scaled by 2/3', () => {
    const p = mk(6, 8, 1, [0, 240, 720, 960]);
    const q = ops.toBeatGrid(p);
    expect(q.timeSig).toEqual({ num: 2, den: 4 });
    expect(q.stepsPerBeat).toBe(3);
    expect(nt(q)).toEqual([[0, 100], [160, 100], [480, 100], [640, 100]]);
    expect(q.bpm).toBe(p.bpm);
    same(p, q);
  });
  it('12/8 @1 -> 4 x 3', () => {
    const p = mk(12, 8, 1, [0, 240, 480, 1440, 2640]);
    const q = ops.toBeatGrid(p);
    expect(q.timeSig).toEqual({ num: 4, den: 4 });
    expect(q.stepsPerBeat).toBe(3);
    same(p, q);
  });
  it('12/8 @2 -> 4 x 3 with quantization (6 -> 3)', () => {
    const p = mk(12, 8, 2, [0, 120, 240, 360]);
    const q = ops.toBeatGrid(p);
    expect(q.timeSig).toEqual({ num: 4, den: 4 });
    expect(q.stepsPerBeat).toBe(3);
    // 120 -> 80 (grid 160: tie? 80 is exactly half -> earlier 0), 240 -> 160, 360 -> 240 (tie -> earlier 160? 240 is half of 160..320 -> 160)
    expect(q.notes.kick!.every((n) => n.tick % 160 === 0)).toBe(true);
    expect(nt(q)).toEqual([[0, 100], [160, 100]]);
  });
  it('7/8 @1 -> 7 x 4 (quarters become the straight grid)', () => {
    const p = mk(7, 8, 1, [0, 240, 720, 1200]);
    const q = ops.toBeatGrid(p);
    expect(q.timeSig).toEqual({ num: 7, den: 4 });
    expect(q.stepsPerBeat).toBe(4);
    expect(nt(q)).toEqual([[0, 100], [480, 100], [1440, 100], [2400, 100]]);
    same(p, q);
  });
  it('3/8 @1 -> 3 x 4', () => {
    const q = ops.toBeatGrid(mk(3, 8, 1, [0, 480]));
    expect(q.timeSig).toEqual({ num: 3, den: 4 });
    expect(q.stepsPerBeat).toBe(4);
    expect(nt(q)).toEqual([[0, 100], [960, 100]]);
  });
  it('2/2: the half note is the pulse, so 2 beats with the same steps per beat', () => {
    const p = mk(2, 2, 1, [0, 960]);
    const q = ops.toBeatGrid(p);
    expect(q.timeSig).toEqual({ num: 2, den: 4 });
    expect(q.stepsPerBeat).toBe(4);
    expect(nt(q)).toEqual([[0, 100], [480, 100]]);
    same(p, q);
    const r = mk(2, 2, 4, [0, 240, 960]);
    const s = ops.toBeatGrid(r);
    expect(s.stepsPerBeat).toBe(4);
    expect(nt(s)).toEqual([[0, 100], [120, 100], [480, 100]]);
    same(r, s);
  });
  it('6/8 @2 -> 2 x 3 (quantized); 6/8 @4 -> 2 x 4 via 8 -> 4; den-4 grids 1, 2 -> 4', () => {
    expect(ops.toBeatGrid(mk(6, 8, 2, [0])).stepsPerBeat).toBe(3);
    const q = ops.toBeatGrid(mk(6, 8, 4, [0, 60, 120]));
    expect(q.stepsPerBeat).toBe(4);
    expect(q.notes.kick!.every((n) => n.tick % 120 === 0)).toBe(true);
    for (const spb of [1, 2]) {
      const r = ops.toBeatGrid(mk(4, 4, spb, [0, 960]));
      expect(r.stepsPerBeat).toBe(4);
      expect(nt(r)).toEqual([[0, 100], [960, 100]]);
    }
  });
  it('multi-bar: bars map individually and audible time is preserved', () => {
    const p = mk(6, 8, 1, [0, 240, 1440, 1440 + 720, 2880 + 240], 3);
    const q = ops.toBeatGrid(p);
    expect(q.bars).toBe(1);
    expect(q.timeSig).toEqual({ num: 6, den: 4 }); // 3 bars x 2 beats, flattened
    expect(nt(q)).toEqual([[0, 100], [160, 100], [960, 100], [960 + 480, 100], [1920 + 160, 100]]);
    same(p, q);
  });
  it('den-4 patterns with legacy grids (6, 8 steps) keep the beat and quantize', () => {
    const p = mk(4, 4, 6, [0, 80, 100]);
    const q = ops.toBeatGrid(p);
    expect(q.stepsPerBeat).toBe(3);
    expect(q.timeSig).toEqual({ num: 4, den: 4 });
    expect(q.notes.kick!.every((n) => n.tick % 160 === 0)).toBe(true);
    expect(ops.toBeatGrid(mk(4, 4, 8, [0, 60])).stepsPerBeat).toBe(4);
  });
  it('clamps beats above 32 and drops what no longer fits', () => {
    const p = mk(40, 4, 1, [0, 14880, 15360], 1);
    const q = ops.toBeatGrid(p);
    expect(q.timeSig).toEqual({ num: 32, den: 4 });
    expect(nt(q)).toEqual([[0, 100], [14880, 100]]);
    const r = ops.toBeatGrid(mk(16, 8, 1, [0, 3840 - 240]));
    expect(r.timeSig.num).toBeLessThanOrEqual(32);
  });
  it('keeps every other field and does not mutate the input', () => {
    const p = { ...mk(6, 8, 1, [0, 240]), name: 'Keep', swing: 0.6, mix: { kick: { gain: 0.5, muted: true } } };
    const before = clone(p);
    const q = ops.toBeatGrid(p);
    expect(p).toEqual(before);
    expect(q).toMatchObject({ id: 'p1', name: 'Keep', swing: 0.6, mix: { kick: { gain: 0.5, muted: true } }, updatedAt: p.updatedAt });
  });
});

describe('scalar setters', () => {
  it('clamps swing and bpm', () => {
    expect(ops.setSwing(base(), 0.1).swing).toBe(0.5);
    expect(ops.setSwing(base(), 0.9).swing).toBe(0.75);
    expect(ops.setSwing(base(), 0.6, LATER).swing).toBe(0.6);
    expect(ops.setBpm(base(), 5).bpm).toBe(30);
    expect(ops.setBpm(base(), 999).bpm).toBe(300);
    expect(ops.setBpm(base(), 120, LATER).updatedAt).toBe(LATER);
  });
  it('renames', () => {
    expect(ops.rename(base(), '  Funk  ').name).toBe('Funk');
    expect(ops.rename(base(), '   ').name).toBe('Untitled');
    expect(ops.rename(base(), '', LATER).updatedAt).toBe(LATER);
  });
});

describe('mix', () => {
  it('defaults and merges', () => {
    const p = base();
    expect(ops.getMix(p, 'kick')).toEqual(DEFAULT_MIX);
    const q = ops.setMix(p, 'kick', { gain: 0.5 }, LATER);
    expect(ops.getMix(q, 'kick')).toEqual({ gain: 0.5, muted: false });
    const r = ops.setMix(q, 'kick', { muted: true });
    expect(ops.getMix(r, 'kick')).toEqual({ gain: 0.5, muted: true });
    expect(p.mix).toEqual({});
    expect(q.mix.kick).toEqual({ gain: 0.5, muted: false });
    expect(q.updatedAt).toBe(LATER);
  });
});

describe('clear / duplicate / counts', () => {
  const filled = () => ops.setStep(ops.setStep(base({ mix: { kick: { gain: 1, muted: true } } }), 'kick', 0, 100), 'snare', 4, 100);
  it('clearTrack and clearPattern', () => {
    const p = filled();
    const before = clone(p);
    const q = ops.clearTrack(p, 'kick', LATER);
    expect(q.notes.kick).toBeUndefined();
    expect(q.notes.snare).toBeDefined();
    expect(q.updatedAt).toBe(LATER);
    const r = ops.clearPattern(p, LATER);
    expect(r.notes).toEqual({});
    expect(r.mix).toEqual(p.mix);
    expect(p).toEqual(before);
  });
  it('duplicatePattern', () => {
    const p = { ...filled(), builtIn: true };
    const d = ops.duplicatePattern(p, LATER);
    expect(d.id).not.toBe(p.id);
    expect(d.builtIn).toBe(false);
    expect(d.name).toBe('New beat copy');
    expect(d.createdAt).toBe(LATER);
    expect(d.updatedAt).toBe(LATER);
    expect(d.notes).toEqual(p.notes);
    d.notes.kick![0]!.vel = 1;
    d.mix.kick!.gain = 0;
    expect(p.notes.kick![0]!.vel).toBe(100);
    expect(p.mix.kick!.gain).toBe(1);
    expect(ops.duplicatePattern(p, LATER, 'Mine').name).toBe('Mine');
  });
  it('hasNotes / noteCount', () => {
    const p = filled();
    expect(ops.hasNotes(p, 'kick')).toBe(true);
    expect(ops.hasNotes(p, 'ride')).toBe(false);
    expect(ops.noteCount(p)).toBe(2);
    expect(ops.noteCount(base())).toBe(0);
  });
});
