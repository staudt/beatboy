import { confirmReq } from '../state/lab';
import { Sheet } from './Sheet';

export function ConfirmSheet() {
  const req = confirmReq.value;
  if (!req) return null;
  const close = () => (confirmReq.value = null);
  return (
    <Sheet title={req.title} onClose={close} className="sheet-small">
      <p class="sheet-text">{req.body}</p>
      <div class="sheet-actions">
        {req.blocked ? (
          <button type="button" class="btn" data-autofocus onClick={close}>
            OK
          </button>
        ) : (
          <>
            <button type="button" class="btn" data-autofocus onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              class="btn btn-danger"
              onClick={() => {
                close();
                req.onConfirm();
              }}
            >
              {req.confirmLabel}
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}
