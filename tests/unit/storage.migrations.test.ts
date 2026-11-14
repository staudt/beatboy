import { describe, expect, it } from 'vitest';
import type { Pattern } from '../../src/domain/types';
import { migratePattern, validatePattern } from '../../src/storage/migrations';

function base(): Pattern {
  return {
    id: 'p1',
    name: 'Groove',
    category: 'Rock',
    kind: 'groove',
    timeSig: { num: 4, den: 4 },
    bars: 1,
    stepsPerBeat: 4,
    swing: 0.5,
    bpm: 120,
    notes: {
      kick: [
        { tick: 0, vel: 96 },
        { tick: 960, vel: 127 },
      ],
    },
    mix: { kick: { gain: 1.2, muted: false } },
    builtIn: false,
    createdAt: 1,
    updatedAt: 2,
  };
}

describe('storage migrations/validation', () => {
  it('round-trips a valid pattern', () => {
    const p = base();
    expect(validatePattern(p)).toEqual(p);
    expect(migratePattern({ ...p, schemaVersion: 1 })).toEqual(p);
  });

  it('treats missing schemaVersion as v1', () => {
    expect(migratePattern(base())).toEqual(base());
  });

  it('rejects unknown future schema versions', () => {
    expect(migratePattern({ ...base(), schemaVersion: 99 })).toBeNull();
  });

  it('sorts and dedupes notes', () => {
    const p = base();
    p.notes.snare = [
      { tick: 960, vel: 50 },
      { tick: 0, vel: 60 },
      { tick: 960, vel: 70 },
    ];
    expect(validatePattern(p)!.notes.snare).toEqual([
      { tick: 0, vel: 60 },
      { tick: 960, vel: 70 },
    ]);
  });

  it('drops invalid mix entries', () => {
    const p: any = base();
    p.mix = {
      kick: { gain: 2, muted: false },
      snare: { gain: 1, muted: 'no' },
      clap: { gain: NaN, muted: false },
      hatOpen: { gain: 0.5, muted: true },
      bogus: { gain: 1, muted: false },
    };
    expect(validatePattern(p)!.mix).toEqual({ hatOpen: { gain: 0.5, muted: true } });
  });

  it('clamps swing and bpm', () => {
    expect(validatePattern({ ...base(), swing: 0.9, bpm: 1000 })).toMatchObject({ swing: 0.75, bpm: 300 });
    expect(validatePattern({ ...base(), swing: 0.1, bpm: 5 })).toMatchObject({ swing: 0.5, bpm: 30 });
  });

  it('rejects bad time signature, bars, stepsPerBeat', () => {
    expect(validatePattern({ ...base(), timeSig: { num: 4, den: 5 } })).toBeNull();
    expect(validatePattern({ ...base(), timeSig: { num: 0, den: 4 } })).toBeNull();
    expect(validatePattern({ ...base(), bars: 9 })).toBeNull();
    expect(validatePattern({ ...base(), stepsPerBeat: 5 })).toBeNull();
  });

  it('drops unknown sounds but keeps the record', () => {
    const p: any = base();
    p.notes.cabasa = [{ tick: 0, vel: 90 }];
    const v = validatePattern(p)!;
    expect(v).not.toBeNull();
    expect(Object.keys(v.notes)).toEqual(['kick']);
  });

  it('drops invalid notes (tick out of range, bad vel, non-integers)', () => {
    const p: any = base();
    p.notes.kick = [
      { tick: 1920, vel: 90 },
      { tick: -1, vel: 90 },
      { tick: 1.5, vel: 90 },
      { tick: 10, vel: 0 },
      { tick: 11, vel: 128 },
      { tick: 1919, vel: 100 },
    ];
    expect(validatePattern(p)!.notes.kick).toEqual([{ tick: 1919, vel: 100 }]);
  });

  it('drops unknown fields and trims/falls back strings', () => {
    const v: any = validatePattern({ ...base(), name: '  ', category: '  Funk ', extra: 1 });
    expect(v.name).toBe('Untitled');
    expect(v.category).toBe('Funk');
    expect('extra' in v).toBe(false);
    expect(validatePattern({ ...base(), category: 5 })!.category).toBe('My beats');
  });

  it('returns null for garbage', () => {
    for (const g of [null, undefined, 42, 'x', [], {}, { id: 'a' }]) {
      expect(migratePattern(g)).toBeNull();
      expect(validatePattern(g)).toBeNull();
    }
  });
});
