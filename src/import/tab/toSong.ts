import type { SectionKind, Song } from '../../domain/song';
import { SONG_LIMITS } from '../../domain/song';
import { applyBeatText } from '../../domain/notation';
import { createPattern } from '../../domain/patternOps';
import { createSection, createSong } from '../../domain/songOps';
import type { Pattern } from '../../domain/types';
import type { TabImport } from './types';

/** Section kind from its name ("Pre-Chorus" is a verse-like build, anything unknown is custom). */
export function kindFromName(name: string): SectionKind {
  const n = name.toLowerCase();
  if (/pre[\s-]?chorus/.test(n)) return 'verse';
  if (/intro/.test(n)) return 'intro';
  if (/verse/.test(n)) return 'verse';
  if (/chorus|refrain|hook/.test(n)) return 'chorus';
  if (/bridge|middle\s*8/.test(n)) return 'bridge';
  if (/solo/.test(n)) return 'solo';
  if (/outro|ending|coda/.test(n)) return 'outro';
  return 'custom';
}

export interface TabSong {
  song: Song;
  /** Song-local beats, one per distinct section beat (identical beats are shared by their sections). */
  patterns: Pattern[];
}

/** A parsed tab -> a new song whose sections each play a song-local beat (fills off, bars = times). */
export function songFromTab(
  tab: Pick<TabImport, 'sections'>,
  opts: { name: string; bpm: number; fillId?: string | null; now?: number },
): TabSong {
  const now = opts.now ?? Date.now();
  const song = createSong({ name: opts.name.trim() || 'Imported tab', bpm: opts.bpm, fillId: opts.fillId ?? null }, now);
  const byBeat = new Map<string, Pattern>();
  const patterns: Pattern[] = [];
  for (const sec of tab.sections.slice(0, SONG_LIMITS.maxSections)) {
    const key = `${sec.feel}|${sec.beat.split(/\s+/).filter(Boolean).join(' ')}`;
    let p = byBeat.get(key);
    if (!p) {
      const base = createPattern(
        {
          name: `${song.name} · ${sec.name}`,
          kind: 'groove',
          category: 'My beats',
          stepsPerBeat: sec.feel === 'triplet' ? 3 : 4,
          bpm: song.bpm,
          ownerSongId: song.id,
        },
        now,
      );
      const r = applyBeatText(base, sec.beat, now);
      if (!r.ok) continue;
      p = r.pattern;
      byBeat.set(key, p);
      patterns.push(p);
    }
    const kind = kindFromName(sec.name);
    song.sections.push({ ...createSection(kind, p.id, sec.times), name: sec.name });
  }
  return { song, patterns };
}
