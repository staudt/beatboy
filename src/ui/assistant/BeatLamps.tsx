import { beat, beatsPerBar, countIn, playing } from '../state/groove';

/** Big beat lamps (accent beat styled differently); the count-in shows the countdown number instead. */
export function BeatLamps() {
  const n = beatsPerBar.value;
  const ci = countIn.value;
  const cur = playing.value && ci === null ? beat.value : null;
  return (
    <div class="gv-lamps-area">
      {ci !== null ? (
        <div class="gv-countdown" role="status" aria-label={`Count-in ${ci}`} data-testid="countdown">
          {ci}
        </div>
      ) : (
        <div class="gv-lamps" aria-hidden="true">
          {Array.from({ length: n }, (_, i) => (
            <span key={i} class={`gv-lamp${i === 0 ? ' is-accent' : ''}${cur === i ? ' is-on' : ''}`} data-on={cur === i ? '1' : '0'} />
          ))}
        </div>
      )}
    </div>
  );
}
