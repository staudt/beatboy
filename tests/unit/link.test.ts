import { describe, expect, it } from 'vitest';
import { focusPatternId, songGrooves } from '../../src/ui/state/songLogic';
import { groupWithLeading } from '../../src/ui/common/PatternPicker';
import { demoSong } from '../../src/domain/songOps';
import { factoryPatterns } from '../../src/domain/factory';
import type { Pattern } from '../../src/domain/types';
import { editorPlayAction, playingTabs, routeChangeAction } from '../../src/ui/state/linkLogic';

type Mode = 'idle' | 'lab' | 'song';
const st = (mode: Mode, editorId: string, songPatternId: string | null = null, focusPatternId: string | null = null) => ({
  mode,
  editorId,
  songPatternId,
  focusPatternId,
});

describe('routeChangeAction', () => {
  it('drummer -> editor selects the groove of the section that is playing; playback continues', () => {
    expect(routeChangeAction('drummer', 'editor', st('song', 'e1', 's1'))).toEqual({ selectEditor: 's1', stop: false });
  });
  it('drummer -> editor: nothing to link when idle, already linked or no section pattern', () => {
    expect(routeChangeAction('drummer', 'editor', st('idle', 'e1', 's1'))).toEqual({ selectEditor: null, stop: false });
    expect(routeChangeAction('drummer', 'editor', st('song', 's1', 's1'))).toEqual({ selectEditor: null, stop: false });
    expect(routeChangeAction('drummer', 'editor', st('song', 'e1', null))).toEqual({ selectEditor: null, stop: false });
  });
  it('drummer -> editor while stopped opens the focus section\'s pattern; playing wins over focus', () => {
    expect(routeChangeAction('drummer', 'editor', st('idle', 'e1', null, 'f1'))).toEqual({ selectEditor: 'f1', stop: false });
    expect(routeChangeAction('drummer', 'editor', st('idle', 'f1', null, 'f1')).selectEditor).toBeNull();
    expect(routeChangeAction('drummer', 'editor', st('song', 'e1', 's1', 'f1')).selectEditor).toBe('s1');
  });
  it('editor -> drummer stops only the editor-owned (lab) playback', () => {
    expect(routeChangeAction('editor', 'drummer', st('lab', 'e1', 's1')).stop).toBe(true);
    expect(routeChangeAction('editor', 'drummer', st('song', 's1', 's1')).stop).toBe(false);
    expect(routeChangeAction('editor', 'drummer', st('idle', 'e1')).stop).toBe(false);
  });
});

describe('editorPlayAction', () => {
  it('stops when anything plays, otherwise loops the pattern', () => {
    expect(editorPlayAction({ playing: true })).toBe('stop');
    expect(editorPlayAction({ playing: false })).toBe('pattern');
  });
});

describe('playingTabs', () => {
  it('marks the tabs whose content is playing', () => {
    expect(playingTabs({ mode: 'song' })).toEqual({ drummer: true, editor: false });
    expect(playingTabs({ mode: 'lab' })).toEqual({ drummer: false, editor: true });
    expect(playingTabs({ mode: 'idle' })).toEqual({ drummer: false, editor: false });
  });
});

describe('focusPatternId', () => {
  const song = demoSong(1);
  const [a, b, c] = song.sections;
  it('focus section, else start section, else section 1', () => {
    expect(focusPatternId(song, c!.id, b!.id)).toBe(c!.patternId);
    expect(focusPatternId(song, null, b!.id)).toBe(b!.patternId);
    expect(focusPatternId(song, 'gone', null)).toBe(a!.patternId);
    expect(focusPatternId(null, null, null)).toBeNull();
  });
});

describe('song group in the editor picker', () => {
  const F = factoryPatterns();
  const song = demoSong(1);
  const local = { ...F[0]!, id: 'loc', name: 'Local beat', builtIn: false, category: 'Mine', ownerSongId: song.id } as Pattern;
  const other = { ...F[0]!, id: 'oth', name: 'Other beat', builtIn: false, category: 'Mine', ownerSongId: 'x' } as Pattern;
  const withLocal = { ...song, sections: [{ ...song.sections[0]!, patternId: 'loc' }, ...song.sections.slice(1)] };
  const lib = [...F, local, other];
  const visible = lib.filter((p) => !p.ownerSongId);
  const lead = (s = withLocal) => {
    const g = songGrooves(s, lib);
    return { title: `In ${s.name}`, patterns: g.patterns, searchText: (p: Pattern) => (g.sections.get(p.id) ?? []).join(' ') };
  };
  it('dedupes in section order, includes song beats, names the sections', () => {
    const g = songGrooves(withLocal, lib);
    expect(g.patterns.map((p) => p.id)).toEqual(['loc', 'f-rock-8ths', 'f-rock-16ths', 'f-half-time']);
    expect(g.sections.get('f-rock-8ths')).toEqual(['Verse 1', 'Verse 2', 'Outro']);
  });
  it('lists the song group first and not again below; other songs\' beats never show', () => {
    const groups = groupWithLeading(visible, lead(), '');
    expect(groups[0]![0]).toBe('In Demo song');
    const lead0 = new Set(groups[0]![1].map((p) => p.id));
    for (const [, l] of groups.slice(1)) for (const p of l) expect(lead0.has(p.id)).toBe(false);
    const all = groups.flatMap(([, l]) => l.map((p) => p.id));
    expect(all).toContain('loc');
    expect(all).not.toContain('oth');
  });
  it('find matches name, category and section names across groups', () => {
    expect(groupWithLeading(visible, lead(), 'bridge')[0]).toEqual(['In Demo song', [expect.objectContaining({ id: 'f-half-time' })]]);
    expect(groupWithLeading(visible, lead(), 'zzzz')).toEqual([]);
    expect(groupWithLeading(visible, lead(), 'ride').flatMap(([, l]) => l).length).toBeGreaterThan(0);
  });
});
