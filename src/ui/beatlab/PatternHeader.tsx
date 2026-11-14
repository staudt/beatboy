import { useState } from 'preact/hooks';
import { IconChevron, IconCopy, IconPencil, IconTrash } from '../common/icons';
import { Sheet } from '../common/Sheet';
import { SaveStatusChip } from '../common/SaveStatus';
import {
  browserOpen,
  current,
  duplicateCurrent,
  renameCurrent,
  renameOpen,
  requestDelete,
} from '../state/lab';

function RenameSheet() {
  const [name, setName] = useState(current.peek().name);
  const close = () => (renameOpen.value = false);
  return (
    <Sheet title="Rename pattern" onClose={close} className="sheet-small">
      <form
        class="form"
        onSubmit={(e) => {
          e.preventDefault();
          renameCurrent(name);
          close();
        }}
      >
        <input
          class="input"
          type="text"
          value={name}
          maxLength={48}
          aria-label="Pattern name"
          autoComplete="off"
          onInput={(e) => setName(e.currentTarget.value)}
        />
        <div class="sheet-actions">
          <button type="button" class="btn" onClick={close}>
            Cancel
          </button>
          <button type="submit" class="btn btn-primary">
            Rename
          </button>
        </div>
      </form>
    </Sheet>
  );
}

export function PatternHeader() {
  const p = current.value;
  return (
    <header class="pattern-header">
      <button type="button" class="pattern-pick" aria-label="Browse patterns" aria-haspopup="dialog" onClick={() => (browserOpen.value = true)}>
        <IconChevron />
        <span class="pattern-name" data-testid="pattern-name">
          {p.name}
        </span>
      </button>
      <button type="button" class="btn btn-icon" aria-label="Rename pattern" onClick={() => (renameOpen.value = true)}>
        <IconPencil />
      </button>
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
      {renameOpen.value && <RenameSheet />}
    </header>
  );
}
