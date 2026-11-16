/** Backup / sharing: export to a file, import from a file (preview, conflict strategy, persistence). */
import { signal } from '@preact/signals';
import type { Song } from '../../domain/song';
import type { Pattern } from '../../domain/types';
import {
  countsLabel,
  exportFileName,
  exportLibrary,
  exportSong,
  libraryFileName,
  parseImport,
  planImport,
  serialize,
  type ImportPlan,
  type ImportStrategy,
} from '../../storage/exportImport';
import { currentSettings } from './drummer';
import { confirmReq, getRepo, initLab, library, putImportedPatterns, showToast } from './lab';
import { collectLocalBeats, currentSong, putImportedSongs, removeSongs, selectSong, songs } from './songs';

const LAST_EXPORT_KEY = 'lastExportAt';

/** When the last export finished (ms), null = never. */
export const lastExportAt = signal<number | null>(null);

/** A parsed file waiting for the user's decision in the preview sheet. */
export interface ImportReq {
  fileName: string;
  songs: Song[];
  patterns: Pattern[];
  warnings: string[];
}
export const importReq = signal<ImportReq | null>(null);

export async function initBackup(): Promise<void> {
  await initLab();
  try {
    const v = await getRepo()?.getSetting<unknown>(LAST_EXPORT_KEY);
    if (typeof v === 'number' && Number.isFinite(v)) lastExportAt.value = v;
  } catch {
    /* no storage: "never" */
  }
}

const userPatterns = (): Pattern[] => library.peek().filter((p) => !p.builtIn);

function markExported(): void {
  const now = Date.now();
  lastExportAt.value = now;
  void getRepo()?.setSetting(LAST_EXPORT_KEY, now).catch(() => {});
}

/** Saves a text file: the native share sheet on phones that can share files, else a download. Returns false when cancelled. */
export async function saveTextFile(name: string, text: string): Promise<boolean> {
  const type = 'application/json';
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (touch && typeof File === 'function') {
    try {
      const file = new File([text], name, { type });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return true;
      }
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return false;
      /* share failed: fall back to a download */
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

export async function exportEverything(): Promise<void> {
  const file = exportLibrary({ patterns: userPatterns(), songs: songs.peek(), drummer: currentSettings() });
  if (await saveTextFile(libraryFileName(), serialize(file))) {
    markExported();
    showToast(`Exported ${countsLabel(file.songs.length, file.patterns.length)}`);
  }
}

export async function exportCurrentSong(): Promise<void> {
  const song = currentSong.peek();
  if (!song) return;
  const file = exportSong(song, library.peek());
  if (await saveTextFile(exportFileName(song.name), serialize(file))) showToast(`Exported ${song.name}`);
}

function fail(error: string): void {
  confirmReq.value = { title: "Can't import this file", body: error, confirmLabel: 'OK', onConfirm: () => {}, blocked: true };
}

/** Reads a file the user picked or dropped and opens the preview (or explains why it can't be imported). */
export async function startImport(file: File): Promise<void> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    fail('The file could not be read.');
    return;
  }
  const r = parseImport(text);
  if (!r.ok) {
    fail(r.error);
    return;
  }
  importReq.value = { fileName: file.name, songs: r.songs, patterns: r.patterns, warnings: r.warnings };
}

export function planFor(req: ImportReq, strategy: ImportStrategy): ImportPlan {
  return planImport({ patterns: library.peek(), songs: songs.peek() }, req, strategy);
}

/** Writes the plan (patterns first, so no song ever points at a missing beat), selects the first imported song. */
export async function applyImport(req: ImportReq, strategy: ImportStrategy): Promise<void> {
  const plan = planFor(req, strategy);
  importReq.value = null;
  try {
    await putImportedPatterns(plan.patterns);
    await putImportedSongs(plan.songs);
    removeSongs(plan.songDeletes);
  } catch (e) {
    fail(e instanceof Error ? e.message : 'The import could not be saved.');
    return;
  }
  collectLocalBeats();
  const s = plan.summary;
  const nSongs = s.songsAdded + s.songsReplaced;
  const nBeats = s.patternsAdded + s.patternsReplaced;
  showToast(nSongs + nBeats === 0 ? 'Nothing new to import' : `Imported ${countsLabel(nSongs, nBeats)}`);
  if (plan.firstSongId) selectSong(plan.firstSongId);
}
