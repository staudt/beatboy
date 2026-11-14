import { useComputed } from '@preact/signals';
import { getStep, hasNotes } from '../../domain/patternOps';
import { SOUNDS } from '../../domain/sounds';
import { SOUND_IDS } from '../../domain/types';
import { current, playheadStep, selectedSound, stepsInBar, visibleBar } from '../state/lab';
import { levelName } from './cellInput';

function PlayheadOverlay() {
  const col = useComputed(() => {
    const s = playheadStep.value;
    if (s === null) return -1;
    const perBar = stepsInBar.value;
    return Math.floor(s / perBar) === visibleBar.value ? s % perBar : -1;
  });
  const n = stepsInBar.value;
  if (col.value < 0) return null;
  return <div class="ov-playhead" style={{ left: `${(col.value / n) * 100}%`, width: `${100 / n}%` }} />;
}

/** Compact all-track mini grid of the visible bar. Tap a row to select that sound. */
export function OverviewGrid() {
  const p = current.value;
  const perBar = stepsInBar.value;
  const base = visibleBar.value * perBar;
  const sel = selectedSound.value;
  const rows = SOUND_IDS.filter((s) => hasNotes(p, s) || s === sel);
  return (
    <section class="overview" aria-label="Overview of all tracks">
      <h3 class="label">overview</h3>
      <div class="ov-grid">
        {rows.map((s) => (
          <button
            type="button"
            key={s}
            class={`ov-row${s === sel ? ' is-selected' : ''}`}
            aria-label={`Select ${SOUNDS[s].name}`}
            aria-pressed={s === sel}
            onClick={() => (selectedSound.value = s)}
          >
            <span class="ov-name">{SOUNDS[s].short}</span>
            <span class="ov-cells" style={{ '--n': perBar }}>
              {Array.from({ length: perBar }, (_, i) => (
                <i
                  key={i}
                  class={`ov-cell v-${levelName(getStep(p, s, base + i))}${i % p.stepsPerBeat === 0 ? ' beat' : ''}`}
                />
              ))}
            </span>
          </button>
        ))}
        <div class="ov-overlay" aria-hidden="true">
          <PlayheadOverlay />
        </div>
      </div>
    </section>
  );
}
