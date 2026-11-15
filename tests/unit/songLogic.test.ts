import { describe, expect, it } from 'vitest';
import { factoryPatterns } from '../../src/domain/factory';
import { createSong, createSection, demoSong } from '../../src/domain/songOps';
import {
  buildSongConfig,
  clampStartIndex,
  newSectionFor,
  nextSongName,
  sameInfo,
  sectionIndexForKey,
  sectionName,
  songBpmToWrite,
  usedInMessage,
} from '../../src/ui/state/songLogic';

describe('buildSongConfig', () => {
  it('looks patterns up in the shared library and passes the shared settings', () => {
    const song = demoSong();
    const cfg = buildSongConfig(song, factoryPatterns(), { click: { enabled: false, volume: 0.3 }, countInBars: 2, crashAfterFill: false });
    expect(cfg.song).toBe(song);
    expect(cfg.getPattern('f-rock-8ths')?.name).toBe('Rock 8ths');
    expect(cfg.getPattern('nope')).toBeNull();
    expect(cfg.click).toEqual({ enabled: false, volume: 0.3 });
    expect(cfg.countInBars).toBe(2);
    expect(cfg.crashAfterFill).toBe(false);
  });
});

describe('tempo sync', () => {
  const song = createSong({ bpm: 100 });
  it('writes the shared tempo to the song only when it differs', () => {
    expect(songBpmToWrite(song, 120)).toBe(120);
    expect(songBpmToWrite(song, 100)).toBeNull();
    expect(songBpmToWrite(null, 120)).toBeNull();
  });
});

describe('section placement and naming', () => {
  const song = createSong({
    sections: [createSection('intro', 'a', 4), createSection('verse', 'b', 8), createSection('chorus', 'c', 8)],
  });
  const ids = song.sections.map((s) => s.id);
  it('names repeated kinds Verse, Verse 2, ...', () => {
    expect(sectionName(song, 'bridge')).toBe('Bridge');
    expect(sectionName(song, 'verse')).toBe('Verse 2');
  });
  it('new sections inherit the previous groove', () => {
    expect(newSectionFor(song, 'solo', 2, 'zz').patternId).toBe('b');
    expect(newSectionFor(createSong(), 'intro', 0, 'zz').patternId).toBe('zz');
    expect(newSectionFor(song, 'chorus', 3, 'zz').name).toBe('Chorus 2');
  });
  it('start index follows the selected id', () => {
    expect(clampStartIndex(song, ids[1]!)).toBe(1);
    expect(clampStartIndex(song, null)).toBe(0);
    expect(clampStartIndex(song, 'gone')).toBe(0);
    expect(clampStartIndex(null, ids[1]!)).toBe(0);
  });
});

describe('misc', () => {
  it('numbers new songs', () => {
    expect(nextSongName([])).toBe('Song 1');
    expect(nextSongName([createSong({ name: 'Song 3' }), createSong({ name: 'Arena' })])).toBe('Song 4');
  });
  it('used-in message', () => {
    expect(usedInMessage(['A', 'B'])).toBe('Used in: A, B.');
  });
  it('sameInfo compares the displayed fields', () => {
    const i = { sectionIndex: 0, barInSection: 1, sectionBars: 4, beat: 2, countIn: null, loop: false, phase: 'normal', breakQueued: false, fillQueued: false, nextSectionIndex: 1, queued: null };
    expect(sameInfo(i, { ...i })).toBe(true);
    expect(sameInfo(i, { ...i, beat: 3 })).toBe(false);
    expect(sameInfo(i, { ...i, queued: { kind: 'next', sectionIndex: 1 } })).toBe(false);
    expect(sameInfo(null, i)).toBe(false);
  });
});

describe('sectionIndexForKey', () => {
  it('maps digit keys to section indexes (0 = section 10), top row and numpad', () => {
    expect(sectionIndexForKey({ code: 'Digit1', key: '1' }, 5)).toBe(0);
    expect(sectionIndexForKey({ code: 'Numpad3', key: '3' }, 5)).toBe(2);
    expect(sectionIndexForKey({ code: '', key: '5' }, 5)).toBe(4);
    expect(sectionIndexForKey({ code: 'Digit6', key: '6' }, 5)).toBeNull();
    expect(sectionIndexForKey({ code: 'Digit0', key: '0' }, 10)).toBe(9);
    expect(sectionIndexForKey({ code: 'Digit0', key: '0' }, 9)).toBeNull();
    expect(sectionIndexForKey({ code: 'KeyA', key: 'a' }, 5)).toBeNull();
  });
});
