import { IconCopy, IconTrash } from '../common/icons';
import { PatternPicker } from '../common/PatternPicker';
import { SaveStatusChip } from '../common/SaveStatus';
import {
  bpmOverrides,
  current,
  currentId,
  duplicateCurrent,
  library,
  newPattern,
  renameCurrent,
  requestDelete,
  selectPattern,
} from '../state/lab';

export function PatternHeader() {
  const p = current.value;
  const overrides = bpmOverrides.value;
  return (
    <header class="pattern-header">
      <PatternPicker
        patterns={library.value}
        currentId={currentId.value}
        onSelect={selectPattern}
        onRename={renameCurrent}
        onNew={newPattern}
        bpmOf={(q) => overrides[q.id] ?? q.bpm}
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
  );
}
