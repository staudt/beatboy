import { signal } from '@preact/signals';
import { followPlayhead, playing } from './state/lab';

/** Steps currently visible in the mobile lane (first, last), for the overview highlight. */
export const laneView = signal<{ s0: number; s1: number } | null>(null);

let lane: HTMLElement | null = null;
export function registerLane(el: HTMLElement | null): void {
  lane = el;
  if (!el) laneView.value = null;
}

/** Scroll the lane so `step` sits ~10% from the left (used by the overview). */
export function scrollLaneToStep(step: number): void {
  if (!lane) return;
  const cell = lane.querySelector<HTMLElement>(`[data-cell][data-step="${step}"]`);
  if (!cell) return;
  const lr = lane.getBoundingClientRect();
  const cr = cell.getBoundingClientRect();
  lane.scrollLeft += cr.left - lr.left - lr.width * 0.1;
  if (playing.peek()) followPlayhead.value = false;
}
