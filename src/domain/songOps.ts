import {
  SECTION_KINDS,
  SECTION_LABELS,
  SONG_LIMITS,
  type Section,
  type SectionKind,
  type Song,
} from './song';

/** Pure, immutable song operations. Every change bumps `updatedAt` and clamps to SONG_LIMITS. */

const clampInt = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n) ? n : lo)));
const touch = (s: Song, changes: Partial<Song>, now: number): Song => ({ ...s, ...changes, updatedAt: now });

export function createSong(init: Partial<Song> = {}, now: number = Date.now()): Song {
  return {
    id: crypto.randomUUID(),
    name: 'New song',
    bpm: 100,
    beatsPerBar: 4,
    fillId: null,
    sections: [],
    createdAt: now,
    updatedAt: now,
    ...init,
  };
}

export function createSection(kind: SectionKind, patternId: string, bars = 4): Section {
  return {
    id: crypto.randomUUID(),
    kind,
    name: SECTION_LABELS[kind],
    patternId,
    bars: clampInt(bars, SONG_LIMITS.minBars, SONG_LIMITS.maxBars),
    fill: { enabled: false, patternId: null },
    loop: false,
  };
}

/** Insert `section` at `index` (default: end). No-op at the section limit. */
export function addSection(song: Song, section: Section, index?: number, now: number = Date.now()): Song {
  if (song.sections.length >= SONG_LIMITS.maxSections) return song;
  const at = clampInt(index ?? song.sections.length, 0, song.sections.length);
  const sections = [...song.sections];
  sections.splice(at, 0, section);
  return touch(song, { sections }, now);
}

/** Copy of a section (new id) inserted right after the original. */
export function duplicateSection(song: Song, id: string, now: number = Date.now()): Song {
  const i = song.sections.findIndex((s) => s.id === id);
  if (i < 0 || song.sections.length >= SONG_LIMITS.maxSections) return song;
  const src = song.sections[i]!;
  return addSection(song, { ...src, id: crypto.randomUUID(), fill: { ...src.fill } }, i + 1, now);
}

export function removeSection(song: Song, id: string, now: number = Date.now()): Song {
  if (!song.sections.some((s) => s.id === id)) return song;
  return touch(song, { sections: song.sections.filter((s) => s.id !== id) }, now);
}

export function moveSection(song: Song, from: number, to: number, now: number = Date.now()): Song {
  const n = song.sections.length;
  if (from < 0 || from >= n) return song;
  const dest = clampInt(to, 0, n - 1);
  if (dest === from) return song;
  const sections = [...song.sections];
  const [s] = sections.splice(from, 1);
  sections.splice(dest, 0, s!);
  return touch(song, { sections }, now);
}

export type SectionPatch = Partial<Omit<Section, 'id' | 'fill'>> & { fill?: Partial<Section['fill']> };

export function updateSection(song: Song, id: string, patch: SectionPatch, now: number = Date.now()): Song {
  const i = song.sections.findIndex((s) => s.id === id);
  if (i < 0) return song;
  const cur = song.sections[i]!;
  const next: Section = { ...cur, ...patch, id: cur.id, fill: { ...cur.fill, ...patch.fill } };
  next.bars = clampInt(next.bars, SONG_LIMITS.minBars, SONG_LIMITS.maxBars);
  if (!(SECTION_KINDS as readonly string[]).includes(next.kind)) next.kind = 'custom';
  next.name = next.name.trim() || SECTION_LABELS[next.kind];
  const sections = [...song.sections];
  sections[i] = next;
  return touch(song, { sections }, now);
}

export function renameSong(song: Song, name: string, now: number = Date.now()): Song {
  return touch(song, { name: name.trim() || 'Untitled song' }, now);
}

export function setSongBpm(song: Song, bpm: number, now: number = Date.now()): Song {
  return touch(song, { bpm: clampInt(bpm, 30, 300) }, now);
}

export function setBeatsPerBar(song: Song, n: number, now: number = Date.now()): Song {
  return touch(song, { beatsPerBar: clampInt(n, SONG_LIMITS.minBeatsPerBar, SONG_LIMITS.maxBeatsPerBar) }, now);
}

export function setSongFill(song: Song, fillId: string | null, now: number = Date.now()): Song {
  return touch(song, { fillId }, now);
}

/** Songs that reference `patternId` as a section groove, a section fill or the default fill (delete protection). */
export function songsUsingPattern(songs: readonly Song[], patternId: string): Song[] {
  return songs.filter(
    (s) => s.fillId === patternId || s.sections.some((x) => x.patternId === patternId || x.fill.patternId === patternId),
  );
}

/** A ready-made arrangement from factory patterns. */
export function demoSong(now: number = Date.now()): Song {
  const sec = (kind: SectionKind, name: string, patternId: string, bars: number, fill = false): Section => ({
    ...createSection(kind, patternId, bars),
    name,
    fill: { enabled: fill, patternId: null },
  });
  return createSong(
    {
      name: 'Demo song',
      bpm: 112,
      beatsPerBar: 4,
      fillId: 'f-fill-toms',
      sections: [
        sec('intro', 'Intro', 'f-ride-rock', 4),
        sec('verse', 'Verse 1', 'f-rock-8ths', 8),
        sec('chorus', 'Chorus 1', 'f-rock-16ths', 8, true),
        sec('verse', 'Verse 2', 'f-rock-8ths', 8),
        sec('chorus', 'Chorus 2', 'f-rock-16ths', 8, true),
        sec('bridge', 'Bridge', 'f-half-time', 4, true),
        sec('chorus', 'Chorus 3', 'f-rock-16ths', 8),
        sec('outro', 'Outro', 'f-rock-8ths', 4),
      ],
    },
    now,
  );
}
