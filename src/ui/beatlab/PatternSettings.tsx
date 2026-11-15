import { feelOf, setFeel, setSwing } from '../../domain/patternOps';
import type { Feel } from '../../domain/types';
import { current, editCurrent } from '../state/lab';

const FEELS: { id: Feel; label: string }[] = [
  { id: 'straight', label: 'Straight' },
  { id: 'triplet', label: 'Triplet' },
];

export function PatternSettings() {
  const p = current.value;
  const swing = Math.round(p.swing * 100);
  const feel = feelOf(p);
  const triplet = feel === 'triplet';
  return (
    <section class="settings" aria-label="Pattern settings">
      <div class="field">
        <span class="label">feel</span>
        <div class="seg" role="group" aria-label="Feel">
          {FEELS.map((f) => (
            <button
              type="button"
              key={f.id}
              class="btn seg-btn"
              aria-pressed={feel === f.id}
              onClick={() => editCurrent((q) => setFeel(q, f.id))}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span class="hint">{triplet ? '3 squares per beat: shuffle, 6/8, 12/8' : '4 squares per beat; for 8th notes leave every other square empty'}</span>
      </div>
      <label class="field">
        <span class="label">swing · {swing <= 50 ? 'straight' : `${swing}%`}</span>
        <input
          class="range"
          type="range"
          min={50}
          max={75}
          step={1}
          value={swing}
          disabled={triplet}
          aria-label="Swing"
          aria-valuetext={swing <= 50 ? 'straight' : `${swing} percent`}
          onInput={(e) => {
            const v = Number(e.currentTarget.value) / 100;
            editCurrent((q) => setSwing(q, v));
          }}
        />
        {triplet ? <span class="hint">Triplet feel is already swung.</span> : <span class="hint">where the “&” of each beat lands: 50% straight, 67% shuffle</span>}
      </label>
      <label class="field">
        <span class="label">category</span>
        <input
          class="input"
          type="text"
          value={p.category}
          maxLength={32}
          aria-label="Category"
          autoComplete="off"
          onChange={(e) => {
            const v = e.currentTarget.value.trim() || 'My beats';
            editCurrent((q) => ({ ...q, category: v, updatedAt: Date.now() }));
          }}
        />
      </label>
    </section>
  );
}
