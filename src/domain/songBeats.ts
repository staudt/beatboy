import type { Section, Song } from './song';
import type { Pattern } from './types';
import { parseBeatText, type NotationError, type ParseResult } from './notation';
import { createPattern, duplicatePattern, setSteps } from './patternOps';
import { patternSteps } from './time';

/**
 * Song-local beats: patterns owned by one song (`ownerSongId`), created by typing beat text into a section.
 * Pure helpers; the stores (ui/state/songs.ts) do the persistence.
 */

export const isSongLocal = (p: Pattern | null | undefined): boolean => !!p && !p.builtIn && !!p.ownerSongId;

/** Default name of a section's own beat. */
export const localBeatName = (song: Pick<Song, 'name'>, section: Pick<Section, 'name'>): string => `${song.name} · ${section.name}`;

/** Sections of the song that use the pattern as their groove. */
export const sectionsUsing = (song: Song, patternId: string): number => song.sections.filter((s) => s.patternId === patternId).length;

/** The pattern whose feel the text is read against (a placeholder straight pattern when the groove is missing). */
const baseOrBlank = (base: Pattern | null | undefined): Pattern => base ?? createPattern({ name: 'Beat' });

const NO_STEPS: NotationError = { line: 1, col: 1, message: 'Type at least one step' };

/** Parses section text against the section's pattern (its feel decides the square: 16th or triplet). Empty text is an error. */
export function parseSectionText(base: Pattern | null | undefined, text: string): ParseResult {
  const r = parseBeatText(text, { stepsPerBeat: baseOrBlank(base).stepsPerBeat });
  return r.ok && r.steps === 0 ? { ok: false, errors: [NO_STEPS] } : r;
}

export type LocalBeatResult =
  | {
      ok: true;
      pattern: Pattern;
      /** same: nothing changed; inplace: the section's own local beat was updated; new: a fresh local copy (the section must point at it). */
      mode: 'same' | 'inplace' | 'new';
      warnings: string[];
    }
  | { ok: false; errors: NotationError[] };

/**
 * Applies typed text for `section`:
 * - a library groove (or another song's beat) is never touched: a new local copy (feel/mix copied) holds the text;
 * - a local beat only this section uses is updated in place;
 * - a local beat shared by 2+ sections is forked for this section.
 */
export function localPatternFor(
  song: Song,
  section: Section,
  text: string,
  base?: Pattern | null,
  now: number = Date.now(),
): LocalBeatResult {
  const b = baseOrBlank(base);
  const parsed = parseSectionText(b, text);
  if (!parsed.ok) return parsed;
  const res = {
    pattern: { ...setSteps(b, parsed.steps, now), notes: parsed.notes, updatedAt: now },
    warnings: parsed.warnings,
  };
  const same = JSON.stringify(res.pattern.notes) === JSON.stringify(b.notes) && patternSteps(res.pattern) === patternSteps(b);
  if (same && base) return { ok: true, pattern: base, mode: 'same', warnings: res.warnings };
  const own = !!base && isSongLocal(base) && base.ownerSongId === song.id && sectionsUsing(song, base.id) <= 1;
  if (own) return { ok: true, pattern: res.pattern, mode: 'inplace', warnings: res.warnings };
  const copy = duplicatePattern(res.pattern, now, localBeatName(song, section));
  return {
    ok: true,
    pattern: { ...copy, kind: 'groove', category: 'My beats', ownerSongId: song.id },
    mode: 'new',
    warnings: res.warnings,
  };
}

/** An independent copy of a song-local beat for another section (or song). */
export function forkLocal(p: Pattern, songId: string, name: string, now: number = Date.now()): Pattern {
  return { ...duplicatePattern(p, now, name), ownerSongId: songId };
}

/** "Save as groove": the beat joins the library (no owner), under `name`, in My beats. */
export function promoteToGroove(p: Pattern, name: string, now: number = Date.now()): Pattern {
  const { ownerSongId: _owner, ...rest } = p;
  return { ...rest, name: name.trim() || p.name, category: 'My beats', updatedAt: now };
}

/** Ids of owned patterns that no section of their song uses (or whose song is gone). */
export function garbageLocalPatterns(patterns: readonly Pattern[], songs: readonly Song[]): string[] {
  const byId = new Map(songs.map((s) => [s.id, s] as const));
  const out: string[] = [];
  for (const p of patterns) {
    if (!isSongLocal(p)) continue;
    const song = byId.get(p.ownerSongId!);
    const used = !!song && (song.fillId === p.id || song.sections.some((s) => s.patternId === p.id || s.fill.patternId === p.id));
    if (!used) out.push(p.id);
  }
  return out;
}
