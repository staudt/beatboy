import type { Pattern } from '../../domain/types';
import { useMemo } from 'preact/hooks';
import { lengthLabel } from '../../domain/time';
import { songGrooves } from '../state/songLogic';
import { currentSong } from '../state/songs';
import { IconCopy, IconTrash } from '../common/icons';
import { PatternPicker } from '../common/PatternPicker';
import { SaveStatusChip } from '../common/SaveStatus';
import {
  choosePattern,
  current,
  currentId,
  duplicateCurrent,
  library,
  newPattern,
  renameCurrent,
  requestDelete,
  requestSaveAsGroove,
} from '../state/lab';

export function PatternHeader() {
  const p = current.value;
  const local = !!p.ownerSongId;
  // Song beats stay out of the list, except the one being edited (shown under "Song beat").
  const list = library.value.flatMap((q) => (q.id === p.id && local ? [{ ...q, category: 'Song beat' }] : q.ownerSongId ? [] : [q]));
  const song = currentSong.value;
  const lead = useMemo(() => {
    const g = songGrooves(song, library.value);
    if (!song || !g.patterns.length) return undefined;
    const names = (q: Pattern) => g.sections.get(q.id) ?? [];
    return {
      title: `In ${song.name}`,
      patterns: g.patterns,
      subtitleOf: (q: Pattern) => `${names(q).join(', ')} · ${lengthLabel(q)}`,
      searchText: (q: Pattern) => names(q).join(' '),
    };
  }, [song, library.value]);
  return (
    <>
    <header class="pattern-header">
      <PatternPicker
        patterns={list}
        leadingGroup={lead}
        currentId={currentId.value}
        onSelect={choosePattern}
        onRename={renameCurrent}
        onNew={newPattern}
        label="Patterns"
        nameTestId="pattern-name"
      />
      <span class="spacer" />
      <button type="button" class="btn btn-icon" aria-label="Duplicate pattern" onClick={duplicateCurrent}>
        <IconCopy />
      </button>
      <button
        type="button"
        class="btn btn-icon"
        aria-label="Delete pattern"
        disabled={p.builtIn}
        title={p.builtIn ? 'Built-in patterns cannot be deleted' : 'Delete pattern'}
        onClick={() => requestDelete(p.id)}
      >
        <IconTrash />
      </button>
      <SaveStatusChip />
    </header>
    {local && (
      // Own line under the header so the beat's name keeps its room on phones.
      <div class="ph-songbeat">
        <span class="tag" data-testid="song-beat-tag" title="This beat belongs to a song">
          song beat
        </span>
        <span class="ph-songbeat-hint">only used in its song</span>
        <button type="button" class="btn ph-save" onClick={() => requestSaveAsGroove(p.id)}>
          Save as groove
        </button>
      </div>
    )}
    </>
  );
}
