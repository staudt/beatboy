/** "Import drum tab": a paste sheet that turns a tab into a new song (parser in src/import/tab). */
import { signal } from '@preact/signals';
import { songFromTab } from '../../import/tab/toSong';
import type { TabImport } from '../../import/tab';
import { confirmReq, putImportedPatterns, showToast } from './lab';
import { DEFAULT_FILL_ID } from './drummerLogic';
import { putImportedSongs, selectSong } from './songs';

export const tabImportOpen = signal(false);
export const openTabImport = (): void => {
  tabImportOpen.value = true;
};
export const closeTabImport = (): void => {
  tabImportOpen.value = false;
};

/** Creates the song (and its song-local beats), selects it in the Drummer and closes the sheet. */
export async function createSongFromTab(tab: TabImport, name: string, bpm: number): Promise<boolean> {
  const { song, patterns } = songFromTab(tab, { name, bpm, fillId: DEFAULT_FILL_ID });
  if (song.sections.length === 0) return false;
  try {
    await putImportedPatterns(patterns); // beats first: no song may point at a missing beat
    await putImportedSongs([song]);
  } catch (e) {
    confirmReq.value = {
      title: "Can't import this tab",
      body: e instanceof Error ? e.message : 'The song could not be saved.',
      confirmLabel: 'OK',
      onConfirm: () => {},
      blocked: true,
    };
    return false;
  }
  closeTabImport();
  selectSong(song.id);
  showToast(`Imported tab: ${song.sections.length} section${song.sections.length === 1 ? '' : 's'}`);
  return true;
}
