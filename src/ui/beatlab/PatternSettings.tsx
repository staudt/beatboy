import { offGridCount, setBars, setStepsPerBeat, setSwing, setTimeSig } from '../../domain/patternOps';
import { PATTERN_LIMITS, type BeatUnit } from '../../domain/types';
import { Stepper } from '../common/Stepper';
import { stepLabel } from '../gridLayout';
import { current, editCurrent } from '../state/lab';

export const TIME_SIGS = ['2/4', '3/4', '4/4', '5/4', '7/4', '6/8', '7/8', '9/8', '12/8'] as const;

export function PatternSettings() {
  const p = current.value;
  const ts = `${p.timeSig.num}/${p.timeSig.den}`;
  const tsOptions: string[] = TIME_SIGS.includes(ts as (typeof TIME_SIGS)[number]) ? [...TIME_SIGS] : [ts, ...TIME_SIGS];
  const off = offGridCount(p);
  const swing = Math.round(p.swing * 100);
  const triplet = p.stepsPerBeat === 3 || p.stepsPerBeat === 6;
  return (
    <section class="settings" aria-label="Pattern settings">
      <label class="field">
        <span class="label">time signature</span>
        <select
          class="select"
          value={ts}
          aria-label="Time signature"
          onChange={(e) => {
            const [n, d] = e.currentTarget.value.split('/').map(Number);
            editCurrent((q) => setTimeSig(q, { num: n as number, den: d as BeatUnit }));
          }}
        >
          {tsOptions.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label class="field">
        <span class="label">grid resolution</span>
        <select
          class="select"
          value={String(p.stepsPerBeat)}
          aria-label="Grid resolution"
          onChange={(e) => editCurrent((q) => setStepsPerBeat(q, Number(e.currentTarget.value)))}
        >
          {PATTERN_LIMITS.stepsPerBeat.map((n) => (
            <option key={n} value={String(n)}>
              {stepLabel(p.timeSig, n)}
            </option>
          ))}
        </select>
      </label>
      {off > 0 && (
        <p class="notice" role="status">
          {off} note{off === 1 ? ' is' : 's are'} between grid steps (still audible)
        </p>
      )}
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
