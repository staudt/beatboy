import { setBars, setBeats, setStepsPerBeat, setSwing } from '../../domain/patternOps';
import { PATTERN_LIMITS } from '../../domain/types';
import { Stepper } from '../common/Stepper';
import { stepLabel } from '../gridLayout';
import { current, editCurrent } from '../state/lab';

export function PatternSettings() {
  const p = current.value;
  const swing = Math.round(p.swing * 100);
  const triplet = p.stepsPerBeat === 3;
  const spbMin = Math.min(...PATTERN_LIMITS.stepsPerBeat);
  const spbMax = Math.max(...PATTERN_LIMITS.stepsPerBeat);
  return (
    <section class="settings" aria-label="Pattern settings">
      <div class="field">
        <span class="label">beats</span>
        <Stepper label="Beats" value={p.timeSig.num} min={PATTERN_LIMITS.minBeats} max={PATTERN_LIMITS.maxBeats} onChange={(v) => editCurrent((q) => setBeats(q, v))} />
        <span class="hint">one row per beat</span>
      </div>
      <div class="field">
        <span class="label">steps · {stepLabel(p.stepsPerBeat)}</span>
        <Stepper label="Steps" value={p.stepsPerBeat} min={spbMin} max={spbMax} onChange={(v) => editCurrent((q) => setStepsPerBeat(q, v))} />
        <span class="hint">per beat: 1 quarters · 2 8ths · 3 triplets · 4 16ths</span>
      </div>
      <div class="field">
        <span class="label">bars</span>
        <Stepper label="Bars" value={p.bars} min={PATTERN_LIMITS.minBars} max={PATTERN_LIMITS.maxBars} onChange={(v) => editCurrent((q) => setBars(q, v))} />
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
        {triplet && <span class="hint">Triplet grids are already swung.</span>}
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
