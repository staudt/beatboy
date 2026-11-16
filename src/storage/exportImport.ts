/**
 * Backup / sharing file: versioned JSON holding user patterns (incl. song-local beats), songs and (library
 * exports) the Drummer settings. Pure functions: parsing, planning an import against the local library, naming.
 * The UI (ui/state/backup.ts) does the file I/O and persistence.
 */
import type { Song } from '../domain/song';
import { factoryPatterns } from '../domain/factory';
import type { Pattern } from '../domain/types';
import { PATTERN_SCHEMA_VERSION, SONG_SCHEMA_VERSION, type StoredPattern, type StoredSong } from './db';
import { migratePattern, migrateSong } from './migrations';

export const FILE_FORMAT = 'beatboy';
export const FILE_VERSION = 1;
export const FILE_SUFFIX = '.beatboy.json';
export const IMPORTED_SUFFIX = ' (imported)';

export interface BeatboyFile {
  format: 'beatboy';
  version: 1;
  kind: 'library' | 'song';
  exportedAt: string;
  app?: string;
  patterns: StoredPattern[];
  songs: StoredSong[];
  settings?: { drummer?: unknown };
}

const FACTORY_IDS: ReadonlySet<string> = new Set(factoryPatterns().map((p) => p.id));
/** Built-in patterns are referenced by their stable ids and never exported or imported. */
export const isBuiltInId = (id: string): boolean => FACTORY_IDS.has(id);

const storedPattern = (p: Pattern): StoredPattern => ({ ...p, schemaVersion: PATTERN_SCHEMA_VERSION });
const storedSong = (s: Song): StoredSong => ({ ...s, schemaVersion: SONG_SCHEMA_VERSION });

export interface ExportOptions {
  now?: Date;
  app?: string;
}

/** Everything the user owns: all user patterns (incl. song-local beats), all songs, the Drummer settings. */
export function exportLibrary(
  state: { patterns: readonly Pattern[]; songs: readonly Song[]; drummer?: unknown },
  opts: ExportOptions = {},
): BeatboyFile {
  return {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    kind: 'library',
    exportedAt: (opts.now ?? new Date()).toISOString(),
    app: opts.app ?? 'beatboy web',
    patterns: state.patterns.filter((p) => !p.builtIn).map(storedPattern),
    songs: state.songs.map(storedSong),
    settings: { drummer: state.drummer },
  };
}

/** Ids a song refers to (section grooves, section fills, default fill). */
export function songPatternIds(song: Song): string[] {
  const ids = new Set<string>();
  if (song.fillId) ids.add(song.fillId);
  for (const s of song.sections) {
    ids.add(s.patternId);
    if (s.fill.patternId) ids.add(s.fill.patternId);
  }
  return [...ids];
}

/** One song plus every non-built-in pattern it references (user grooves/fills and its own song-local beats). */
export function exportSong(song: Song, patterns: readonly Pattern[], opts: ExportOptions = {}): BeatboyFile {
  const byId = new Map(patterns.map((p) => [p.id, p] as const));
  const out: StoredPattern[] = [];
  for (const id of songPatternIds(song)) {
    const p = byId.get(id);
    if (!p || p.builtIn) continue;
    // A beat owned by another song would be an orphan in this file: it travels as a normal groove.
    const { ownerSongId: _o, ...rest } = p;
    out.push(storedPattern(p.ownerSongId && p.ownerSongId !== song.id ? rest : p));
  }
  return {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    kind: 'song',
    exportedAt: (opts.now ?? new Date()).toISOString(),
    app: opts.app ?? 'beatboy web',
    patterns: out,
    songs: [storedSong(song)],
  };
}

export const serialize = (f: BeatboyFile): string => JSON.stringify(f, null, 2);

/** A safe file name: no path or reserved characters, bounded length. */
export function exportFileName(name: string, fallback = 'song'): string {
  const base =
    name
      // eslint-disable-next-line no-control-regex
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '')
      .slice(0, 80)
      .trim() || fallback;
  return `${base}${FILE_SUFFIX}`;
}

export const libraryFileName = (now: Date = new Date()): string => `beatboy-backup-${now.toISOString().slice(0, 10)}${FILE_SUFFIX}`;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "never" / "just now" / "5 minutes ago" / "3 days ago". */
export function agoLabel(ts: number | null | undefined, now: number = Date.now()): string {
  if (ts === null || ts === undefined || !Number.isFinite(ts)) return 'never';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${plural(m, 'minute')} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${plural(h, 'hour')} ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

// ───────────────────────── parsing ─────────────────────────

export type ParseResult =
  | { ok: true; file: BeatboyFile; songs: Song[]; patterns: Pattern[]; warnings: string[] }
  | { ok: false; error: string };

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const skipped = (n: number, what: 'pattern' | 'song'): string =>
  `${plural(n, what)} could not be read and ${n === 1 ? 'was' : 'were'} skipped`;

export function parseImport(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "This isn't a Beatboy file: it could not be read as JSON." };
  }
  if (!isRec(raw) || raw.format !== FILE_FORMAT) return { ok: false, error: "This isn't a Beatboy file." };
  const v = raw.version;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return { ok: false, error: 'This Beatboy file has no valid version.' };
  if (v > FILE_VERSION) {
    return { ok: false, error: `This file was made by a newer version of Beatboy (file format ${v}). Update the app and try again.` };
  }
  const rawPatterns: unknown[] = Array.isArray(raw.patterns) ? raw.patterns : [];
  const rawSongs: unknown[] = Array.isArray(raw.songs) ? raw.songs : [];
  if (rawPatterns.length === 0 && rawSongs.length === 0) return { ok: false, error: 'This file has no songs or beats in it.' };

  const warnings: string[] = [];
  // Later records win over earlier ones with the same id.
  const patterns = new Map<string, Pattern>();
  let badPatterns = 0;
  for (const r of rawPatterns) {
    const p = migratePattern(r);
    if (!p) badPatterns++;
    else if (!p.builtIn && !isBuiltInId(p.id)) patterns.set(p.id, p);
  }
  const songs = new Map<string, Song>();
  let badSongs = 0;
  for (const r of rawSongs) {
    const s = migrateSong(r);
    if (!s) badSongs++;
    else songs.set(s.id, s);
  }
  if (badSongs) warnings.push(skipped(badSongs, 'song'));
  if (badPatterns) warnings.push(skipped(badPatterns, 'pattern'));

  const file: BeatboyFile = {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    kind: raw.kind === 'song' ? 'song' : 'library',
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
    ...(typeof raw.app === 'string' ? { app: raw.app } : {}),
    patterns: [],
    songs: [],
    ...(isRec(raw.settings) ? { settings: raw.settings } : {}),
  };
  return { ok: true, file, songs: [...songs.values()], patterns: [...patterns.values()], warnings };
}

// ───────────────────────── planning ─────────────────────────

export type ImportStrategy = 'keepBoth' | 'replace';

export interface ImportSummary {
  songsAdded: number;
  songsReplaced: number;
  patternsAdded: number;
  patternsReplaced: number;
  /** Records already present with identical content. */
  skipped: number;
}

export interface ImportPlan {
  /** Records to write (put), already remapped. */
  patterns: Pattern[];
  songs: Song[];
  summary: ImportSummary;
  /** Records whose id exists locally with different content (what the strategy decides about). */
  conflicts: number;
  /** The local id of the first incoming song (new, copied or already present): the one to select afterwards. */
  firstSongId: string | null;
  /**
   * Local songs to delete: never-edited starter songs (createdAt === updatedAt) whose name an incoming song
   * takes, so restoring a backup on a fresh device doesn't leave "Practice (imported)" twins.
   */
  songDeletes: string[];
  warnings: string[];
}

export interface LocalData {
  patterns: readonly Pattern[];
  songs: readonly Song[];
}

/** JSON with sorted keys: equal content compares equal whatever the key order. */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (isRec(v)) {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}
const same = (a: unknown, b: unknown): boolean => canon(a) === canon(b);

const newId = (): string => crypto.randomUUID();

function remapSong(s: Song, ids: ReadonlyMap<string, string>): Song {
  const m = (id: string) => ids.get(id) ?? id;
  return {
    ...s,
    fillId: s.fillId === null ? null : m(s.fillId),
    sections: s.sections.map((x) => ({
      ...x,
      patternId: m(x.patternId),
      fill: { ...x.fill, patternId: x.fill.patternId === null ? null : m(x.fill.patternId) },
    })),
  };
}

/**
 * What importing `incoming` into `local` would do. Same id + same content = skipped. Same id + different content:
 * keepBoth gives the incoming record a new id (all references follow; a song's own beats get new ids and the new
 * owner; a song whose name is taken becomes "<name> (imported)"); replace overwrites the local record.
 * Built-in patterns are ignored.
 */
export function planImport(
  local: LocalData,
  incoming: { patterns: readonly Pattern[]; songs: readonly Song[] },
  strategy: ImportStrategy,
): ImportPlan {
  const warnings: string[] = [];
  const summary: ImportSummary = { songsAdded: 0, songsReplaced: 0, patternsAdded: 0, patternsReplaced: 0, skipped: 0 };
  let conflicts = 0;
  const keepBoth = strategy === 'keepBoth';

  const localPat = new Map(local.patterns.filter((p) => !p.builtIn).map((p) => [p.id, p] as const));
  const localSong = new Map(local.songs.map((s) => [s.id, s] as const));
  const inSongIds = new Set(incoming.songs.map((s) => s.id));
  const localNames = new Set(local.songs.map((s) => s.name));
  // Untouched starter songs give way to incoming songs with the same name (no "(imported)" twin).
  const songDeletes: string[] = [];
  for (const inc of incoming.songs) {
    if (localSong.has(inc.id)) continue;
    const pristine = local.songs.find(
      (l) => l.name === inc.name && l.createdAt === l.updatedAt && !inSongIds.has(l.id) && !songDeletes.includes(l.id),
    );
    if (pristine) {
      songDeletes.push(pristine.id);
      if (!local.songs.some((l) => l.name === inc.name && !songDeletes.includes(l.id))) localNames.delete(inc.name);
    }
  }

  // A beat whose owner is nowhere becomes a normal groove (it would be garbage-collected otherwise).
  const pats = incoming.patterns
    .filter((p) => !p.builtIn && !isBuiltInId(p.id))
    .map((p) => {
      if (p.ownerSongId && !inSongIds.has(p.ownerSongId) && !localSong.has(p.ownerSongId)) {
        const { ownerSongId: _o, ...rest } = p;
        return rest as Pattern;
      }
      return p;
    });
  const ownedBy = (songId: string) => pats.filter((p) => p.ownerSongId === songId);
  const isOwned = (p: Pattern) => !!p.ownerSongId && inSongIds.has(p.ownerSongId);

  // 1. Library patterns (not owned by an incoming song): identical = skip, different = copy or overwrite.
  const idMap = new Map<string, string>();
  const outPatterns: Pattern[] = [];
  for (const p of pats) {
    if (isOwned(p)) continue;
    const l = localPat.get(p.id);
    if (!l) {
      outPatterns.push(p);
      summary.patternsAdded++;
    } else if (same(l, p)) summary.skipped++;
    else {
      conflicts++;
      if (keepBoth) {
        const id = newId();
        idMap.set(p.id, id);
        outPatterns.push({ ...p, id, name: p.name + IMPORTED_SUFFIX });
        summary.patternsAdded++;
      } else {
        outPatterns.push(p);
        summary.patternsReplaced++;
      }
    }
  }

  // 2. Songs, each with the beats it owns.
  const outSongs: Song[] = [];
  let firstSongId: string | null = null;
  const claimedNames = new Set<string>();
  for (const s0 of incoming.songs) {
    const owned = ownedBy(s0.id);
    const l = localSong.get(s0.id);
    const song = remapSong(s0, idMap);
    const unchanged = !!l && same(l, song) && owned.every((p) => same(localPat.get(p.id), p));
    firstSongId ??= s0.id;
    if (unchanged) {
      summary.skipped += 1 + owned.length;
      continue;
    }
    if (!l) {
      // New song. Its beats keep their ids unless that id is taken by something else.
      const m = new Map<string, string>();
      const beats = owned.map((p) => {
        if (!localPat.has(p.id)) return p;
        if (!keepBoth) return p;
        const id = newId();
        m.set(p.id, id);
        return { ...p, id };
      });
      const s = remapSong(song, m);
      outSongs.push(withUniqueName(s, localNames, claimedNames));
      outPatterns.push(...beats);
      summary.songsAdded++;
      for (const p of beats) (localPat.has(p.id) ? summary.patternsReplaced++ : summary.patternsAdded++);
      continue;
    }
    conflicts++;
    if (keepBoth) {
      const sid = newId();
      const m = new Map(idMap);
      const beats = owned.map((p) => {
        const id = localPat.has(p.id) ? newId() : p.id;
        m.set(p.id, id);
        return { ...p, id, ownerSongId: sid };
      });
      const s = withUniqueName({ ...remapSong(s0, m), id: sid }, localNames, claimedNames);
      outSongs.push(s);
      outPatterns.push(...beats);
      summary.songsAdded++;
      summary.patternsAdded += beats.length;
      if (firstSongId === s0.id) firstSongId = sid;
    } else {
      outSongs.push(song);
      for (const p of owned) {
        const lp = localPat.get(p.id);
        if (lp && same(lp, p)) summary.skipped++;
        else {
          outPatterns.push(p);
          if (lp) summary.patternsReplaced++;
          else summary.patternsAdded++;
        }
      }
      summary.songsReplaced++;
    }
  }
  // A skipped (identical) first song stays selectable by its own id; a copied one points at the copy (set above).

  // Beats that were owned by a song in the file but whose song record was skipped as unreadable are dropped by
  // parseImport's owner handling (they become normal grooves there), so nothing else is left to place.

  // 3. References that resolve nowhere: kept (the section plays silence) but reported.
  const known = new Set<string>([...localPat.keys(), ...outPatterns.map((p) => p.id), ...pats.map((p) => p.id)]);
  let dangling = 0;
  for (const s of outSongs) {
    const missing = new Set(songPatternIds(s).filter((id) => !isBuiltInId(id) && !known.has(id)));
    dangling += missing.size;
  }
  if (dangling > 0) {
    warnings.push(
      `${plural(dangling, 'beat')} used by the songs ${dangling === 1 ? 'is' : 'are'} missing from this file and this device; those sections will play silence until you pick another beat`,
    );
  }
  return { patterns: outPatterns, songs: outSongs, summary, conflicts, firstSongId, warnings, songDeletes };
}

function withUniqueName(s: Song, local: ReadonlySet<string>, claimed: Set<string>): Song {
  const taken = (n: string) => local.has(n) || claimed.has(n);
  let name = s.name;
  if (taken(name)) {
    name = s.name + IMPORTED_SUFFIX;
    for (let i = 2; taken(name); i++) name = `${s.name}${IMPORTED_SUFFIX} ${i}`;
  }
  claimed.add(name);
  return name === s.name ? s : { ...s, name };
}

/** "3 songs, 12 beats" (zero counts left out). */
export function countsLabel(songs: number, beats: number): string {
  const parts = [];
  if (songs) parts.push(plural(songs, 'song'));
  if (beats) parts.push(plural(beats, 'beat'));
  return parts.join(', ') || 'nothing';
}
