import { describe, expect, it } from 'vitest';
import {
  practiceSong,
  addSection,
  createSection,
  createSong,
  demoSong,
  duplicateSection,
  moveSection,
  removeSection,
  renameSong,
  setBeatsPerBar,
  setSongBpm,
  setSongFill,
  songsUsingPattern,
  updateSection,
} from '../../src/domain/songOps';
import { factoryPatterns } from '../../src/domain/factory';
import { SONG_LIMITS } from '../../src/domain/song';

const base = () => {
  let s = createSong({ name: 'X' }, 100);
  s = addSection(s, createSection('verse', 'a'), undefined, 101);
  s = addSection(s, createSection('chorus', 'b', 8), undefined, 102);
  s = addSection(s, createSection('outro', 'c', 2), undefined, 103);
  return s;
};

describe('songOps', () => {
  it('createSong / createSection defaults', () => {
    const s = createSong({}, 5);
    expect(s).toMatchObject({ name: 'New song', bpm: 100, beatsPerBar: 4, fillId: null, sections: [], createdAt: 5, updatedAt: 5 });
    const sec = createSection('chorus', 'p', 999);
    expect(sec).toMatchObject({ kind: 'chorus', name: 'Chorus', patternId: 'p', bars: 64, loop: false, fill: { enabled: false, patternId: null } });
    expect(createSection('custom', 'p').name).toBe('Section');
    expect(createSection('verse', 'p', 0).bars).toBe(1);
    expect(createSection('verse', 'p').id).not.toBe(createSection('verse', 'p').id);
  });

  it('immutable ops bump updatedAt', () => {
    const s = base();
    const frozen = JSON.stringify(s);
    const ids = s.sections.map((x) => x.id);
    const m = moveSection(s, 0, 2, 200);
    expect(m.sections.map((x) => x.id)).toEqual([ids[1], ids[2], ids[0]]);
    expect(m.updatedAt).toBe(200);
    expect(moveSection(s, 2, 0, 1).sections.map((x) => x.id)).toEqual([ids[2], ids[0], ids[1]]);
    expect(moveSection(s, 0, 99, 1).sections[2]!.id).toBe(ids[0]);
    expect(moveSection(s, 5, 0, 1)).toBe(s);
    expect(JSON.stringify(s)).toBe(frozen);
  });

  it('add (index), duplicate, remove, limit', () => {
    const s = base();
    const x = createSection('bridge', 'z');
    expect(addSection(s, x, 1, 9).sections[1]).toBe(x);
    const d = duplicateSection(s, s.sections[1]!.id, 7);
    expect(d.sections).toHaveLength(4);
    expect(d.sections[2]).toMatchObject({ patternId: 'b', bars: 8, name: 'Chorus' });
    expect(d.sections[2]!.id).not.toBe(d.sections[1]!.id);
    expect(d.sections[2]!.fill).not.toBe(d.sections[1]!.fill);
    expect(removeSection(d, d.sections[0]!.id, 8).sections).toHaveLength(3);
    expect(removeSection(s, 'nope')).toBe(s);
    let full = createSong();
    for (let i = 0; i < 40; i++) full = addSection(full, createSection('verse', 'a'));
    expect(full.sections).toHaveLength(SONG_LIMITS.maxSections);
    expect(duplicateSection(full, full.sections[0]!.id)).toBe(full);
  });

  it('updateSection clamps and merges fill', () => {
    const s = base();
    const id = s.sections[0]!.id;
    const u = updateSection(s, id, { bars: 500, name: '  ', fill: { enabled: true }, loop: true }, 50);
    expect(u.sections[0]).toMatchObject({ bars: 64, name: 'Verse', loop: true, fill: { enabled: true, patternId: null } });
    expect(u.updatedAt).toBe(50);
    expect(updateSection(s, id, { bars: -3 }).sections[0]!.bars).toBe(1);
    expect(updateSection(s, id, { kind: 'bogus' as never }).sections[0]!.kind).toBe('custom');
    expect(updateSection(s, id, { patternId: 'q', fill: { patternId: 'f' } }).sections[0]).toMatchObject({ patternId: 'q', fill: { enabled: false, patternId: 'f' } });
    expect(updateSection(s, 'missing', { bars: 2 })).toBe(s);
  });

  it('song settings clamp', () => {
    const s = createSong();
    expect(setSongBpm(s, 1000).bpm).toBe(300);
    expect(setSongBpm(s, 3).bpm).toBe(30);
    expect(setSongBpm(s, 99.6).bpm).toBe(100);
    expect(setBeatsPerBar(s, 9).beatsPerBar).toBe(7);
    expect(setBeatsPerBar(s, 0).beatsPerBar).toBe(1);
    expect(renameSong(s, '  Hi ').name).toBe('Hi');
    expect(renameSong(s, '   ').name).toBe('Untitled song');
    expect(setSongFill(s, 'f-fill-toms').fillId).toBe('f-fill-toms');
  });

  it('songsUsingPattern finds groove, section fill and default fill references', () => {
    const a = updateSection(base(), base().sections[0]!.id, {});
    const b = setSongFill(createSong(), 'fx');
    let c = addSection(createSong(), createSection('verse', 'g'));
    c = updateSection(c, c.sections[0]!.id, { fill: { enabled: true, patternId: 'fy' } });
    const s1 = base();
    expect(songsUsingPattern([s1, b, c, a], 'b')).toEqual([s1, a]);
    expect(songsUsingPattern([s1, b, c], 'fx')).toEqual([b]);
    expect(songsUsingPattern([s1, b, c], 'fy')).toEqual([c]);
    expect(songsUsingPattern([s1, b, c], 'none')).toEqual([]);
  });

  it('demoSong references existing factory patterns', () => {
    const d = demoSong(1);
    const ids = new Set(factoryPatterns().map((p) => p.id));
    expect(d.sections.map((s) => s.bars)).toEqual([4, 8, 8, 8, 8, 4, 8, 4]);
    expect(d.sections.map((s) => s.kind)).toEqual(['intro', 'verse', 'chorus', 'verse', 'chorus', 'bridge', 'chorus', 'outro']);
    expect(d.bpm).toBe(112);
    expect(d.beatsPerBar).toBe(4);
    expect(d.fillId).toBe('f-fill-toms');
    expect(d.sections.filter((s) => s.fill.enabled).map((s) => s.name)).toEqual(['Chorus 1', 'Chorus 2', 'Bridge']);
    for (const s of d.sections) expect(ids.has(s.patternId)).toBe(true);
    expect(ids.has(d.fillId!)).toBe(true);
    expect(new Set(d.sections.map((s) => s.id)).size).toBe(8);
  });
});

describe('practiceSong', () => {
  it('is one looping Rock 8ths section of 4 bars at the given tempo', () => {
    const s = practiceSong(133);
    expect(s).toMatchObject({ name: 'Practice', bpm: 133, beatsPerBar: 4 });
    expect(s.sections).toHaveLength(1);
    expect(s.sections[0]).toMatchObject({ patternId: 'f-rock-8ths', bars: 4, loop: true });
  });
});
