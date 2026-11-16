import { useState } from 'preact/hooks';
import { countsLabel, type ImportStrategy } from '../../storage/exportImport';
import { applyImport, importReq, planFor, type ImportReq } from '../state/backup';
import { Sheet } from './Sheet';

const MAX_NAMES = 8;

/** Preview of a parsed backup / shared song: what is in it, conflicts and how to resolve them. */
export function ImportSheet() {
  const req = importReq.value;
  if (!req) return null;
  return <Body key={req.fileName + req.songs.length + req.patterns.length} req={req} />;
}

function Body({ req }: { req: ImportReq }) {
  const [strategy, setStrategy] = useState<ImportStrategy>('keepBoth');
  const close = () => (importReq.value = null);
  const plan = planFor(req, strategy);
  const nothing = plan.songs.length + plan.patterns.length === 0;
  const names = req.songs.map((s) => s.name);
  return (
    <Sheet title="Import" onClose={close} className="sheet-small">
      <p class="sheet-text" data-testid="import-summary">
        Importing: {countsLabel(req.songs.length, req.patterns.length)}
      </p>
      {names.length > 0 && (
        <ul class="imp-list" aria-label="Songs in this file">
          {names.slice(0, MAX_NAMES).map((n, i) => (
            <li key={i}>{n}</li>
          ))}
          {names.length > MAX_NAMES && <li class="imp-more">and {names.length - MAX_NAMES} more</li>}
        </ul>
      )}
      {req.warnings.map((w) => (
        <p key={w} class="imp-warn" role="note">
          {w}
        </p>
      ))}
      {plan.warnings.map((w) => (
        <p key={w} class="imp-warn" role="note">
          {w}
        </p>
      ))}
      {nothing ? (
        <p class="sheet-text" data-testid="import-conflicts">
          Everything in this file is already here.
        </p>
      ) : plan.conflicts > 0 ? (
        <fieldset class="imp-choice">
          <legend class="sheet-text" data-testid="import-conflicts">
            {plan.conflicts === 1 ? '1 item exists' : `${plan.conflicts} items exist`} here with different content.
          </legend>
          <label class="gv-check">
            <input type="radio" name="strategy" checked={strategy === 'keepBoth'} onChange={() => setStrategy('keepBoth')} />
            <span>Keep both (recommended)</span>
          </label>
          <label class="gv-check">
            <input type="radio" name="strategy" checked={strategy === 'replace'} onChange={() => setStrategy('replace')} />
            <span>Replace existing</span>
          </label>
        </fieldset>
      ) : plan.summary.skipped > 0 ? (
        <p class="sheet-text" data-testid="import-conflicts">
          {plan.summary.skipped} already here, unchanged.
        </p>
      ) : null}
      <div class="sheet-actions">
        <button type="button" class="btn" onClick={close}>
          Cancel
        </button>
        <button type="button" class="btn btn-primary" data-autofocus disabled={nothing} onClick={() => void applyImport(req, strategy)}>
          Import
        </button>
      </div>
    </Sheet>
  );
}
