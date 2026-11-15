import { useRef } from 'preact/hooks';
import { getMix, hasNotes, setMix } from '../../domain/patternOps';
import { SOUNDS } from '../../domain/sounds';
import { SOUND_IDS } from '../../domain/types';
import { IconSpeaker, IconSpeakerOff } from '../common/icons';
import { current, editCurrent, selectedSound } from '../state/lab';
import { useFollowPlayhead } from '../useFollowPlayhead';
import { BeatsControl, FollowChip, Ruler, TrackCells } from './Timeline';

/** Desktop multi-track grid: every sound × all bars, continuous to the right. */
export function FullGrid() {
  const p = current.value;
  const sel = selectedSound.value;
  const scroller = useRef<HTMLDivElement>(null);
  useFollowPlayhead(scroller, () => (scroller.current?.querySelector('.fg-ctrl')?.getBoundingClientRect().width ?? 0) + 12);
  return (
    <section class="fullgrid panel" aria-label="Pattern grid">
      <div class="panel-head">
        <h2 class="label">grid</h2>
        <span class="hint">click to cycle · drag to paint · right-click for velocity</span>
        <FollowChip />
        <BeatsControl />
      </div>
      <div class="fg-scroll tl" ref={scroller} data-testid="lane">
        <div class="fg-row fg-ruler-row">
          <div class="fg-ctrl fg-ctrl-spacer" aria-hidden="true" />
          <Ruler />
        </div>
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
                <TrackCells sound={s} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
