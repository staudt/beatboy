/** Song mode of the Drummer: song library, arrangement editing, playback and the live performance actions. */
import { batch, computed, effect, signal } from '@preact/signals';
import { engine } from '../../audio/engine';
import type { SongAction } from '../../domain/song';
import { SONG_LIMITS, type SectionKind, type Song } from '../../domain/song';
import {
  addSection,
  createSection,
  createSong,
  demoSong,
  practiceSong,
  duplicateSection,
  moveSection,
  removeSection,
  renameSong as renameSongOp,
  setSongBpm,
  setSongFill,
  songsUsingPattern,
  updateSection,
  type SectionPatch,
} from '../../domain/songOps';
import type { SongInfo } from '../../engine/songSource';
import { Autosaver, installLifecycleFlush, type SaveStatus } from '../../storage/autosave';
import * as drummer from './drummer';
import { DEFAULT_FILL_ID, DEFAULT_GROOVE_ID } from './drummerLogic';
import { garbageLocalPatterns, forkLocal, isSongLocal, localBeatName, localPatternFor } from '../../domain/songBeats';
import type { Pattern } from '../../domain/types';
import {
  addLibraryPattern,
  confirmReq,
  dropLibraryPatterns,
  getRepo,
  hooks,
  library,
  putLibraryPattern,
  showToast,
  trackKit,
} from './lab';
import { songBpmToWrite, buildSongConfig, clampStartIndex, newSectionFor, nextSongName, sameInfo } from './songLogic';

// ── state ────────────────────────────────────────────────────────
/** False until the songs are loaded, so the first paint is not an empty Drummer. */
export const songsReady = signal(false);
/** Screen-reader announcement (reorder results). */
export const announcement = signal('');
export const songs = signal<Song[]>([]);
export const currentSongId = signal<string | null>(null);
export const currentSong = computed<Song | null>(() => songs.value.find((s) => s.id === currentSongId.value) ?? null);
export const songSaveStatus = signal<SaveStatus>('idle');
/** Section the user tapped while stopped (= start section; also where "+ section" inserts). */
export const selectedSectionId = signal<string | null>(null);
/** Section last played or touched (runtime only): the Beat Editor opens its beat when switching tabs while stopped. */
export const focusSectionId = signal<string | null>(null);
/** Marks a section as the one the user is working with. */
export function touchSection(id: string): void {
  focusSectionId.value = id;
}

export const songPlaying = signal(false);
export const songInfo = signal<SongInfo | null>(null);
/** Section index currently audible (null when stopped); a computed so cards update only on change. */
export const playingSectionIndex = computed<number | null>(() => (songPlaying.value ? (songInfo.value?.sectionIndex ?? null) : null));
export const fillState = computed<'none' | 'queued' | 'active'>(() => {
  const i = songInfo.value;
  return !i ? 'none' : i.phase === 'fill' ? 'active' : i.fillQueued ? 'queued' : 'none';
});

const startIndex = (): number => clampStartIndex(currentSong.peek(), selectedSectionId.peek());

// ── persistence ──────────────────────────────────────────────────
let saver: Autosaver<Song> | null = null;

/** Immutable edit of the current song (autosaved). */
export function editSong(fn: (s: Song) => Song): void {
  const cur = currentSong.peek();
  if (!cur) return;
  const next = fn(cur);
  if (next === cur) return;
  songs.value = songs.peek().map((s) => (s.id === cur.id ? next : s));
  saver?.schedule(next);
}

/** Imported songs (new or replacing the same ids): into the list (newest first), then written and flushed. */
export async function putImportedSongs(list: readonly Song[]): Promise<void> {
  if (list.length === 0) return;
  const ids = new Set(list.map((s) => s.id));
  songs.value = [...list, ...songs.peek().filter((s) => !ids.has(s.id))];
  for (const s of list) saver?.schedule(s);
  await saver?.flush();
  if (saver?.status === 'error') throw new Error("Couldn't save the imported songs.");
}

/** Removes songs by id (used by import to drop untouched starter songs replaced by a backup). */
export function removeSongs(ids: readonly string[]): void {
  if (ids.length === 0) return;
  const drop = new Set(ids);
  songs.value = songs.peek().filter((s) => !drop.has(s.id));
  for (const id of ids) saver?.scheduleDelete(id);
}

export function retrySongSave(): void {
  void saver?.retry();
}

// ── library actions ──────────────────────────────────────────────
function enter(song: Song | null): void {
  batch(() => {
    currentSongId.value = song?.id ?? null;
    selectedSectionId.value = null;
    focusSectionId.value = null;
    if (song) drummer.setBpm(song.bpm);
  });
}

export function selectSong(id: string): void {
  const s = songs.peek().find((x) => x.id === id);
  if (!s || id === currentSongId.peek()) return;
  if (engine.mode === 'song') engine.stop();
  enter(s);
}

export function newSong(): void {
  if (engine.mode === 'song') engine.stop();
  const lib = library.peek();
  const g = drummer.lastGrooveId.peek();
  const grooveId = g && lib.some((p) => p.id === g && !p.ownerSongId) ? g : DEFAULT_GROOVE_ID;
  const song = createSong({
    name: nextSongName(songs.peek()),
    bpm: drummer.bpm.peek(),
    beatsPerBar: 4,
    fillId: DEFAULT_FILL_ID,
    sections: [{ ...createSection('verse', grooveId, 8), name: 'Verse' }],
  });
  songs.value = [song, ...songs.peek()];
  saver?.schedule(song);
  enter(song);
}

export function duplicateSong(): void {
  const cur = currentSong.peek();
  if (!cur) return;
  if (engine.mode === 'song') engine.stop();
  const now = Date.now();
  const id = crypto.randomUUID();
  const name = `${cur.name} copy`;
  const lib = library.peek();
  const copy: Song = {
    ...cur,
    id,
    name,
    // song-local beats belong to one song: the copy gets its own
    sections: cur.sections.map((s) => {
      const sec = { ...s, id: crypto.randomUUID(), fill: { ...s.fill } };
      const p = lib.find((x) => x.id === s.patternId);
      if (p && isSongLocal(p)) {
        const own = forkLocal(p, id, localBeatName({ name }, sec), now);
        addLibraryPattern(own);
        sec.patternId = own.id;
      }
      return sec;
    }),
    createdAt: now,
    updatedAt: now,
  };
  songs.value = [copy, ...songs.peek()];
  saver?.schedule(copy);
  enter(copy);
  showToast(`Duplicated as ${copy.name}`);
}

export function renameSong(name: string): void {
  editSong((s) => renameSongOp(s, name));
}

export function requestDeleteSong(): void {
  const cur = currentSong.peek();
  if (!cur) return;
  confirmReq.value = {
    title: 'Delete song?',
    body: `"${cur.name}" will be removed from this device. This can't be undone.`,
    confirmLabel: 'Delete',
    onConfirm: () => {
      if (engine.mode === 'song') engine.stop();
      const rest = songs.peek().filter((s) => s.id !== cur.id);
      songs.value = rest;
      saver?.scheduleDelete(cur.id);
      enter(rest[0] ?? null);
      collectLocalBeats();
      showToast(`Deleted ${cur.name}`);
    },
  };
}

// ── arrangement edits ────────────────────────────────────────────
/** Appends a section (groove = the last section's) at the end of the arrangement. */
export function addSectionOfKind(kind: SectionKind): void {
  const song = currentSong.peek();
  if (!song || song.sections.length >= SONG_LIMITS.maxSections) return;
  const section = newSectionFor(song, kind, song.sections.length, DEFAULT_GROOVE_ID);
  const prev = library.peek().find((p) => p.id === section.patternId);
  if (prev && isSongLocal(prev)) {
    const own = forkLocal(prev, song.id, localBeatName(song, section));
    addLibraryPattern(own);
    section.patternId = own.id;
  }
  editSong((s) => addSection(s, section));
}

export function patchSection(id: string, patch: SectionPatch): void {
  if (patch.patternId && !library.peek().find((p) => p.id === patch.patternId)?.ownerSongId) drummer.lastGrooveId.value = patch.patternId;
  if (patch.patternId) touchSection(id);
  editSong((s) => updateSection(s, id, patch));
}

/** Moves a section to a new position; the result is announced to screen readers. */
export function moveSectionTo(id: string, to: number): void {
  const song = currentSong.peek();
  const from = song?.sections.findIndex((x) => x.id === id) ?? -1;
  if (!song || from < 0 || from === to) return;
  const dest = Math.min(song.sections.length - 1, Math.max(0, to));
  editSong((s) => moveSection(s, from, dest));
  announcement.value = `${song.sections[from]!.name} moved to position ${dest + 1} of ${song.sections.length}`;
}

export function moveSectionBy(id: string, d: -1 | 1): void {
  const i = currentSong.peek()?.sections.findIndex((x) => x.id === id) ?? -1;
  if (i >= 0) moveSectionTo(id, i + d);
}

/** Copy of the section, inserted right below it. */
export function duplicateSectionById(id: string): void {
  const song = currentSong.peek();
  const i = song?.sections.findIndex((x) => x.id === id) ?? -1;
  if (!song || i < 0 || song.sections.length >= SONG_LIMITS.maxSections) return;
  const src = song.sections[i]!;
  const p = library.peek().find((x) => x.id === src.patternId);
  // a song-local beat is copied too, so the duplicate's edits never change the original
  const own = p && isSongLocal(p) ? forkLocal(p, song.id, `${song.name} · ${src.name} copy`) : null;
  if (own) addLibraryPattern(own);
  editSong((s) => {
    const d = duplicateSection(s, id);
    const dup = d.sections[i + 1];
    return own && dup ? updateSection(d, dup.id, { patternId: own.id }) : d;
  });
}

// ── song-local beats (typed beat text) ───────────────────────────
/** Deletes song-local beats no section uses (startup and song delete only: never during the section Undo window). */
export function collectLocalBeats(): void {
  dropLibraryPatterns(garbageLocalPatterns(library.peek(), songs.peek()));
}

export type TextApply = { ok: true; warnings: string[] } | { ok: false; error: string };

/** Beat text of a section's current pattern, as one line. */
export function sectionPattern(sectionId: string): Pattern | undefined {
  const sec = currentSong.peek()?.sections.find((s) => s.id === sectionId);
  return sec ? library.peek().find((p) => p.id === sec.patternId) : undefined;
}

/**
 * Typed text for a section. A library groove is never changed: the section gets its own song-local copy; a local
 * beat only this section uses is updated in place; one shared by several sections is forked. Playback reads the
 * library live, so the change is heard from the section's next bar.
 */
export function setSectionText(sectionId: string, text: string): TextApply {
  const song = currentSong.peek();
  const sec = song?.sections.find((s) => s.id === sectionId);
  if (!song || !sec) return { ok: false, error: 'No such section' };
  touchSection(sectionId);
  const base = library.peek().find((p) => p.id === sec.patternId);
  const r = localPatternFor(song, sec, text, base, Date.now());
  if (!r.ok) {
    const e = r.errors[0]!;
    return { ok: false, error: `col ${e.col}: ${e.message}` };
  }
  if (r.mode === 'inplace') putLibraryPattern(r.pattern);
  else if (r.mode === 'new') {
    addLibraryPattern(r.pattern);
    editSong((s) => updateSection(s, sectionId, { patternId: r.pattern.id }));
  }
  return { ok: true, warnings: r.warnings };
}


/** Removes a section (no confirmation); the toast offers Undo for 5 s. */
export function deleteSectionById(id: string): void {
  const before = currentSong.peek();
  const index = before?.sections.findIndex((s) => s.id === id) ?? -1;
  const sec = before?.sections[index];
  if (!before || !sec) return;
  editSong((s) => removeSection(s, id));
  if (selectedSectionId.peek() === id) selectedSectionId.value = null;
  showToast(
    `Removed ${sec.name}`,
    {
      label: 'Undo',
      run: () =>
        editSong((s) => (s.id !== before.id || s.sections.some((x) => x.id === sec.id) ? s : addSection(s, sec, index))),
    },
    5000,
  );
}

export function setDefaultFill(id: string): void {
  editSong((s) => setSongFill(s, id));
}

/** Tap on a section row or its go button: jump while playing (applied at the next bar line), else choose the start section. */
export function tapSection(id: string): void {
  const song = currentSong.peek();
  const i = song?.sections.findIndex((s) => s.id === id) ?? -1;
  if (i < 0) return;
  if (engine.mode === 'song') engine.songAct({ type: 'jump', sectionIndex: i });
  else {
    selectedSectionId.value = id;
    focusSectionId.value = id;
  }
}

/** Keyboard number keys: playing = queued jump to section i; stopped = make it the start section. */
export function selectSectionByIndex(i: number): void {
  const sec = currentSong.peek()?.sections[i];
  if (!sec) return;
  if (engine.mode === 'song') engine.songAct({ type: 'jump', sectionIndex: i });
  else {
    selectedSectionId.value = sec.id;
    focusSectionId.value = sec.id;
  }
}

// ── transport ────────────────────────────────────────────────────
/** Call synchronously from a user gesture. */
export function playSong(): void {
  const song = currentSong.peek();
  if (!song) return;
  engine.setBpm(drummer.bpm.peek());
  const getConfig = () =>
    buildSongConfig(currentSong.peek() ?? song, library.peek(), {
      click: drummer.click.peek(),
      countInBars: drummer.countInBars.peek(),
      crashAfterFill: drummer.crashAfterFill.peek(),
    });
  const started = engine.playSong(getConfig, { startSection: startIndex(), countIn: drummer.countInBars.peek() > 0 });
  trackKit(started);
  started.catch(() => {});
}

export function stopSong(): void {
  engine.stop();
}

export function toggleSongPlay(): void {
  if (engine.mode === 'song') stopSong();
  else playSong();
}

export function songAct(action: SongAction): void {
  if (engine.mode !== 'song') return;
  engine.songAct(action);
  pollInfo();
}
/** Playing: queue/accumulate a section change. Stopped: move the start section (the focus follows). */
function step(d: 1 | -1, type: 'next' | 'prev'): void {
  if (engine.mode === 'song') return songAct({ type });
  const song = currentSong.peek();
  if (!song || song.sections.length === 0) return;
  const i = Math.min(song.sections.length - 1, Math.max(0, clampStartIndex(song, selectedSectionId.peek()) + d));
  const sec = song.sections[i]!;
  selectedSectionId.value = sec.id;
  focusSectionId.value = sec.id;
}
export const songNext = (): void => step(1, 'next');
export const songPrev = (): void => step(-1, 'prev');
export const songBreak = (): void => songAct({ type: 'break' });
export const songLoop = (): void => songAct({ type: 'toggleLoop' });
export const songFill = (): void => songAct({ type: 'fill' });

/** The Editor copied a built-in the playing section uses (copy-on-write): that section follows the copy. */
export function followCopy(fromId: string, copyId: string): void {
  const song = currentSong.peek();
  const idx = engine.mode === 'song' ? playingSectionIndex.peek() : null;
  const sec = song && idx !== null ? song.sections[idx] : undefined;
  if (sec && sec.patternId === fromId) patchSection(sec.id, { patternId: copyId });
}

// ── rAF loop + wake lock ─────────────────────────────────────────
let rafId = 0;
function pollInfo(): void {
  const info = engine.songInfo();
  if (!sameInfo(songInfo.peek(), info)) songInfo.value = info;
}
function loop(): void {
  pollInfo();
  rafId = requestAnimationFrame(loop);
}

function syncEngine(): void {
  const now = engine.mode === 'song';
  if (now === songPlaying.peek()) return;
  songPlaying.value = now;
  cancelAnimationFrame(rafId);
  drummer.setSongWakeLock(now);
  if (now) {
    rafId = requestAnimationFrame(loop);
  } else {
    songInfo.value = null;
  }
}

// ── init ─────────────────────────────────────────────────────────
let initPromise: Promise<void> | null = null;
export function initSongs(): Promise<void> {
  initPromise ??= doInit();
  return initPromise;
}

async function doInit(): Promise<void> {
  engine.subscribe(syncEngine);
  // While a song plays the focus follows the playing section (and stays there after Stop).
  effect(() => {
    const i = playingSectionIndex.value;
    const sec = i === null ? undefined : currentSong.peek()?.sections[i];
    if (sec) focusSectionId.value = sec.id;
  });
  hooks.songsUsing = (id) => songsUsingPattern(songs.peek(), id).map((s) => s.name);
  await drummer.initDrummer(); // also waits for the lab (library + repo) and the shared settings
  const repo = getRepo();
  try {
    if (repo) {
      let list = await repo.songs.list();
      if (list.length === 0 && !(await repo.getSetting<boolean>('songsSeeded'))) {
        const now = Date.now();
        // Practice (one looping groove: open the app and press play) first, then the demo arrangement.
        const demo = demoSong(now - 1);
        const practice = practiceSong(drummer.bpm.peek(), now);
        await repo.songs.put(demo);
        await repo.songs.put(practice);
        list = [practice, demo];
      }
      await repo.setSetting('songsSeeded', true);
      songs.value = list;
      collectLocalBeats();
      const last = await repo.getSetting<string>('currentSongId');
      const pick = list.find((s) => s.id === last) ?? list.find((s) => s.name === 'Practice') ?? list[0] ?? null;
      currentSongId.value = pick?.id ?? null;
      saver = new Autosaver<Song>({
        write: (s) => repo.songs.put(s),
        remove: (id) => repo.songs.delete(id),
        onStatus: (s) => (songSaveStatus.value = s),
      });
      installLifecycleFlush(saver);
      effect(() => {
        const id = currentSongId.value;
        if (id) void repo.setSetting('currentSongId', id).catch(() => {});
      });
    } else {
      const practice = practiceSong(drummer.bpm.peek());
      songs.value = [practice, demoSong()];
      currentSongId.value = practice.id;
    }
    // The shared tempo is the song's tempo: adopt it, then write every later change back to the song.
    const cur = currentSong.peek();
    if (cur) drummer.setBpm(cur.bpm);
    effect(() => {
      const next = songBpmToWrite(currentSong.peek(), drummer.bpm.value);
      if (next !== null) editSong((s) => setSongBpm(s, next));
    });
  } catch (e) {
    console.warn('[beatboy] could not load songs', e);
    songSaveStatus.value = 'error';
  } finally {
    songsReady.value = true;
  }
}
