import { getMix, hasNotes, setMix } from '../../domain/patternOps';
import { SOUNDS } from '../../domain/sounds';
import { SOUND_IDS } from '../../domain/types';
import { IconSpeaker, IconSpeakerOff } from '../common/icons';
import { current, editCurrent, selectedSound, stepsInBar, visibleBar } from '../state/lab';
import { BarPager } from './BarPager';
import { StepCell } from './StepCell';

/** Desktop multi-track grid: every sound × the steps of the visible bar. */
export function FullGrid() {
  const p = current.value;
  const perBar = stepsInBar.value;
  const group = p.stepsPerBeat; // visually separate beats
  const base = visibleBar.value * perBar;
  const sel = selectedSound.value;
  return (
    <section class="fullgrid panel" aria-label="Pattern grid">
      <div class="panel-head">
        <h2 class="label">grid</h2>
        <span class="hint">click to cycle · drag to paint · right-click for velocity</span>
        <BarPager />
      </div>
      <div class="fg-scroll">
        {SOUND_IDS.map((s) => {
          const mix = getMix(p, s);
          return (
            <div class={`fg-row${s === sel ? ' is-selected' : ''}${mix.muted ? ' is-muted' : ''}${hasNotes(p, s) ? ' has-notes' : ''}`} key={s}>
              <div class="fg-ctrl">
              <button type="button" class="fg-name" aria-label={`Select ${SOUNDS[s].name}`} aria-pressed={s === sel} onClick={() => (selectedSound.value = s)}>
                {SOUNDS[s].short}
              </button>
              <button
                type="button"
                class="btn btn-icon btn-mute"
                aria-label={`Mute ${SOUNDS[s].name}`}
                aria-pressed={mix.muted}
                onClick={() => editCurrent((q) => setMix(q, s, { muted: !getMix(q, s).muted }))}
              >
                {mix.muted ? <IconSpeakerOff width={16} height={16} /> : <IconSpeaker width={16} height={16} />}
              </button>
              <input
                class="range range-vol"
                type="range"
                min={0}
                max={150}
                step={5}
                value={Math.round(mix.gain * 100)}
                aria-label={`${SOUNDS[s].name} volume`}
                aria-valuetext={`${Math.round(mix.gain * 100)} percent`}
                onInput={(e) => {
                  const g = Number(e.currentTarget.value) / 100;
                  editCurrent((q) => setMix(q, s, { gain: g }));
                }}
              />
              </div>
              <div class="fg-cells">
                {Array.from({ length: perBar }, (_, i) => (
                  <StepCell key={`${s}-${base + i}`} sound={s} step={base + i} beatStart={i > 0 && i % group === 0} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
