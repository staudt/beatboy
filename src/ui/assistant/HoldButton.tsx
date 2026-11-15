import { useEffect, useMemo } from 'preact/hooks';
import { createHoldRepeat } from '../../input/holdRepeat';
import { nudgeBpm } from '../state/drummer';

/** Tempo [–]/[+] with press-and-hold auto-repeat (keyboard activation still steps once per press). */
export function HoldButton({ delta, label, disabled, children, className = 'sv-step' }: { delta: number; label: string; disabled: boolean; children: preact.ComponentChildren; className?: string }) {
  const hold = useMemo(() => createHoldRepeat(() => nudgeBpm(delta)), [delta]);
  useEffect(() => () => hold.stop(), [hold]);
  return (
    <button
      type="button"
      class={`btn ${className}`}
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
