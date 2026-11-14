import { barPage, current, followPlayhead, playing, visibleBar } from '../state/lab';
import { IconChevron, IconChevronRight } from '../common/icons';

export function BarPager() {
  const bars = current.value.bars;
  if (bars <= 1) return null;
  const v = visibleBar.value;
  const go = (n: number) => {
    barPage.value = Math.max(0, Math.min(bars - 1, n));
    followPlayhead.value = false;
  };
  return (
    <div class="bar-pager" role="group" aria-label="Bar">
      <span class="label">bar</span>
      <button type="button" class="btn btn-icon" aria-label="Previous bar" disabled={v <= 0} onClick={() => go(v - 1)}>
        <IconChevron />
      </button>
      <output class="pager-value" aria-live="polite">
        {v + 1}/{bars}
      </output>
      <button type="button" class="btn btn-icon" aria-label="Next bar" disabled={v >= bars - 1} onClick={() => go(v + 1)}>
        <IconChevronRight />
      </button>
      <button
        type="button"
        class="btn btn-small"
        aria-pressed={followPlayhead.value}
        aria-label="Follow playhead"
        title={playing.value ? 'Follow the playhead across bars' : 'Follow the playhead when playing'}
        onClick={() => (followPlayhead.value = !followPlayhead.value)}
      >
        Follow
      </button>
    </div>
  );
}
