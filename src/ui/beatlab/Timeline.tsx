import { memo } from 'preact/compat';
import { PATTERN_LIMITS, type SoundId } from '../../domain/types';
import { lengthLabel } from '../../domain/time';
import { Stepper } from '../common/Stepper';
import { addBeatAction, current, followPlayhead, playing, removeBeatAction, stepCount, stepsPerBeatSig } from '../state/lab';
import { StepCell } from './StepCell';

/** `LENGTH [–] n beats [+]`: + appends one beat's worth of empty squares (4 / 3), – removes the last beat's worth (min 1 step). */
export function BeatsControl() {
  const steps = stepCount.value;
  const spb = stepsPerBeatSig.value;
  return (
    <div class="beats-ctl">
      <span class="label">length</span>
      <Stepper
        label="Beats"
        value={steps}
        min={PATTERN_LIMITS.minSteps}
        max={PATTERN_LIMITS.maxBeats * spb}
        display={lengthLabel(current.value)}
        onChange={(v) => (v > steps ? addBeatAction() : removeBeatAction())}
      />
    </div>
  );
}

/** Shown after manual scrolling while playing; turns follow-the-playhead back on. */
export function FollowChip() {
  if (!playing.value || followPlayhead.value) return null;
  return (
    <button type="button" class="chip chip-follow" onClick={() => (followPlayhead.value = true)}>
      Follow
    </button>
  );
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** Ruler above the squares: the beat number at each beat start. */
export function Ruler() {
  const steps = stepCount.value;
  const spb = stepsPerBeatSig.value;
  return (
    <div class="tl-beats tl-ruler" aria-hidden="true" style={{ '--spb': spb }}>
      {range(Math.ceil(steps / spb)).map((i) => (
        <div class="tl-beat" key={i} style={{ '--spb': Math.min(spb, steps - i * spb) }}>
          <span class="tl-beatnum">{i + 1}</span>
        </div>
      ))}
    </div>
  );
}

/** One sound's squares for the whole loop, grouped by beat. */
export const TrackCells = memo(function TrackCells({ sound }: { sound: SoundId }) {
  const steps = stepCount.value;
  const spb = stepsPerBeatSig.value;
  return (
    <div class="tl-beats" style={{ '--spb': spb }}>
      {range(Math.ceil(steps / spb)).map((i) => (
        <div class="tl-beat" key={i} style={{ '--spb': Math.min(spb, steps - i * spb) }}>
          {range(Math.min(spb, steps - i * spb)).map((j) => {
            const step = i * spb + j;
            return <StepCell key={`${sound}-${step}`} sound={sound} step={step} beatStart={j === 0} />;
          })}
        </div>
      ))}
    </div>
  );
});
