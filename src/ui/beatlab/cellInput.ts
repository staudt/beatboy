import { cycleStep, getStep, setStep, velocityLevel } from '../../domain/patternOps';
import type { SoundId } from '../../domain/types';
import { current, auditionSound, editCurrent, playing } from '../state/lab';

export function levelName(vel: number): 'off' | 'ghost' | 'normal' | 'accent' {
  return vel <= 0 ? 'off' : velocityLevel(vel);
}

/** Set one cell's velocity (0 = off); auditions the sound when stopped. */
export function setCell(sound: SoundId, step: number, vel: number): void {
  if (getStep(current.peek(), sound, step) === vel) return;
  editCurrent((p) => setStep(p, sound, step, vel));
  if (vel > 0 && !playing.peek()) auditionSound(sound, vel);
}

/** off → normal → accent → ghost → off. Returns the new velocity. */
export function cycleCell(sound: SoundId, step: number): number {
  const next = getStep(cycleStep(current.peek(), sound, step), sound, step);
  setCell(sound, step, next);
  return next;
}

// ── click-drag painting (mouse) ──────────────────────────────────
let painting: { sound: SoundId; vel: number; last: number } | null = null;

function onMove(e: PointerEvent): void {
  if (!painting) return;
  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-cell]');
  if (!el || el.dataset.sound !== painting.sound) return;
  const step = Number(el.dataset.step);
  if (step === painting.last) return;
  painting.last = step;
  setCell(painting.sound, step, painting.vel);
}

function endPaint(): void {
  painting = null;
  document.removeEventListener('pointermove', onMove);
  document.removeEventListener('pointerup', endPaint);
  document.removeEventListener('pointercancel', endPaint);
}

/** Start painting: the first cell cycles, the rest of the drag copies its new state. */
export function startPaint(sound: SoundId, step: number): void {
  const vel = cycleCell(sound, step);
  painting = { sound, vel, last: step };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', endPaint);
  document.addEventListener('pointercancel', endPaint);
}
