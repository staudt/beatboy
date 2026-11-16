import { describe, expect, it } from 'vitest';
import type { Song } from '../../src/domain/song';
import { createSection, createSong } from '../../src/domain/songOps';
import { PATTERN_SCHEMA_VERSION } from '../../src/storage/db';
import {
  agoLabel,
  exportFileName,
  exportLibrary,
  exportSong,
  parseImport,
  planImport,
  serialize,
  type ImportPlan,
} from '../../src/storage/exportImport';
import { mkPattern } from './helpers';

const NOW = new Date('2026-01-02T03:04:05Z');

/** A song with a library groove, a song-local beat, a fill and a built-in groove. */
function fixture() {
  const groove = mkPattern({ id: 'g1', name: 'My groove', notes: { kick: [{ tick: 0, vel: 100 }] } });
  const fill = mkPattern({ id: 'fl1', name: 'My fill', kind: 'fill' });
  const beat = mkPattern({ id: 'b1', name: 'S · Verse', ownerSongId: 's1', notes: { snare: [{ tick: 480, vel: 90 }] } });
  const song: Song = createSong(
    {
      id: 's1',
      name: 'Song One',
      fillId: 'fl1',
      sections: [
        { ...createSection('verse', 'b1', 4), id: 'x1', fill: { enabled: true, patternId: 'fl1' } },
        { ...createSection('chorus', 'g1', 8), id: 'x2' },
        { ...createSection('outro', 'f-rock-8ths', 2), id: 'x3' },
      ],
    },
    1000,
  );
  return { groove, fill, beat, song, patterns: [groove, fill, beat] };
}

const parse = (text: string) => {
  const r = parseImport(text);
  if (!r.ok) throw new Error(r.error);
  return r;
};
const apply = (plan: ImportPlan, local: { patterns: ReturnType<typeof mkPattern>[]; songs: Song[] }) => ({
  patterns: [...local.patterns.filter((p) => !plan.patterns.some((q) => q.id === p.id)), ...plan.patterns],
  songs: [...local.songs.filter((s) => !plan.songs.some((q) => q.id === s.id)), ...plan.songs],
});

describe('export', () => {
  it('library: user patterns (incl. song-local), songs, settings, versions', () => {
    const f = fixture();
    const built = mkPattern({ id: 'f-x', builtIn: true });
    const file = exportLibrary({ patterns: [...f.patterns, built], songs: [f.song], drummer: { bpm: 90 } }, { now: NOW });
    expect(file).toMatchObject({ format: 'beatboy', version: 1, kind: 'library', exportedAt: NOW.toISOString(), settings: { drummer: { bpm: 90 } } });
    expect(file.patterns.map((p) => p.id).sort()).toEqual(['b1', 'fl1', 'g1']);
    expect(file.patterns.every((p) => p.schemaVersion === PATTERN_SCHEMA_VERSION)).toBe(true);
    expect(file.songs).toHaveLength(1);
    expect(file.songs[0]!.schemaVersion).toBe(1);
  });

  it('song: that song plus referenced user + song-local patterns, never built-ins or others', () => {
    const f = fixture();
    const other = mkPattern({ id: 'unused' });
    const file = exportSong(f.song, [...f.patterns, other, mkPattern({ id: 'f-rock-8ths', builtIn: true })], { now: NOW });
    expect(file.kind).toBe('song');
    expect(file.settings).toBeUndefined();
    expect(file.songs.map((s) => s.id)).toEqual(['s1']);
    expect(file.patterns.map((p) => p.id).sort()).toEqual(['b1', 'fl1', 'g1']);
  });

  it("song: another song's local beat travels as a normal groove", () => {
    const f = fixture();
    const alien = { ...f.beat, ownerSongId: 'zzz' };
    const file = exportSong(f.song, [f.groove, f.fill, alien]);
    expect(file.patterns.find((p) => p.id === 'b1')!.ownerSongId).toBeUndefined();
  });

  it('file names are sanitized', () => {
    expect(exportFileName('A/B: "c"?*')).toBe('AB c.beatboy.json');
    expect(exportFileName('  ../..  ')).toBe('song.beatboy.json');
    expect(exportFileName('x'.repeat(200)).length).toBeLessThan(100);
  });

  it('agoLabel', () => {
    const t = 10_000_000_000;
    expect(agoLabel(null)).toBe('never');
    expect(agoLabel(t, t + 5000)).toBe('just now');
    expect(agoLabel(t, t + 5 * 60_000)).toBe('5 minutes ago');
    expect(agoLabel(t, t + 3 * 3600_000)).toBe('3 hours ago');
    expect(agoLabel(t, t + 24 * 3600_000)).toBe('yesterday');
    expect(agoLabel(t, t + 3 * 86400_000)).toBe('3 days ago');
  });
});

describe('parseImport', () => {
  it('round trip: export -> parse -> plan(keepBoth into empty) reproduces everything', () => {
    const f = fixture();
    const text = serialize(exportLibrary({ patterns: f.patterns, songs: [f.song] }, { now: NOW }));
    const r = parse(text);
    expect(r.warnings).toEqual([]);
    const plan = planImport({ patterns: [], songs: [] }, r, 'keepBoth');
    expect(plan.songs).toEqual([f.song]);
    expect([...plan.patterns].sort((a, b) => a.id.localeCompare(b.id))).toEqual([...f.patterns].sort((a, b) => a.id.localeCompare(b.id)));
    expect(plan.summary).toEqual({ songsAdded: 1, songsReplaced: 0, patternsAdded: 3, patternsReplaced: 0, skipped: 0 });
    expect(plan.conflicts).toBe(0);
    expect(plan.firstSongId).toBe('s1');
    expect(plan.warnings).toEqual([]);
  });

  it.each([
    ['garbage', 'not json at all', /JSON/],
    ['a json array', '[1,2]', /isn't a Beatboy file/],
    ['wrong format', JSON.stringify({ format: 'other', version: 1, songs: [], patterns: [] }), /isn't a Beatboy file/],
    ['a future version', JSON.stringify({ format: 'beatboy', version: 2, songs: [], patterns: [] }), /newer version/],
    ['a bad version', JSON.stringify({ format: 'beatboy', version: 'x' }), /version/],
    ['nothing inside', JSON.stringify({ format: 'beatboy', version: 1, songs: [], patterns: [] }), /no songs or beats/],
  ])('rejects %s with a readable error', (_n, text, re) => {
    const r = parseImport(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(re);
  });

  it('skips invalid records and counts them; keeps the rest', () => {
    const f = fixture();
    const file = serialize(exportLibrary({ patterns: f.patterns, songs: [f.song] }, { now: NOW }));
    const o = JSON.parse(file);
    o.patterns.push({ id: 'bad' }, 42, { ...o.patterns[0], id: 'future', schemaVersion: 99 });
    o.songs.push({ name: 'no id' });
    const r = parse(JSON.stringify(o));
    expect(r.patterns).toHaveLength(3);
    expect(r.songs).toHaveLength(1);
    expect(r.warnings).toEqual(['1 song could not be read and was skipped', '3 patterns could not be read and were skipped']);
  });

  it('ignores built-in patterns', () => {
    const f = fixture();
    const o = JSON.parse(serialize(exportLibrary({ patterns: f.patterns, songs: [f.song] })));
    o.patterns.push({ ...o.patterns[0], id: 'f-rock-8ths', builtIn: true }, { ...o.patterns[0], id: 'f-fill-toms' });
    const r = parse(JSON.stringify(o));
    expect(r.patterns.map((p) => p.id).sort()).toEqual(['b1', 'fl1', 'g1']);
  });

  it('migrates old records', () => {
    const f = fixture();
    const o = JSON.parse(serialize(exportLibrary({ patterns: f.patterns, songs: [f.song] })));
    for (const p of o.patterns) p.schemaVersion = 3;
    expect(parse(JSON.stringify(o)).patterns).toHaveLength(3);
  });
});

describe('planImport', () => {
  const incoming = () => {
    const f = fixture();
    return { f, inc: { patterns: f.patterns, songs: [f.song] } };
  };

  it('identical records are skipped', () => {
    const { f, inc } = incoming();
    const plan = planImport({ patterns: f.patterns, songs: [f.song] }, inc, 'keepBoth');
    expect(plan.patterns).toEqual([]);
    expect(plan.songs).toEqual([]);
    expect(plan.summary.skipped).toBe(4);
    expect(plan.conflicts).toBe(0);
    expect(plan.firstSongId).toBe('s1');
  });

  it('keepBoth: a changed song becomes a copy with new ids and consistent references', () => {
    const { f, inc } = incoming();
    const local = { patterns: f.patterns, songs: [{ ...f.song, bpm: 77 }] };
    const plan = planImport(local, inc, 'keepBoth');
    expect(plan.conflicts).toBe(1);
    expect(plan.songs).toHaveLength(1);
    const s = plan.songs[0]!;
    expect(s.id).not.toBe('s1');
    expect(s.name).toBe('Song One (imported)');
    // the song's own beat got a new id and the new owner; library patterns are shared, untouched
    expect(plan.patterns).toHaveLength(1);
    const b = plan.patterns[0]!;
    expect(b.id).not.toBe('b1');
    expect(b.ownerSongId).toBe(s.id);
    expect(s.sections[0]!.patternId).toBe(b.id);
    expect(s.sections[1]!.patternId).toBe('g1');
    expect(s.sections[2]!.patternId).toBe('f-rock-8ths');
    expect(s.fillId).toBe('fl1');
    expect(s.sections[0]!.fill.patternId).toBe('fl1');
    expect(plan.firstSongId).toBe(s.id);
    expect(plan.summary).toMatchObject({ songsAdded: 1, patternsAdded: 1, skipped: 2 });
    // the local song and its beat are untouched
    const all = apply(plan, local);
    expect(all.songs.find((x) => x.id === 's1')!.bpm).toBe(77);
    expect(all.patterns.find((p) => p.id === 'b1')!.ownerSongId).toBe('s1');
  });

  it('keepBoth: a changed groove gets a new id and the songs that use it follow', () => {
    const { f, inc } = incoming();
    const local = { patterns: [{ ...f.groove, name: 'Local edit' }], songs: [] as Song[] };
    const plan = planImport(local, inc, 'keepBoth');
    const g = plan.patterns.find((p) => p.name === 'My groove (imported)')!;
    expect(g.id).not.toBe('g1');
    expect(plan.songs[0]!.sections[1]!.patternId).toBe(g.id);
    expect(plan.songs[0]!.name).toBe('Song One'); // no name collision, new id kept
    expect(plan.songs[0]!.id).toBe('s1');
    expect(plan.conflicts).toBe(1);
  });

  it('keepBoth: a new song whose name is taken gets the suffix', () => {
    const { f, inc } = incoming();
    // An edited local song (untouched starter songs give way instead — see below).
    const other = { ...createSong({ id: 'other', name: 'Song One' }, 1), updatedAt: 2 };
    const plan = planImport({ patterns: [], songs: [other] }, inc, 'keepBoth');
    expect(plan.songDeletes).toEqual([]);
    expect(plan.songs[0]!.id).toBe('s1');
    expect(plan.songs[0]!.name).toBe('Song One (imported)');
    expect(plan.patterns).toHaveLength(3);
    void f;
  });

  it('replace overwrites local records, keeping ids', () => {
    const { f, inc } = incoming();
    const local = {
      patterns: [{ ...f.beat, name: 'old beat' }, { ...f.groove, name: 'old groove' }],
      songs: [{ ...f.song, bpm: 77 }],
    };
    const plan = planImport(local, inc, 'replace');
    expect(plan.songs).toEqual([f.song]);
    expect(plan.patterns.map((p) => p.id).sort()).toEqual(['b1', 'fl1', 'g1']);
    expect(plan.summary).toEqual({ songsAdded: 0, songsReplaced: 1, patternsAdded: 1, patternsReplaced: 2, skipped: 0 });
    const all = apply(plan, local);
    expect(all.songs).toHaveLength(1);
    expect(all.songs[0]!.bpm).toBe(f.song.bpm);
    expect(all.patterns.find((p) => p.id === 'g1')!.name).toBe('My groove');
  });

  it('never imports built-ins', () => {
    const { inc } = incoming();
    const plan = planImport({ patterns: [], songs: [] }, { ...inc, patterns: [...inc.patterns, mkPattern({ id: 'f-x', builtIn: true }), mkPattern({ id: 'f-fill-toms' })] }, 'keepBoth');
    expect(plan.patterns.some((p) => p.id.startsWith('f-'))).toBe(false);
  });

  it('warns about references that resolve nowhere and keeps them', () => {
    const { f } = incoming();
    const plan = planImport({ patterns: [], songs: [] }, { patterns: [f.groove], songs: [f.song] }, 'keepBoth');
    // b1 and fl1 are not in the file
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toMatch(/2 beats/);
    expect(plan.songs[0]!.sections[0]!.patternId).toBe('b1');
    // present locally -> fine
    const ok = planImport({ patterns: f.patterns, songs: [] }, { patterns: [], songs: [f.song] }, 'keepBoth');
    expect(ok.warnings).toEqual([]);
  });

  it('a beat whose owner song is nowhere becomes a normal groove', () => {
    const { f } = incoming();
    const plan = planImport({ patterns: [], songs: [] }, { patterns: [f.beat], songs: [] }, 'keepBoth');
    expect(plan.patterns[0]!.ownerSongId).toBeUndefined();
  });

  it('a file imported twice: the second time everything is skipped', () => {
    const { f, inc } = incoming();
    const first = planImport({ patterns: [], songs: [] }, inc, 'keepBoth');
    const local = apply(first, { patterns: [], songs: [] });
    const second = planImport(local, inc, 'keepBoth');
    expect(second.patterns).toEqual([]);
    expect(second.songs).toEqual([]);
    void f;
  });
});

describe('planImport: untouched starter songs give way', () => {
  it('replaces a never-edited local song with the same name instead of adding an "(imported)" twin', async () => {
    const { createSong } = await import('../../src/domain/songOps');
    const { planImport } = await import('../../src/storage/exportImport');
    const fresh = { ...createSong({ name: 'Practice' }, 1000), id: 'local-practice' };
    const edited = { ...createSong({ name: 'Demo song' }, 1000), id: 'local-demo', updatedAt: 2000 };
    const incPractice = { ...createSong({ name: 'Practice' }, 500), id: 'backup-practice', bpm: 90 };
    const incDemo = { ...createSong({ name: 'Demo song' }, 500), id: 'backup-demo' };
    const plan = planImport({ patterns: [], songs: [fresh, edited] }, { patterns: [], songs: [incPractice, incDemo] }, 'keepBoth');
    expect(plan.songDeletes).toEqual(['local-practice']);
    const names = plan.songs.map((s) => s.name).sort();
    expect(names).toEqual(['Demo song (imported)', 'Practice']);
  });
});
