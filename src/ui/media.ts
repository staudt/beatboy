import { signal } from '@preact/signals';

const mq = typeof window !== 'undefined' ? window.matchMedia('(min-width: 900px)') : null;

/** True at ≥ 900 px wide (desktop two-column layout). */
export const isDesktop = signal(mq?.matches ?? false);

mq?.addEventListener('change', (e) => {
  isDesktop.value = e.matches;
});
