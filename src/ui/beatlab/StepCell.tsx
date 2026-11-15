import { useComputed } from '@preact/signals';
import { useRef } from 'preact/hooks';
import { getStep } from '../../domain/patternOps';
import { SOUNDS } from '../../domain/sounds';
import type { SoundId } from '../../domain/types';
import { current, playheadStep, velPopover } from '../state/lab';
import { toggleCell, levelName, startPaint } from './cellInput';

interface Props {
  sound: SoundId;
  /** Absolute step index within the whole pattern. */
  step: number;
  beatStart?: boolean;
}

const LONG_PRESS_MS = 450;
/** A touch that travels this far (px) is a scroll, not a tap. */
const TAP_SLOP = 8;

/** One step button. Subscribes only to its own velocity and its own playhead state. */
export function StepCell({ sound, step, beatStart }: Props) {
  const vel = useComputed(() => getStep(current.value, sound, step));
  const isPlaying = useComputed(() => playheadStep.value === step);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const long = useRef(false);
  const lastType = useRef('');
  const start = useRef({ x: 0, y: 0, scroll: 0 });
  const moved = useRef(false);

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
          const sc = e.currentTarget.closest('.lane-scroll, .fg-scroll');
          start.current = { x: e.clientX, y: e.clientY, scroll: sc?.scrollLeft ?? 0 };
          moved.current = false;
          const { clientX, clientY } = e;
          clearTimer();
          timer.current = setTimeout(() => {
            long.current = true;
            openPopover(clientX, clientY);
          }, LONG_PRESS_MS);
        }
      }}
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse') return;
        if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) >= TAP_SLOP) {
          moved.current = true;
          clearTimer();
        }
      }}
      onPointerUp={(e) => {
        const wasPressing = timer.current !== undefined;
        clearTimer();
        if (e.pointerType === 'mouse' || long.current) return;
        // Touch/pen: a tap toggles on release, but never after a drag or a scroll of the lane.
        const sc = e.currentTarget.closest('.lane-scroll, .fg-scroll');
        const scrolled = sc !== null && Math.abs(sc.scrollLeft - start.current.scroll) > 1;
        if (wasPressing && !moved.current && !scrolled) toggleCell(sound, step);
      }}
      onPointerCancel={clearTimer}
      onContextMenu={(e) => {
        e.preventDefault();
        if (lastType.current === 'mouse') openPopover(e.clientX, e.clientY);
      }}
      onClick={(e) => {
        if (e.detail > 0 && lastType.current !== '') return; // pointer input is handled on pointerdown/up
        if (long.current) {
          long.current = false;
          return;
        }
        toggleCell(sound, step);
      }}
    />
  );
}
