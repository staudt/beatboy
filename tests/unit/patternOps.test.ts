import { describe, it, expect } from 'vitest';
import * as ops from '../../src/domain/patternOps';
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

describe('setBars', () => {
  it('grows by repeating cyclically', () => {
    let p = ops.setStep(base(), 'kick', 0, 100);
    p = ops.setStep(p, 'snare', 4, 90);
    const q = ops.setBars(p, 2, LATER);
    expect(q.bars).toBe(2);
    expect(q.notes.kick!.map((n) => n.tick)).toEqual([0, 1920]);
    expect(q.notes.snare!.map((n) => n.tick)).toEqual([480, 2400]);
    expect(q.updatedAt).toBe(LATER);
    const r = ops.setBars(q, 5);
    expect(r.notes.kick!.map((n) => n.tick)).toEqual([0, 1920, 3840, 5760, 7680]);
  });
  it('grows 2 → 3 cycling', () => {
    let p = ops.setBars(ops.setStep(base(), 'kick', 0, 100), 2);
    p = ops.setStep(p, 'kick', 16, 0);
    const q = ops.setBars(p, 3);
    expect(q.notes.kick!.map((n) => n.tick)).toEqual([0, 3840]);
  });
  it('shrinks by truncating', () => {
    const p = ops.setBars(ops.setStep(base(), 'kick', 0, 100), 4);
    const q = ops.setBars(p, 2);
    expect(q.notes.kick!.map((n) => n.tick)).toEqual([0, 1920]);
    const r = ops.setBars(ops.setStep(ops.setStep(base(), 'kick', 0, 1), 'snare', 4, 1), 1);
    expect(r.bars).toBe(1);
  });
  it('drops emptied tracks', () => {
    let p = ops.setBars(base(), 2);
    p = ops.setStep(p, 'kick', 20, 100);
    expect(ops.setBars(p, 1).notes.kick).toBeUndefined();
  });
  it('clamps', () => {
    expect(ops.setBars(base(), 99).bars).toBe(8);
    expect(ops.setBars(base(), 0).bars).toBe(1);
  });
  it('is immutable', () => {
    const p = ops.setBars(ops.setStep(base(), 'kick', 0, 100), 2);
    const before = clone(p);
    ops.setBars(p, 4);
    ops.setBars(p, 1);
    expect(p).toEqual(before);
  });
});

describe('setTimeSig', () => {
  it('keeps ticks and drops beyond end', () => {
    let p = ops.setStep(base(), 'kick', 0, 100);
    p = ops.setStep(p, 'kick', 12, 100); // tick 1440
    const q = ops.setTimeSig(p, { num: 3, den: 4 }, LATER);
    expect(q.timeSig).toEqual({ num: 3, den: 4 });
    expect(q.notes.kick).toEqual([{ tick: 0, vel: 100 }]);
    const r = ops.setTimeSig(p, { num: 7, den: 8 });
    expect(r.notes.kick).toHaveLength(2);
    expect(p.timeSig).toEqual({ num: 4, den: 4 });
  });
});

describe('setStepsPerBeat / offGridCount', () => {
  it('is non-destructive', () => {
    const p = ops.setStep(base(), 'kick', 1, 100);
    const q = ops.setStepsPerBeat(p, 3, LATER);
    expect(q.stepsPerBeat).toBe(3);
    expect(q.notes).toEqual(p.notes);
  });
  it('counts off-grid notes', () => {
    let p = ops.setStep(base(), 'kick', 1, 100); // tick 120
    expect(ops.offGridCount(p)).toBe(0);
    p = ops.setStepsPerBeat(p, 2); // grid 240
    expect(ops.offGridCount(p)).toBe(1);
    p = ops.setStepsPerBeat(p, 4);
    expect(ops.offGridCount(p)).toBe(0);
  });
  it('rejects unsupported resolutions', () => {
    const p = base();
    expect(ops.setStepsPerBeat(p, 5)).toBe(p);
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
