import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pattern } from '../../src/domain/types';
import { openBeatboyDb } from '../../src/storage/db';
import { PatternRepo, requestPersistentStorage } from '../../src/storage/patternRepo';

let n = 0;
const dbName = () => `test-repo-${++n}`;

function pat(id: string, updatedAt: number, over: Partial<Pattern> = {}): Pattern {
  return {
    id,
    name: id,
    category: 'My beats',
    kind: 'groove',
    timeSig: { num: 8, den: 4 },
    bars: 1,
    stepsPerBeat: 4,
    swing: 0.55,
    bpm: 100,
    notes: { kick: [{ tick: 0, vel: 100 }], hatClosed: [{ tick: 240, vel: 40 }] },
    mix: { kick: { gain: 1, muted: true } },
    builtIn: false,
    createdAt: 1,
    updatedAt,
    ...over,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('PatternRepo', () => {
  it('put/get/delete round-trip', async () => {
    const repo = await PatternRepo.open(dbName());
    const p = pat('a', 5);
    await repo.put(p);
    expect(await repo.get('a')).toEqual(p);
    expect(await repo.list()).toEqual([p]);
    await repo.delete('a');
    expect(await repo.get('a')).toBeUndefined();
    expect(await repo.list()).toEqual([]);
  });

  it('migrates a v1 6/8 record lazily on read and flattens bars and saves back as v3', async () => {
    const name = dbName();
    const raw = await openBeatboyDb(name);
    await raw.put('patterns', { ...pat('old', 1, { timeSig: { num: 6, den: 8 }, bars: 2, stepsPerBeat: 1, notes: { kick: [{ tick: 240, vel: 90 }] } }), schemaVersion: 1 });
    raw.close();
    const repo = await PatternRepo.open(name);
    const p = (await repo.get('old'))!;
    // 6/8 x 2 bars -> 2 triplet beats per bar, flattened into one run of 4 beats
    expect(p.timeSig).toEqual({ num: 4, den: 4 });
    expect(p.bars).toBe(1);
    expect(p.stepsPerBeat).toBe(3);
    expect(p.notes.kick).toEqual([{ tick: 160, vel: 90 }]);
    await repo.put(p);
    expect(await repo.get('old')).toEqual(p);
    expect((await repo.list())[0]).toEqual(p);
  });

  it('lists by updatedAt desc', async () => {
    const repo = await PatternRepo.open(dbName());
    await repo.put(pat('old', 1));
    await repo.put(pat('new', 3));
    await repo.put(pat('mid', 2));
    expect((await repo.list()).map((p) => p.id)).toEqual(['new', 'mid', 'old']);
  });

  it('skips corrupt records with a warning', async () => {
    const name = dbName();
    const repo = await PatternRepo.open(name);
    await repo.put(pat('good', 1));
    const raw = await openBeatboyDb(name);
    await raw.put('patterns', { id: 'bad', garbage: true, updatedAt: 9, schemaVersion: 1 } as never);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await repo.list()).map((p) => p.id)).toEqual(['good']);
    expect(warn).toHaveBeenCalled();
    expect(await repo.get('bad')).toBeUndefined();
    raw.close();
  });

  it('refuses built-in patterns', async () => {
    const repo = await PatternRepo.open(dbName());
    await expect(repo.put(pat('f', 1, { builtIn: true }))).rejects.toThrow();
    expect(await repo.list()).toEqual([]);
  });

  it('stores settings', async () => {
    const repo = await PatternRepo.open(dbName());
    expect(await repo.getSetting('x')).toBeUndefined();
    await repo.setSetting('x', { a: [1, 2] });
    expect(await repo.getSetting('x')).toEqual({ a: [1, 2] });
  });

  it('persists across reopen', async () => {
    const name = dbName();
    const r1 = await PatternRepo.open(name);
    await r1.put(pat('a', 1));
    await r1.setSetting('bpm', 90);
    r1.close();
    const r2 = await PatternRepo.open(name);
    expect(await r2.get('a')).toEqual(pat('a', 1));
    expect(await r2.getSetting('bpm')).toBe(90);
  });

  it('requestPersistentStorage is safe without the API', async () => {
    expect(await requestPersistentStorage()).toBe(false);
  });
});
