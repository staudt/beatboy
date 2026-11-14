import { useEffect, useRef } from 'preact/hooks';
import { getStep } from '../../domain/patternOps';
import { SOUNDS } from '../../domain/sounds';
import { VELOCITY } from '../../domain/types';
import { current, velPopover } from '../state/lab';
import { levelName, setCell } from './cellInput';

const CHOICES = [
  { label: 'Off', vel: 0 },
  { label: 'Ghost', vel: VELOCITY.ghost },
  { label: 'Normal', vel: VELOCITY.normal },
  { label: 'Accent', vel: VELOCITY.accent },
] as const;

/** Small velocity picker opened by long-press (touch) or right-click (mouse). */
export function VelocityPopover() {
  const pop = velPopover.value;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pop) return;
    const close = () => (velPopover.value = null);
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    // Defer so the long-press's own pointerup does not dismiss it.
    const t = setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [pop]);
  if (!pop) return null;
  const W = 232;
  const left = Math.max(8, Math.min(window.innerWidth - W - 8, pop.x - W / 2));
  const top = Math.max(8, Math.min(window.innerHeight - 70, pop.y - 64));
  const cur = levelName(getStep(current.value, pop.sound, pop.step));
  return (
    <div
      class="vel-popover"
      role="group"
      aria-label={`${SOUNDS[pop.sound].name} step ${pop.step + 1} velocity`}
      style={{ left: `${left}px`, top: `${top}px`, width: `${W}px` }}
      ref={ref}
    >
      {CHOICES.map((c) => (
        <button
          type="button"
          key={c.label}
          class={`btn vel-choice v-${c.label.toLowerCase()}`}
          aria-pressed={cur === c.label.toLowerCase()}
          onClick={() => {
            setCell(pop.sound, pop.step, c.vel);
            velPopover.value = null;
          }}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
