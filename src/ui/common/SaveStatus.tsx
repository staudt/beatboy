import { current, retrySave, saveMessage, saveStatus } from '../state/lab';

export function SaveStatusChip() {
  const s = saveStatus.value;
  const builtIn = current.value.builtIn;
  let label: string;
  let kind: string;
  if (s === 'error') {
    label = 'Not saved';
    kind = 'error';
  } else if (s === 'saving') {
    label = 'Saving…';
    kind = 'saving';
  } else if (builtIn) {
    label = 'Built-in';
    kind = 'builtin';
  } else {
    label = 'Saved';
    kind = 'saved';
  }
  const msg = saveMessage.value;
  if (s === 'error') {
    return (
      <button type="button" class={`chip chip-${kind}`} title={msg ?? ''} aria-label={`${label}. ${msg ?? ''} Tap to retry.`} onClick={retrySave}>
        <span class="chip-dot" aria-hidden="true" />
        {label}
      </button>
    );
  }
  return (
    <span class={`chip chip-${kind}`} role="status" title={builtIn ? 'Built-in patterns are read-only. Editing makes your own copy.' : undefined}>
      <span class="chip-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
