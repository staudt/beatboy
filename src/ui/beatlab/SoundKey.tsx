import type { SoundId } from '../../domain/types';
import { SOUNDS } from '../../domain/sounds';

/** Key-cap badge showing the sound's notation letter, so the text syntax is learned from the buttons. */
export function SoundKey({ sound }: { sound: SoundId }) {
  return (
    <kbd class="sound-key" aria-hidden="true" data-testid="sound-key" data-letter={SOUNDS[sound].letter}>
      {SOUNDS[sound].letter}
    </kbd>
  );
}

export const soundTitle = (sound: SoundId) => `${SOUNDS[sound].name} \u2014 type ${SOUNDS[sound].letter}`;
