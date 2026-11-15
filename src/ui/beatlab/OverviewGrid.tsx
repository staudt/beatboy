import { useSignalEffect } from '@preact/signals';
import { useRef } from 'preact/hooks';
import { getStep, hasNotes } from '../../domain/patternOps';
import { patternSteps } from '../../domain/time';
import { SOUNDS } from '../../domain/sounds';
import { SOUND_IDS } from '../../domain/types';
import { laneView, scrollLaneToStep } from '../laneScroll';
import { current, playheadStep, selectedSound } from '../state/lab';
import { SoundKey, soundTitle } from './SoundKey';
import { levelName } from './cellInput';

/** Compact all-track mini grid of every bar. Tap a column to scroll the lane there, a name to select it. */
export function OverviewGrid() {
  const p = current.value;
  const sel = selectedSound.value;
  const grid = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const rows = SOUND_IDS.filter((s) => hasNotes(p, s) || s === sel);
  const spb = p.stepsPerBeat;

  const place = (el: HTMLElement | null, from: number, to: number) => {
    const g = grid.current;
    if (!el || !g) return;
    const a = g.querySelector<HTMLElement>(`[data-ov-step="${from}"]`);
    const b = g.querySelector<HTMLElement>(`[data-ov-step="${to}"]`);
    if (!a || !b) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    el.style.left = `${a.offsetLeft - 1}px`;
    el.style.width = `${b.offsetLeft + b.offsetWidth - a.offsetLeft + 2}px`;
  };
  useSignalEffect(() => {
    const s = playheadStep.value;
    if (s === null) {
      if (head.current) head.current.style.display = 'none';
      return;
    }
    place(head.current, s, s);
  });
  useSignalEffect(() => {
    const v = laneView.value;
    void current.value;
    if (!v) {
      if (view.current) view.current.style.display = 'none';
      return;
    }
    place(view.current, v.s0, v.s1);
  });

  return (
    <section class="overview" aria-label="Overview of all tracks">
      <h3 class="label">overview</h3>
      <div class="ov-scroll">
        <div class="ov-grid" ref={grid}>
          {rows.map((s) => (
            <div class={`ov-row${s === sel ? ' is-selected' : ''}`} key={s}>
              <button
                type="button"
                class="ov-name"
                aria-label={`Select ${SOUNDS[s].name}`}
                aria-pressed={s === sel}
                title={soundTitle(s)}
                onClick={() => (selectedSound.value = s)}
              >
                <SoundKey sound={s} />
                {SOUNDS[s].short}
              </button>
              <div
                class="ov-cells"
                onClick={(e) => {
                  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-ov-step]');
                  if (t) scrollLaneToStep(Number(t.dataset.ovStep));
                }}
              >
                {Array.from({ length: patternSteps(p) }, (_, i) => (
                  <i
                    key={i}
                    data-ov-step={i}
                    class={`ov-cell v-${levelName(getStep(p, s, i))}${i % spb === 0 ? ' beat' : ''}`}
                  />
                ))}
              </div>
            </div>
          ))}
          <div class="ov-overlay" aria-hidden="true">
            <div class="ov-view" ref={view} style={{ display: 'none' }} />
            <div class="ov-playhead" ref={head} style={{ display: 'none' }} />
          </div>
        </div>
      </div>
    </section>
  );
}
