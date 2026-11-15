/** Pure helpers for the Drummer's Song mode (unit-tested; see songs.ts for the wiring). */
import { SECTION_LABELS, SONG_LIMITS, type Section, type SectionKind, type Song } from '../../domain/song';
import { createSection } from '../../domain/songOps';
import type { Pattern } from '../../domain/types';
import type { SongConfig } from '../../engine/songSource';

/** Engine config for a song from the shared library and the Drummer's shared click / count-in settings. */
export function buildSongConfig(
  song: Song,
  library: readonly Pattern[],
  s: { click: { enabled: boolean; volume: number }; countInBars: 0 | 1 | 2; crashAfterFill: boolean },
): SongConfig {
  const byId = new Map(library.map((p) => [p.id, p] as const));
  return {
    song,
    getPattern: (id) => byId.get(id) ?? null,
    click: { enabled: s.click.enabled, volume: s.click.volume },
    countInBars: s.countInBars,
    crashAfterFill: s.crashAfterFill,
  };
}

/** "Song N" with N one past the highest existing "Song N". */
export function nextSongName(songs: readonly Song[]): string {
  let max = 0;
  for (const s of songs) {
    const m = /^Song (\d+)$/.exec(s.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `Song ${max + 1}`;
}

/** The shared tempo is the song's tempo: the BPM to write to the song, or null when nothing changes. */
export function songBpmToWrite(song: Song | null, bpm: number): number | null {
  return !song || song.bpm === bpm ? null : bpm;
}

const DEFAULT_BARS: Record<SectionKind, number> = { intro: 4, verse: 8, chorus: 8, bridge: 4, solo: 8, outro: 4, custom: 8 };

/** "Verse", then "Verse 2", "Verse 3"... */
export function sectionName(song: Song, kind: SectionKind): string {
  const same = song.sections.filter((s) => s.kind === kind).length;
  return same === 0 ? SECTION_LABELS[kind] : `${SECTION_LABELS[kind]} ${same + 1}`;
}

/** A new section for a chip: groove = the previous section's (or the fallback). */
export function newSectionFor(song: Song, kind: SectionKind, at: number, fallbackGroove: string): Section {
  const prev = song.sections[at - 1] ?? song.sections[at] ?? null;
  const s = createSection(kind, prev?.patternId ?? fallbackGroove, DEFAULT_BARS[kind]);
  return { ...s, name: sectionName(song, kind) };
}

/** Number keys pick sections: 1-9 -> index 0-8, 0 -> index 9 (top row or numpad). Null when not a digit key or out of range. */
export function sectionIndexForKey(e: { code: string; key: string }, count: number): number | null {
  const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code) ?? (/^\d$/.test(e.key) ? [e.key, e.key] : null);
  if (!m) return null;
  const i = (Number(m[1]) + 9) % 10;
  return i < count ? i : null;
}

export const clampStartIndex = (song: Song | null, id: string | null): number => {
  if (!song || id === null) return 0;
  const i = song.sections.findIndex((s) => s.id === id);
  return i < 0 ? 0 : Math.min(i, SONG_LIMITS.maxSections - 1);
};

/** "Used in: A, B" for the delete protection of patterns. */
export function usedInMessage(names: readonly string[]): string {
  return `Used in: ${names.join(', ')}.`;
}

/** The fields of a SongInfo the UI cares about (for change detection). */
export interface InfoLike {
  sectionIndex: number;
  barInSection: number;
  sectionBars: number;
  beat: number;
  countIn: number | null;
  loop: boolean;
  phase: string;
  breakQueued: boolean;
  fillQueued: boolean;
  nextSectionIndex: number | null;
  queued: { kind: string; sectionIndex: number | null } | null;
}
export function sameInfo(a: InfoLike | null, b: InfoLike | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.sectionIndex === b.sectionIndex &&
    a.barInSection === b.barInSection &&
    a.sectionBars === b.sectionBars &&
    (a as { beatsPerBar?: number }).beatsPerBar === (b as { beatsPerBar?: number }).beatsPerBar &&
    a.beat === b.beat &&
    a.countIn === b.countIn &&
    a.loop === b.loop &&
    a.phase === b.phase &&
    a.breakQueued === b.breakQueued &&
    a.fillQueued === b.fillQueued &&
    a.nextSectionIndex === b.nextSectionIndex &&
    a.queued?.kind === b.queued?.kind &&
    a.queued?.sectionIndex === b.queued?.sectionIndex
  );
}

// ── row gestures ─────────────────────────────────────────────────
export const TAP_SLOP = 8; // px a finger or mouse may wander and still be a tap
export const TAP_MAX_MS = 500;
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_SLOP = 30;
export const LONG_PRESS_MS = 500;
export interface TapPoint {
  x: number;
  y: number;
  t: number;
}
/** A real tap: released within the slop of where it went down, and quickly (otherwise it was a drag, scroll or hold). */
export function isTap(down: TapPoint, up: TapPoint): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) <= TAP_SLOP && up.t - down.t < TAP_MAX_MS;
}
/** Two taps close in time and place. */
export function isDoubleTap(prev: TapPoint | null, cur: TapPoint): boolean {
  return !!prev && cur.t - prev.t <= DOUBLE_TAP_MS && cur.t >= prev.t && Math.hypot(cur.x - prev.x, cur.y - prev.y) <= DOUBLE_TAP_SLOP;
}

/** Pattern of the focus section (last played / touched), else the start section, else section 1. Null for an empty song. */
export function focusPatternId(song: Song | null, focusId: string | null, selectedId: string | null): string | null {
  if (!song) return null;
  const sec = song.sections.find((s) => s.id === focusId) ?? song.sections.find((s) => s.id === selectedId) ?? song.sections[0];
  return sec?.patternId ?? null;
}

/** The song's distinct patterns in section order (song beats included) and the names of the sections using each. */
export function songGrooves(song: Song | null, library: readonly Pattern[]): { patterns: Pattern[]; sections: Map<string, string[]> } {
  const patterns: Pattern[] = [];
  const sections = new Map<string, string[]>();
  for (const sec of song?.sections ?? []) {
    const names = sections.get(sec.patternId);
    if (names) {
      names.push(sec.name);
      continue;
    }
    const p = library.find((x) => x.id === sec.patternId);
    if (!p) continue;
    patterns.push(p);
    sections.set(p.id, [sec.name]);
  }
  return { patterns, sections };
}
