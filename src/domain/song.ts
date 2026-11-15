/**
 * Song model (contract shared by the engine's SongSource, storage and the Drummer UI).
 *
 * A song is an ordered list of sections. Each section plays one groove pattern for a number of bars;
 * one "bar" is one pass of the section's groove,
 * so `bars` means "how many times the groove plays" and the time signature comes from the grooves. The groove
 * restarts at every section start.
 */

export const SECTION_KINDS = ['intro', 'verse', 'chorus', 'bridge', 'solo', 'outro', 'custom'] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

export interface SectionFill {
  /** Play a fill in the section's last bar when moving on to another section. */
  enabled: boolean;
  /** Fill pattern id; null = the song's default fill. */
  patternId: string | null;
}

export interface Section {
  id: string;
  kind: SectionKind;
  /** Display name, e.g. "Verse 2". */
  name: string;
  /** Groove pattern id (factory or user). */
  patternId: string;
  /** Length in bars, 1..64. */
  bars: number;
  fill: SectionFill;
  /** Repeat this section until NEXT (or LOOP off) instead of moving on. */
  loop: boolean;
}

export interface Song {
  id: string;
  name: string;
  /** Tempo in quarter-note BPM (shared transport tempo while the song is loaded). */
  bpm: number;
  /** @deprecated Ignored by the engine (bar length = the section's groove length); kept for stored-song compatibility. */
  beatsPerBar: number;
  /** Default fill pattern id for sections whose fill.patternId is null. */
  fillId: string | null;
  sections: Section[];
  createdAt: number;
  updatedAt: number;
}

export const SONG_LIMITS = {
  minBars: 1,
  maxBars: 64,
  maxSections: 32,
  minBeatsPerBar: 1,
  maxBeatsPerBar: 7,
} as const;

export const SECTION_LABELS: Record<SectionKind, string> = {
  intro: 'Intro',
  verse: 'Verse',
  chorus: 'Chorus',
  bridge: 'Bridge',
  solo: 'Solo',
  outro: 'Outro',
  custom: 'Section',
};

/** Live performance actions (queued by the UI/controllers, applied by the SongSource at bar lines). */
export type SongAction =
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'jump'; sectionIndex: number }
  | { type: 'break' }
  | { type: 'toggleLoop' }
  | { type: 'fill' };
