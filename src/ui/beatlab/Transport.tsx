import { PATTERN_LIMITS } from '../../domain/types';
import { IconMinus, IconPlay, IconPlus, IconStop } from '../common/icons';
import { isDesktop } from '../media';
import { bpm, nudgeBpm, setBpm as setTempo, tap } from '../state/drummer';
import { current, kitStatus, playing, settingsOpen } from '../state/lab';
import { editorTogglePlay as togglePlay } from '../state/link';

export function Transport() {
  const isPlaying = playing.value;
  const b = bpm.value;
  const swing = Math.round(current.value.swing * 100);
  const kit = kitStatus.value;
  const desktop = isDesktop.value;
  // Desktop: inline between the BPM number and "+". Mobile: its own full-width row.
  const slider = (
    <input
      class="range tempo-slider"
      type="range"
      min={PATTERN_LIMITS.minBpm}
      max={PATTERN_LIMITS.maxBpm}
      step={1}
      value={b}
      aria-label="Tempo slider"
      onInput={(e) => setTempo(Number(e.currentTarget.value))}
    />
  );
  const commit = (el: HTMLInputElement) => {
    const v = Number(el.value);
    if (Number.isFinite(v) && v > 0) setTempo(v);
    el.value = String(bpm.peek());
  };
  return (
    <div class="transport" role="group" aria-label="Transport">
      <button
        type="button"
        class={`btn btn-play${isPlaying ? ' is-playing' : ''}`}
        aria-label={isPlaying ? 'Stop' : 'Play'}
        onClick={togglePlay}
      >
        {isPlaying ? <IconStop width={26} height={26} /> : <IconPlay width={26} height={26} />}
      </button>
      <div class="tempo">
        <button type="button" class="btn btn-icon" aria-label="Tempo down" disabled={b <= PATTERN_LIMITS.minBpm} onClick={() => nudgeBpm(-1)}>
          <IconMinus />
        </button>
        <label class="tempo-field">
          <input
            class="tempo-input"
            type="number"
            inputMode="numeric"
            min={PATTERN_LIMITS.minBpm}
            max={PATTERN_LIMITS.maxBpm}
            value={b}
            aria-label="Tempo in BPM"
            onChange={(e) => commit(e.currentTarget)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <span class="label">bpm</span>
        </label>
        {desktop && slider}
        <button type="button" class="btn btn-icon" aria-label="Tempo up" disabled={b >= PATTERN_LIMITS.maxBpm} onClick={() => nudgeBpm(1)}>
          <IconPlus />
        </button>
      </div>
      {!desktop && slider}
      <button type="button" class="btn btn-tap" aria-label="Tap tempo" onPointerDown={() => tap()}  onClick={(e) => e.detail === 0 && tap()}>
        TAP
      </button>
      <button
        type="button"
        class="swing-chip"
        aria-label={`Swing ${swing <= 50 ? "off" : `${swing} percent`} — edit`}
        onClick={() => (settingsOpen.value = true)}
      >
        <span class="label">swing</span>
        <span class="swing-val">{swing <= 50 ? 'off' : `${swing}%`}</span>
      </button>
      {kit === 'loading' && (
        <span class="chip chip-loading" role="status">
          Loading drums…
        </span>
      )}
    </div>
  );
}
