import { useSignalEffect } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';
import { followPlayhead, playheadStep } from './state/lab';

/**
 * Keeps the playhead visible in a horizontally scrolling grid. When it passes ~80% of the visible width
 * (or wraps back to the start) the scroller jumps so the playhead sits ~10% from the left. Manual
 * scrolling (wheel, touch/pointer drag on the scroller, or any scroll we did not cause) turns following
 * off; the UI offers a "Follow" chip to turn it back on.
 * `inset` is the width of a sticky left column that covers part of the scroller.
 */
export function useFollowPlayhead(ref: RefObject<HTMLElement | null>, inset: () => number = () => 0): void {
  // Last scrollLeft we set ourselves, to tell our own scrolls from the user's.
  const expected = useRef(-1);

  useSignalEffect(() => {
    const step = playheadStep.value;
    const sc = ref.current;
    if (step === null || !sc || !followPlayhead.peek()) return;
    const cell = sc.querySelector<HTMLElement>(`[data-cell][data-step="${step}"]`);
    if (!cell) return;
    const sr = sc.getBoundingClientRect();
    const cr = cell.getBoundingClientRect();
    const left = inset();
    const vis = sr.width - left;
    const x = cr.left - sr.left - left;
    if (x > vis * 0.8 || x < 0) {
      sc.scrollLeft += x - vis * 0.1;
      expected.current = sc.scrollLeft;
    }
  });

  useEffect(() => {
    const sc = ref.current;
    if (!sc) return;
    const off = () => {
      followPlayhead.value = false;
    };
    const onDown = (e: Event) => {
      if (!(e.target as HTMLElement).closest('[data-cell]')) off();
    };
    const onScroll = () => {
      if (Math.abs(sc.scrollLeft - expected.current) > 1) off();
      expected.current = sc.scrollLeft;
    };
    expected.current = sc.scrollLeft;
    sc.addEventListener('wheel', off, { passive: true });
    sc.addEventListener('pointerdown', onDown, { passive: true });
    sc.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      sc.removeEventListener('wheel', off);
      sc.removeEventListener('pointerdown', onDown);
      sc.removeEventListener('scroll', onScroll);
    };
  }, []);
}
