import type { Pattern } from '../../domain/types';
import { IconPlus } from '../common/icons';
import { Sheet } from '../common/Sheet';
import { bpm, bpmOverrides, browserOpen, currentId, library, newPattern, selectPattern } from '../state/lab';

function groups(list: readonly Pattern[]): [string, Pattern[]][] {
  const map = new Map<string, Pattern[]>();
  for (const p of list) {
    const cat = p.category || 'Other';
    const arr = map.get(cat);
    if (arr) arr.push(p);
    else map.set(cat, [p]);
  }
  const entries = [...map.entries()];
  // Categories holding user patterns first, then factory order.
  const hasUser = (arr: Pattern[]) => arr.some((p) => !p.builtIn);
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => Number(hasUser(b.e[1])) - Number(hasUser(a.e[1])) || a.i - b.i)
    .map((x) => x.e);
}

export function PatternBrowser() {
  if (!browserOpen.value) return null;
  const close = () => (browserOpen.value = false);
  const cur = currentId.value;
  void bpm.value;
  const overrides = bpmOverrides.value;
  return (
    <Sheet title="Patterns" onClose={close} className="sheet-tall">
      <button
        type="button"
        class="btn btn-primary btn-wide"
        onClick={() => {
          newPattern();
          close();
        }}
      >
        <IconPlus /> New beat
      </button>
      {groups(library.value).map(([cat, list]) => (
        <section class="browser-group" key={cat} aria-label={cat}>
          <h3 class="label">{cat}</h3>
          <ul class="browser-list">
            {list.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  class={`browser-item${p.id === cur ? ' is-current' : ''}`}
                  aria-current={p.id === cur ? 'true' : undefined}
                  onClick={() => {
                    selectPattern(p.id);
                    close();
                  }}
                >
                  <span class="bi-name">{p.name}</span>
                  <span class="bi-meta">
                    {p.timeSig.num}×{p.stepsPerBeat} · {overrides[p.id] ?? p.bpm} BPM · {p.bars} bar{p.bars === 1 ? '' : 's'}
                    {p.builtIn ? ' · built-in' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </Sheet>
  );
}
