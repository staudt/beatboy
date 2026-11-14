import { useComputed } from '@preact/signals';
import { getMix, getStep, hasNotes } from '../../domain/patternOps';
import { SOUNDS } from '../../domain/sounds';
import { SOUND_IDS, type SoundId } from '../../domain/types';
import { auditionSound, current, playheadStep, selectedSound } from '../state/lab';

function Pad({ sound }: { sound: SoundId }) {
  const flash = useComputed(() => {
    const step = playheadStep.value;
    if (step === null) return false;
    const p = current.value;
    return !getMix(p, sound).muted && getStep(p, sound, step) > 0;
  });
  const selected = selectedSound.value === sound;
  const notes = hasNotes(current.value, sound);
  const choose = () => {
    selectedSound.value = sound;
    auditionSound(sound);
  };
  return (
    <button
      type="button"
      class={`pad${selected ? ' is-selected' : ''}${flash.value ? ' is-flash' : ''}`}
      aria-pressed={selected}
      aria-label={`${SOUNDS[sound].name} pad`}
      onPointerDown={(e) => {
        if (e.button === 0 || e.pointerType !== 'mouse') choose();
      }}
      onClick={(e) => {
        if (e.detail === 0) choose(); // keyboard activation
      }}
    >
      <span class="pad-label">{SOUNDS[sound].short}</span>
      {notes && <span class="pad-dot" aria-label="has notes" role="img" />}
    </button>
  );
}

export function PadGrid() {
  return (
    <div class="pads" role="group" aria-label="Drum pads">
      {SOUND_IDS.map((s) => (
        <Pad key={s} sound={s} />
      ))}
    </div>
  );
}
