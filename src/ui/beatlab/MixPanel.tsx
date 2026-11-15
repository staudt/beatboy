import { getMix, hasNotes, setMix } from '../../domain/patternOps';
import { SOUNDS } from '../../domain/sounds';
import { SOUND_IDS } from '../../domain/types';
import { IconSpeaker, IconSpeakerOff } from '../common/icons';
import { SoundKey, soundTitle } from './SoundKey';
import { current, editCurrent, selectedSound, soundNameProps } from '../state/lab';

export function MixPanel() {
  const p = current.value;
  const order = [...SOUND_IDS.filter((s) => hasNotes(p, s)), ...SOUND_IDS.filter((s) => !hasNotes(p, s))];
  return (
    <section class="mix" aria-label="Mix">
      {order.map((s) => {
        const m = getMix(p, s);
        const pct = Math.round(m.gain * 100);
        return (
          <div class={`mix-row${m.muted ? ' is-muted' : ''}${hasNotes(p, s) ? '' : ' is-empty'}`} key={s}>
            <button type="button" class="mix-name" aria-label={`Select ${SOUNDS[s].name}`} title={soundTitle(s)} {...soundNameProps(s)}>
              <SoundKey sound={s} />
              {SOUNDS[s].name}
            </button>
            <button
              type="button"
              class="btn btn-icon btn-mute"
              aria-label={`Mute ${SOUNDS[s].name}`}
              aria-pressed={m.muted}
              onClick={() => editCurrent((q) => setMix(q, s, { muted: !getMix(q, s).muted }))}
            >
              {m.muted ? <IconSpeakerOff /> : <IconSpeaker />}
            </button>
            <input
              class="range range-vol"
              type="range"
              min={0}
              max={150}
              step={5}
              value={pct}
              aria-label={`${SOUNDS[s].name} volume`}
              aria-valuetext={`${pct} percent`}
              onInput={(e) => {
                const g = Number(e.currentTarget.value) / 100;
                editCurrent((q) => setMix(q, s, { gain: g }));
              }}
            />
            <output class="mix-pct">{pct}%</output>
          </div>
        );
      })}
    </section>
  );
}
