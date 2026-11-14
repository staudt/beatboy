import { useComputed } from '@preact/signals';
import { useRef } from 'preact/hooks';
import { getStep } from '../../domain/patternOps';
import { SOUNDS } from '../../domain/sounds';
import type { SoundId } from '../../domain/types';
import { current, playheadStep, velPopover } from '../state/lab';
import { cycleCell, levelName, startPaint } from './cellInput';

interface Props {
  sound: SoundId;
  /** Absolute step index within the whole pattern. */
  step: number;
  beatStart?: boolean;
}

const LONG_PRESS_MS = 450;

/** One step button. Subscribes only to its own velocity and its own playhead state. */
export function StepCell({ sound, step, beatStart }: Props) {
  const vel = useComputed(() => getStep(current.value, sound, step));
  const isPlaying = useComputed(() => playheadStep.value === step);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const long = useRef(false);
  const lastType = useRef('');
  const start = useRef({ x: 0, y: 0 });

  const level = levelName(vel.value);
  const clearTimer = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  const openPopover = (x: number, y: number) => {
    velPopover.value = { sound, step, x, y };
  };

  return (
    <button
      type="button"
      class={`cell v-${level}${isPlaying.value ? ' is-playing' : ''}${beatStart ? ' beat' : ''}`}
      aria-pressed={level !== 'off'}
      aria-label={`${SOUNDS[sound].name} step ${step + 1}, ${level}`}
      data-cell=""
      data-sound={sound}
      data-step={step}
      onPointerDown={(e) => {
        lastType.current = e.pointerType;
        long.current = false;
        if (e.pointerType === 'mouse') {
          if (e.button !== 0) return;
          e.preventDefault();
          startPaint(sound, step);
        } else {
          start.current = { x: e.clientX, y: e.clientY };
          const { clientX, clientY } = e;
          clearTimer();
          timer.current = setTimeout(() => {
            long.current = true;
            openPopover(clientX, clientY);
          }, LONG_PRESS_MS);
        }
      }}
      onPointerMove={(e) => {
        if (timer.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) clearTimer();
      }}
      onPointerUp={clearTimer}
      onPointerCancel={clearTimer}
      onContextMenu={(e) => {
        e.preventDefault();
        if (lastType.current === 'mouse') openPopover(e.clientX, e.clientY);
      }}
      onClick={(e) => {
        if (lastType.current === 'mouse' && e.detail > 0) return; // handled on pointerdown
        if (long.current) {
          long.current = false;
          return;
        }
        cycleCell(sound, step);
      }}
    />
  );
}
