import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoSong } from '../../src/domain/songOps';
import type { Song } from '../../src/domain/song';
import { DB_VERSION, SONG_SCHEMA_VERSION } from '../../src/storage/db';
import { migrateSong, validateSong } from '../../src/storage/migrations';
import { PatternRepo } from '../../src/storage/patternRepo';

let n = 0;
const dbName = () => `test-songs-${++n}`;
afterEach(() => vi.restoreAllMocks());

const sec = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  kind: 'verse',
  name: 'Verse',
  patternId: 'p',
  bars: 8,
  fill: { enabled: true, patternId: 'f' },
  loop: true,
  ...over,
});
const raw = (over: Record<string, unknown> = {}) => ({
  id: 'song1',
  name: 'Song',
  bpm: 120,
  beatsPerBar: 4,
  fillId: 'f-fill-toms',
  sections: [sec()],
  createdAt: 1,
  updatedAt: 2,
  ...over,
});

describe('validateSong', () => {
  it('round-trips a valid song', () => {
    expect(validateSong(raw())).toEqual(raw());
    const d = demoSong(5);
    expect(validateSong(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });

  it('rejects non-objects and records without id', () => {
    for (const v of [null, undefined, 5, 'x', [], raw({ id: '' }), raw({ id: 3 })]) expect(validateSong(v)).toBeNull();
    const { id: _id, ...noId } = raw();
    expect(validateSong(noId)).toBeNull();
  });

  it('clamps and repairs song fields', () => {
    const s = validateSong(raw({ bpm: 9999, beatsPerBar: 12.4, name: '   ', fillId: 7, createdAt: 'x', updatedAt: NaN }))!;
    expect(s).toMatchObject({ bpm: 300, beatsPerBar: 7, name: 'Untitled song', fillId: null, createdAt: 0, updatedAt: 0 });
    expect(validateSong(raw({ bpm: 1, beatsPerBar: -3 }))).toMatchObject({ bpm: 30, beatsPerBar: 1 });
    expect(validateSong(raw({ bpm: 'fast', beatsPerBar: undefined }))).toMatchObject({ bpm: 100, beatsPerBar: 4 });
    expect(validateSong(raw({ sections: 'nope' }))!.sections).toEqual([]);
  });

  it('repairs sections: clamp bars, kinds, names; drops broken ones; caps at 32', () => {
    const s = validateSong(
      raw({
        sections: [
          sec({ id: 'a', bars: 500 }),
          sec({ id: 'b', bars: 0 }),
          sec({ id: 'c', bars: 2.6 }),
          sec({ id: 'd', kind: 'weird', name: '  ' }),
          sec({ id: 'e', name: ' Hook ' }),
          sec({ id: '' }),
          sec({ id: 'g', patternId: '' }),
          sec({ id: 'h', patternId: 4 }),
          sec({ id: 'i', fill: 'bad', loop: 'yes' }),
          null,
          5,
        ],
      }),
    )!;
    expect(s.sections.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'i']);
    expect(s.sections.map((x) => x.bars)).toEqual([64, 1, 3, 8, 8, 8]);
    expect(s.sections[3]).toMatchObject({ kind: 'custom', name: 'Section' });
    expect(s.sections[4]!.name).toBe('Hook');
    expect(s.sections[5]).toMatchObject({ fill: { enabled: false, patternId: null }, loop: false });
    const many = validateSong(raw({ sections: Array.from({ length: 50 }, (_, i) => sec({ id: `x${i}` })) }))!;
    expect(many.sections).toHaveLength(32);
  });

  it('duplicate section ids are regenerated', () => {
    const s = validateSong(raw({ sections: [sec({ id: 'a' }), sec({ id: 'a' })] }))!;
    expect(new Set(s.sections.map((x) => x.id)).size).toBe(2);
  });

  it('migrateSong: current/unversioned ok, future or invalid rejected', () => {
    expect(migrateSong({ ...raw(), schemaVersion: SONG_SCHEMA_VERSION })).toEqual(raw());
    expect(migrateSong(raw())).toEqual(raw());
    expect(migrateSong({ ...raw(), schemaVersion: 99 })).toBeNull();
    expect(migrateSong({ ...raw(), schemaVersion: 0 })).toBeNull();
    expect(migrateSong(null)).toBeNull();
  });
});

describe('SongRepo', () => {
  it('put/get/list/delete round-trip, newest first', async () => {
    const repo = await PatternRepo.open(dbName());
    const a: Song = { ...demoSong(1), id: 'a', updatedAt: 10 };
    const b: Song = { ...demoSong(1), id: 'b', updatedAt: 20 };
    await repo.songs.put(a);
    await repo.songs.put(b);
    expect(await repo.songs.get('a')).toEqual(a);
    expect((await repo.songs.list()).map((s) => s.id)).toEqual(['b', 'a']);
    await repo.songs.put({ ...a, name: 'Renamed', updatedAt: 30 });
    expect((await repo.songs.list()).map((s) => s.name)).toEqual(['Renamed', b.name]);
    await repo.songs.delete('a');
    expect(await repo.songs.get('a')).toBeUndefined();
    expect(await repo.songs.list()).toHaveLength(1);
    repo.close();
  });

  it('skips corrupt records with a warning', async () => {
    const name = dbName();
    const repo = await PatternRepo.open(name);
    await repo.songs.put({ ...demoSong(1), id: 'good', updatedAt: 5 });
    repo.close();
    const db = await openDB(name, DB_VERSION);
    await db.put('songs', { id: 'bad', schemaVersion: 99 });
    await db.put('songs', { id: 'bad2', schemaVersion: 1, sections: [], name: 3 }); // repairable
    db.close();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const repo2 = await PatternRepo.open(name);
    const ids = (await repo2.songs.list()).map((s) => s.id).sort();
    expect(ids).toEqual(['bad2', 'good']);
    expect(warn).toHaveBeenCalled();
    expect(await repo2.songs.get('bad')).toBeUndefined();
    repo2.close();
  });

  it('shares one connection with the pattern repo (songs and patterns coexist)', async () => {
    const repo = await PatternRepo.open(dbName());
    await repo.setSetting('k', 1);
    await repo.songs.put(demoSong(1));
    expect(await repo.getSetting('k')).toBe(1);
    expect(await repo.songs.list()).toHaveLength(1);
    repo.close();
  });
});

describe('DB upgrade v1 -> v2', () => {
  it('keeps existing patterns/settings and adds the songs store', async () => {
    const name = dbName();
    const v1 = await openDB(name, 1, {
      upgrade(db) {
        const p = db.createObjectStore('patterns', { keyPath: 'id' });
        p.createIndex('updatedAt', 'updatedAt');
        db.createObjectStore('settings');
      },
    });
    await v1.put('patterns', {
      id: 'old',
      name: 'Old beat',
      category: 'My beats',
      kind: 'groove',
      timeSig: { num: 4, den: 4 },
      bars: 1,
      stepsPerBeat: 4,
      swing: 0.5,
      bpm: 100,
      notes: { kick: [{ tick: 0, vel: 100 }] },
      mix: {},
      builtIn: false,
      createdAt: 1,
      updatedAt: 2,
      schemaVersion: 3,
    });
    await v1.put('settings', 'keep', 'me');
    v1.close();

    expect(DB_VERSION).toBe(2);
    const repo = await PatternRepo.open(name);
    expect((await repo.list()).map((p) => p.id)).toEqual(['old']);
    expect(await repo.getSetting('me')).toBe('keep');
    expect(await repo.songs.list()).toEqual([]);
    const s = demoSong(3);
    await repo.songs.put(s);
    expect(await repo.songs.get(s.id)).toEqual(s);
    repo.close();

    const db = await openDB(name, 2);
    expect([...db.objectStoreNames].sort()).toEqual(['patterns', 'settings', 'songs']);
    expect(db.transaction('songs').store.indexNames.contains('updatedAt')).toBe(true);
    db.close();
  });
});
