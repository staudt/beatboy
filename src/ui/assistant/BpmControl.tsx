import { useEffect, useMemo } from 'preact/hooks';
import { createHoldRepeat } from '../../input/holdRepeat';
import { PATTERN_LIMITS } from '../../domain/types';
import { IconMinus, IconPlus } from '../common/icons';
import { bpm, nudgeBpm, setBpm, tap } from '../state/groove';

/** [–]/[+] with press-and-hold auto-repeat (keyboard activation still steps once per press). */
function HoldButton({ delta, label, disabled, children }: { delta: number; label: string; disabled: boolean; children: preact.ComponentChildren }) {
  const hold = useMemo(() => createHoldRepeat(() => nudgeBpm(delta)), [delta]);
  useEffect(() => () => hold.stop(), [hold]);
  return (
    <button
      type="button"
      class="btn gv-step"
      aria-label={label}
      disabled={disabled}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        hold.start();
      }}
      onPointerUp={hold.stop}
      onPointerCancel={hold.stop}
      onLostPointerCapture={hold.stop}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => e.detail === 0 && nudgeBpm(delta)}
    >
      {children}
    </button>
  );
}

export function BpmControl() {
  const b = bpm.value;
  const commit = (el: HTMLInputElement) => {
    const v = Number(el.value);
    if (Number.isFinite(v) && v > 0) setBpm(v);
    el.value = String(bpm.peek());
  };
  return (
    <div class="gv-bpm">
      <div class="gv-bpm-row">
        <HoldButton delta={-1} label="Tempo down" disabled={b <= PATTERN_LIMITS.minBpm}>
          <IconMinus width={26} height={26} />
        </HoldButton>
        <input
          class="gv-bpm-input"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={3}
          value={b}
          aria-label="Tempo in BPM"
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => commit(e.currentTarget)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <HoldButton delta={1} label="Tempo up" disabled={b >= PATTERN_LIMITS.maxBpm}>
          <IconPlus width={26} height={26} />
        </HoldButton>
      </div>
      <span class="label gv-bpm-label">bpm</span>
      <div class="gv-slider-row">
        <input
          class="range"
          type="range"
          min={PATTERN_LIMITS.minBpm}
          max={PATTERN_LIMITS.maxBpm}
          step={1}
          value={b}
          aria-label="Tempo slider"
          onInput={(e) => setBpm(Number(e.currentTarget.value))}
        />
        <button type="button" class="btn btn-tap" aria-label="Tap tempo" onPointerDown={() => tap()} onClick={(e) => e.detail === 0 && tap()}>
          TAP
        </button>
      </div>
    </div>
  );
}
