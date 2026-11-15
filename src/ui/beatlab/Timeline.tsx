import { memo } from 'preact/compat';
import { PATTERN_LIMITS, type SoundId } from '../../domain/types';
import { Stepper } from '../common/Stepper';
import { addBeatAction, beatCount, followPlayhead, playing, removeBeatAction, stepsPerBeatSig } from '../state/lab';
import { StepCell } from './StepCell';

/** `BEATS [–] n [+]`: + appends an empty beat, – removes the last beat. */
export function BeatsControl() {
  const beats = beatCount.value;
  return (
    <div class="beats-ctl">
      <span class="label">beats</span>
      <Stepper
        label="Beats"
        value={beats}
        min={PATTERN_LIMITS.minBeats}
        max={PATTERN_LIMITS.maxBeats}
        onChange={(v) => (v > beats ? addBeatAction() : removeBeatAction())}
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
  const beats = beatCount.value;
  const spb = stepsPerBeatSig.value;
  return (
    <div class="tl-beats tl-ruler" aria-hidden="true" style={{ '--spb': spb }}>
      {range(beats).map((i) => (
        <div class="tl-beat" key={i}>
          <span class="tl-beatnum">{i + 1}</span>
        </div>
      ))}
    </div>
  );
}

/** One sound's squares for the whole loop, grouped by beat. */
export const TrackCells = memo(function TrackCells({ sound }: { sound: SoundId }) {
  const beats = beatCount.value;
  const spb = stepsPerBeatSig.value;
  return (
    <div class="tl-beats" style={{ '--spb': spb }}>
      {range(beats).map((i) => (
        <div class="tl-beat" key={i}>
          {range(spb).map((j) => {
            const step = i * spb + j;
            return <StepCell key={`${sound}-${step}`} sound={sound} step={step} beatStart={j === 0} />;
          })}
        </div>
      ))}
    </div>
  );
});
