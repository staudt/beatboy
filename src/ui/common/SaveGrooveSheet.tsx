import { useState } from 'preact/hooks';
import { saveAsGroove, saveGrooveReq } from '../state/lab';
import { Sheet } from './Sheet';

/** Asks for a name, then turns a song-local beat into a library groove. */
export function SaveGrooveSheet() {
  const req = saveGrooveReq.value;
  if (!req) return null;
  return <Body key={req.id} id={req.id} initial={req.name} />;
}

function Body({ id, initial }: { id: string; initial: string }) {
  const [name, setName] = useState(initial);
  const close = () => (saveGrooveReq.value = null);
  const save = () => {
    close();
    saveAsGroove(id, name);
  };
  return (
    <Sheet title="Save as groove" onClose={close} className="sheet-small">
      <label class="pp-field">
        <span class="label">name</span>
        <input
          class="input"
          type="text"
          value={name}
          maxLength={48}
          aria-label="Groove name"
          autoComplete="off"
          data-autofocus
          onInput={(e) => setName(e.currentTarget.value)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              save();
            }
          }}
        />
      </label>
      <div class="sheet-actions">
        <button type="button" class="btn" onClick={close}>
          Cancel
        </button>
        <button type="button" class="btn btn-primary" onClick={save}>
          Save
        </button>
      </div>
    </Sheet>
  );
}
