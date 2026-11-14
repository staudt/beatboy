import { dismissToast, toast } from '../state/lab';

export function Toast() {
  const t = toast.value;
  if (!t) return null;
  return (
    <div class="toast" role="status" aria-live="polite" key={t.id}>
      <span class="toast-msg">{t.message}</span>
      {t.action && (
        <button
          type="button"
          class="btn btn-small"
          onClick={() => {
            const run = t.action?.run;
            dismissToast();
            run?.();
          }}
        >
          {t.action.label}
        </button>
      )}
    </div>
  );
}
