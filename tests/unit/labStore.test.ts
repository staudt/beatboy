import { describe, expect, it } from 'vitest';
import { factoryPatterns } from '../../src/domain/factory';
import { createPattern, getStep, hasNotes, rename, setStep } from '../../src/domain/patternOps';
import { VELOCITY, type Pattern } from '../../src/domain/types';
import { applyEdit, applyTempo, effectiveBpm, nextBeatName, removePattern } from '../../src/ui/state/labLogic';

const builtin = factoryPatterns().find((p) => p.id === 'f-rock-8ths') as Pattern;
const lib = (): Pattern[] => [...factoryPatterns()];

describe('copy-on-write edits', () => {
  it('copies a built-in on first edit and switches to the copy', () => {
    const state = { library: lib(), currentId: builtin.id };
    const res = applyEdit(state, {}, (p) => setStep(p, 'tomHigh', 3, VELOCITY.accent), 1000);
    expect(res.copiedFrom?.id).toBe(builtin.id);
    expect(res.changed?.name).toBe('My Rock 8ths');
    expect(res.changed?.builtIn).toBe(false);
    expect(res.currentId).toBe(res.changed?.id);
    expect(res.library).toHaveLength(state.library.length + 1);
    expect(hasNotes(res.changed as Pattern, 'tomHigh')).toBe(true);
    // the built-in is untouched
    expect(hasNotes(builtin, 'tomHigh')).toBe(false);
    expect(res.library.find((p) => p.id === builtin.id)).toBe(builtin);
  });

  it('edits user patterns in place', () => {
    const mine = createPattern({ name: 'Mine' });
    const state = { library: [...lib(), mine], currentId: mine.id };
    const res = applyEdit(state, {}, (p) => setStep(p, 'kick', 0, 100), 5);
    expect(res.copiedFrom).toBeNull();
    expect(res.currentId).toBe(mine.id);
    expect(res.library).toHaveLength(state.library.length);
    expect(getStep(res.changed as Pattern, 'kick', 0)).toBe(100);
  });

  it('is a no-op (no copy) when the edit changes nothing', () => {
    const state = { library: lib(), currentId: builtin.id };
    const res = applyEdit(state, {}, (p) => p, 5);
    expect(res.changed).toBeNull();
    expect(res.library).toBe(state.library);
  });

  it('renaming a built-in saves a copy with the new name', () => {
    const state = { library: lib(), currentId: builtin.id };
    const res = applyEdit(state, {}, (p) => rename(p, 'Groove A'), 5);
    expect(res.changed?.name).toBe('Groove A');
  });

  it('carries a built-in tempo override onto its copy', () => {
    const state = { library: lib(), currentId: builtin.id };
    const res = applyEdit(state, { [builtin.id]: 150 }, (p) => setStep(p, 'kick', 1, 100), 5);
    expect(res.changed?.bpm).toBe(150);
    expect(res.overrides[builtin.id]).toBeUndefined();
  });
});

describe('tempo', () => {
  it('overrides in memory for built-ins without copying', () => {
    const state = { library: lib(), currentId: builtin.id };
    const res = applyTempo(state, {}, 133, 1);
    expect(res.changed).toBeNull();
    expect(res.library).toBe(state.library);
    expect(effectiveBpm(builtin, res.overrides)).toBe(133);
  });

  it('edits user patterns', () => {
    const mine = createPattern({ bpm: 100 });
    const res = applyTempo({ library: [mine], currentId: mine.id }, {}, 90, 1);
    expect(res.changed?.bpm).toBe(90);
    expect(res.library[0]?.bpm).toBe(90);
    expect(res.overrides).toEqual({});
  });

  it('clamps to limits', () => {
    const mine = createPattern();
    expect(applyTempo({ library: [mine], currentId: mine.id }, {}, 999, 1).bpm).toBe(300);
    expect(applyTempo({ library: [mine], currentId: mine.id }, {}, 1, 1).bpm).toBe(30);
  });
});

describe('naming and deletion', () => {
  it('numbers new beats', () => {
    expect(nextBeatName(lib())).toBe('Beat 1');
    expect(nextBeatName([...lib(), createPattern({ name: 'Beat 1' }), createPattern({ name: 'Beat 4' })])).toBe('Beat 5');
  });

  it('refuses to delete built-ins', () => {
    expect(removePattern({ library: lib(), currentId: builtin.id }, builtin.id, builtin.id)).toBeNull();
  });

  it('deleting the current pattern moves to another', () => {
    const a = createPattern({ name: 'A' });
    const b = createPattern({ name: 'B' });
    const res = removePattern({ library: [...lib(), a, b], currentId: a.id }, a.id, builtin.id);
    expect(res?.currentId).toBe(b.id);
    const res2 = removePattern({ library: [...lib(), b], currentId: b.id }, b.id, builtin.id);
    expect(res2?.currentId).toBe(builtin.id);
  });

  it('deleting another pattern keeps the current one', () => {
    const a = createPattern();
    const res = removePattern({ library: [...lib(), a], currentId: builtin.id }, a.id, builtin.id);
    expect(res?.currentId).toBe(builtin.id);
    expect(res?.library.some((p) => p.id === a.id)).toBe(false);
  });
});
