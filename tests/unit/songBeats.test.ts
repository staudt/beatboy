import { describe, expect, it } from 'vitest';
import { factoryPatterns } from '../../src/domain/factory';
import { formatBeatText, parseBeatText } from '../../src/domain/notation';
import { createPattern, duplicatePattern } from '../../src/domain/patternOps';
import { forkLocal, garbageLocalPatterns, isSongLocal, localPatternFor, promoteToGroove } from '../../src/domain/songBeats';
import { addSection, createSection, createSong } from '../../src/domain/songOps';
import { patternSteps, patternTicks } from '../../src/domain/time';
import { validatePattern } from '../../src/storage/migrations';

const rock = factoryPatterns().find((p) => p.id === 'f-rock-8ths')!;
const mkSong = (...patternIds: string[]) => {
  let s = createSong({ id: 'S1', name: 'Tune' }, 1);
  patternIds.forEach((id, i) => {
    s = addSection(s, { ...createSection('verse', id), name: `Verse ${i + 1}` });
  });
  return s;
};

describe('localPatternFor', () => {
  it('typing over a library groove makes a local copy and leaves the groove alone', () => {
    const song = mkSong(rock.id);
    const r = localPatternFor(song, song.sections[0]!, 'kh . sh .', rock, 5);
    expect(r.ok && r.mode).toBe('new');
    if (!r.ok) return;
    expect(r.pattern.id).not.toBe(rock.id);
    expect(r.pattern.ownerSongId).toBe('S1');
    expect(r.pattern.name).toBe('Tune · Verse 1');
    expect(r.pattern.builtIn).toBe(false);
    expect(r.pattern.category).toBe('My beats');
    expect(r.pattern.stepsPerBeat).toBe(rock.stepsPerBeat);
    expect(r.pattern.timeSig.num).toBe(1); // 4 steps = one beat
    expect(patternSteps(r.pattern)).toBe(4);
    expect(Object.keys(r.pattern.notes).sort()).toEqual(['hatClosed', 'kick', 'snare']);
    expect(rock.ownerSongId).toBeUndefined();
  });

  it('copies feel and mix from the groove', () => {
    const shuffle = createPattern({ stepsPerBeat: 3, swing: 0.5, mix: { kick: { gain: 0.5, muted: false } }, timeSig: { num: 4, den: 4 } });
    const song = mkSong(shuffle.id);
    const r = localPatternFor(song, song.sections[0]!, 'k . s .', shuffle);
    expect(r.ok && r.pattern.stepsPerBeat).toBe(3);
    expect(r.ok && r.pattern.mix.kick?.gain).toBe(0.5);
  });

  it('updates a local beat in place when only this section uses it', () => {
    const song0 = mkSong(rock.id);
    const first = localPatternFor(song0, song0.sections[0]!, 'kh . sh .', rock);
    if (!first.ok) throw new Error('x');
    const song = mkSong(first.pattern.id);
    const r = localPatternFor(song, song.sections[0]!, 'k . s .', first.pattern);
    expect(r.ok && r.mode).toBe('inplace');
    expect(r.ok && r.pattern.id).toBe(first.pattern.id);
  });

  it('forks a local beat used by 2+ sections', () => {
    const own = { ...duplicatePattern(rock), ownerSongId: 'S1' };
    const song = mkSong(own.id, own.id);
    const r = localPatternFor(song, song.sections[1]!, 'k . s .', own);
    expect(r.ok && r.mode).toBe('new');
    expect(r.ok && r.pattern.id).not.toBe(own.id);
    expect(r.ok && r.pattern.ownerSongId).toBe('S1');
  });

  it("forks another song's local beat", () => {
    const other = { ...duplicatePattern(rock), ownerSongId: 'S2' };
    const song = mkSong(other.id);
    const r = localPatternFor(song, song.sections[0]!, 'k . s .', other);
    expect(r.ok && r.mode).toBe('new');
  });

  it('unchanged text is a no-op; bad text returns errors', () => {
    const song = mkSong(rock.id);
    const same = localPatternFor(song, song.sections[0]!, formatBeatText(rock, { lineBreaks: false }).text, rock);
    expect(same.ok && same.mode).toBe('same');
    const bad = localPatternFor(song, song.sections[0]!, 'kh . q .', rock);
    expect(bad.ok).toBe(false);
  });

  it('every typed step is one square: the loop is exactly as long as the text', () => {
    const song = mkSong(rock.id);
    const three = localPatternFor(song, song.sections[0]!, 's k s', rock);
    if (!three.ok) throw new Error('x');
    expect(patternSteps(three.pattern)).toBe(3);
    expect(patternTicks(three.pattern)).toBe(360);
    expect(three.pattern).toMatchObject({ steps: 3, timeSig: { num: 1, den: 4 } });
    expect(three.warnings).toEqual([]);
    const song2 = mkSong(three.pattern.id);
    const own = { ...three.pattern, ownerSongId: 'S1' };
    const seven = localPatternFor(song2, song2.sections[0]!, 'kh h hs h  k . s', own);
    expect(seven.ok && seven.mode).toBe('inplace');
    expect(seven.ok && patternSteps(seven.pattern)).toBe(7);
    const sixteen = localPatternFor(song, song.sections[0]!, 'kh . sh . kh . sh . kh . sh . kh . sh .', rock);
    expect(sixteen.ok && patternSteps(sixteen.pattern)).toBe(16);
    expect(sixteen.ok && sixteen.pattern.timeSig.num).toBe(4);
    expect(sixteen.ok && sixteen.pattern.steps).toBeUndefined();
  });

  it('empty text is an error for a section', () => {
    const song = mkSong(rock.id);
    const r = localPatternFor(song, song.sections[0]!, '  ', rock);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.message).toBe('Type at least one step');
  });

  it('triplet grooves read each step as a triplet square', () => {
    const slow = factoryPatterns().find((p) => p.id === 'f-slow-blues')!;
    const song = mkSong(slow.id);
    const r = localPatternFor(song, song.sections[0]!, 'k . s', slow);
    if (!r.ok) throw new Error('x');
    expect(patternSteps(r.pattern)).toBe(3);
    expect(patternTicks(r.pattern)).toBe(480);
    expect(r.pattern.notes.snare!.map((n) => n.tick)).toEqual([320]);
  });
});

describe('garbageLocalPatterns', () => {
  it('lists owned patterns no section references, or whose song is gone', () => {
    const used = { ...duplicatePattern(rock), id: 'u', ownerSongId: 'S1' };
    const unused = { ...duplicatePattern(rock), id: 'n', ownerSongId: 'S1' };
    const orphan = { ...duplicatePattern(rock), id: 'o', ownerSongId: 'GONE' };
    const lib = { ...duplicatePattern(rock), id: 'lib' };
    const song = mkSong('u', rock.id);
    expect(garbageLocalPatterns([...factoryPatterns(), used, unused, orphan, lib], [song]).sort()).toEqual(['n', 'o']);
  });
});

describe('promote / fork / format', () => {
  it('promoteToGroove clears the owner; duplicatePattern drops it; forkLocal keeps an owner', () => {
    const own = { ...duplicatePattern(rock), ownerSongId: 'S1' };
    expect(isSongLocal(own)).toBe(true);
    const g = promoteToGroove(own, '  My groove ', 9);
    expect(isSongLocal(g)).toBe(false);
    expect(g.name).toBe('My groove');
    expect(g.id).toBe(own.id);
    expect(duplicatePattern(own).ownerSongId).toBeUndefined();
    expect(forkLocal(own, 'S3', 'x').ownerSongId).toBe('S3');
    expect(forkLocal(own, 'S3', 'x').id).not.toBe(own.id);
  });

  it('single-line format round-trips', () => {
    for (const p of factoryPatterns()) {
      const { text } = formatBeatText(p, { lineBreaks: false });
      expect(text).not.toContain('\n');
      expect(text).not.toContain('|');
      const r = parseBeatText(text, { stepsPerBeat: p.stepsPerBeat });
      const ref = parseBeatText(formatBeatText(p).text, { stepsPerBeat: p.stepsPerBeat });
      expect(r.ok && ref.ok && r.notes).toEqual(ref.ok ? ref.notes : null);
      expect(r.ok && r.steps).toBe(patternSteps(p));
    }
  });
});

describe('storage keeps the owner', () => {
  it('validatePattern preserves ownerSongId and ignores junk', () => {
    const own = { ...duplicatePattern(rock), ownerSongId: 'S1' };
    expect(validatePattern(own)?.ownerSongId).toBe('S1');
    expect(validatePattern({ ...own, ownerSongId: 5 })?.ownerSongId).toBeUndefined();
    expect(validatePattern(duplicatePattern(rock))).not.toHaveProperty('ownerSongId');
  });
});
