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

  it('migrates a stored v1 6/8 pattern to 2 beats x 3 steps', () => {
    const v1 = {
      ...base(),
      timeSig: { num: 6, den: 8 },
      stepsPerBeat: 1,
      bars: 2,
      notes: { kick: [{ tick: 0, vel: 100 }, { tick: 720, vel: 90 }, { tick: 1440, vel: 80 }, { tick: 1440 + 240, vel: 70 }] },
      schemaVersion: 1,
    };
    const m = migratePattern(v1)!;
    expect(m.timeSig).toEqual({ num: 4, den: 4 }); // 2 beats x 2 bars, flattened
    expect(m.stepsPerBeat).toBe(3);
    expect(m.bars).toBe(1);
    expect(m.notes.kick).toEqual([
      { tick: 0, vel: 100 },
      { tick: 480, vel: 90 },
      { tick: 960, vel: 80 },
      { tick: 960 + 160, vel: 70 },
    ]);
    // v1 4/4 on a legacy 8-step grid gets a legal grid
    expect(migratePattern({ ...base(), stepsPerBeat: 8, schemaVersion: 1 })!.stepsPerBeat).toBe(4);
  });

  it('v2 records must be den 4; v3 needs 3 or 4 steps per beat', () => {
    const odd = { ...base(), timeSig: { num: 6, den: 8 }, schemaVersion: 2 };
    expect(migratePattern(odd)).toBeNull();
    expect(validatePattern({ ...base(), timeSig: { num: 33, den: 4 } })).toBeNull();
    expect(validatePattern({ ...base(), timeSig: { num: 32, den: 4 } })).not.toBeNull();
    expect(validatePattern({ ...base(), bars: 2 })).toBeNull(); // v3 is always a single bar of beats
    expect(validatePattern({ ...base(), stepsPerBeat: 6 })).toBeNull();
    expect(validatePattern({ ...base(), stepsPerBeat: 3 })).not.toBeNull();
    for (const n of [1, 2]) expect(validatePattern({ ...base(), stepsPerBeat: n })).toBeNull();
  });

  it('migrates v2 -> v3: 1 or 2 steps per beat become 4 and no note moves', () => {
    for (const n of [1, 2]) {
      const v2 = { ...base(), stepsPerBeat: n, bars: 2, notes: { kick: [{ tick: 0, vel: 96 }, { tick: 480, vel: 96 }, { tick: 2400, vel: 90 }] }, schemaVersion: 2 };
      const m = migratePattern(v2)!;
      expect(m.stepsPerBeat).toBe(4);
      expect(m.notes.kick).toEqual(v2.notes.kick);
      expect(m.bars).toBe(1); // bars are flattened into beats: 4 beats x 2 bars = 8 beats
      expect(m.timeSig).toEqual({ num: 8, den: 4 });
    }
    expect(migratePattern({ ...base(), stepsPerBeat: 3, schemaVersion: 2 })!.stepsPerBeat).toBe(3);
    expect(migratePattern({ ...base(), stepsPerBeat: 4, schemaVersion: 2 })!.stepsPerBeat).toBe(4);
  });

  it('flattening clamps at 32 beats and drops the notes beyond', () => {
    const v2 = { ...base(), timeSig: { num: 7, den: 4 }, bars: 8, notes: { kick: [{ tick: 0, vel: 90 }, { tick: 31 * 480, vel: 90 }, { tick: 32 * 480, vel: 90 }] }, schemaVersion: 2 };
    const m = migratePattern(v2)!;
    expect(m.timeSig.num).toBe(32);
    expect(m.notes.kick!.map((n) => n.tick)).toEqual([0, 31 * 480]);
  });

  it('migrates v1 -> v3 through both steps', () => {
    const v1 = { ...base(), timeSig: { num: 4, den: 4 }, stepsPerBeat: 2, schemaVersion: 1 };
    expect(migratePattern(v1)!.stepsPerBeat).toBe(4);
    const six = { ...base(), timeSig: { num: 6, den: 8 }, stepsPerBeat: 2, schemaVersion: 1, notes: { kick: [{ tick: 0, vel: 90 }] } };
    const m = migratePattern(six)!;
    expect(m.timeSig).toEqual({ num: 2, den: 4 });
    expect(m.stepsPerBeat).toBe(3);
    const q = { ...base(), timeSig: { num: 3, den: 8 }, stepsPerBeat: 1, schemaVersion: 1, notes: { kick: [{ tick: 0, vel: 90 }, { tick: 240, vel: 90 }] } };
    const mq = migratePattern(q)!;
    expect(mq.timeSig).toEqual({ num: 3, den: 4 });
    expect(mq.stepsPerBeat).toBe(4);
    expect(mq.notes.kick!.map((n) => n.tick)).toEqual([0, 480]);
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
