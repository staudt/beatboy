import { SOUNDS } from '../../domain/sounds';
import { gridRowsLabeled } from '../gridLayout';
import { current, selectedSound, visibleBar } from '../state/lab';
import { StepCell } from './StepCell';

/** Mobile step editor for the selected sound, one musical group per row. */
export function StepGrid() {
  const p = current.value;
  const sound = selectedSound.value;
  const perBar = p.timeSig.num * p.stepsPerBeat;
  const base = visibleBar.value * perBar;
  const rows = gridRowsLabeled(p.timeSig, p.stepsPerBeat);
  return (
    <section class="stepgrid" aria-label={`${SOUNDS[sound].name} steps`}>
      <div class="stepgrid-head">
        <h3 class="stepgrid-title">{SOUNDS[sound].name}</h3>
        <span class="hint" aria-hidden="true">
          tap: <i class="glyph g-normal" /> → <i class="glyph g-accent" /> → <i class="glyph g-ghost" /> → off
        </span>
      </div>
      {rows.map((row) => (
        <div class="step-row" key={row.label}>
          <span class="row-label" aria-hidden="true">
            {row.label}
          </span>
          <div class="step-cells" style={{ '--n': row.steps.length }}>
            {row.steps.map((s) => (
              <StepCell key={`${sound}-${base + s}`} sound={sound} step={base + s} beatStart={s % p.stepsPerBeat === 0} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
