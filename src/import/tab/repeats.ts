import type { Bar } from './types';

/**
 * Plays out `|: :|` repeat signs and first/second endings (docs/tab-formats.md 7.7).
 * `|: A |1. B :|2. C` plays A B A C; a repeat without endings plays twice.
 */
export function expandRepeats(bars: readonly Bar[]): Bar[] {
  const out: Bar[] = [];
  const n = bars.length;
  let i = 0;
  while (i < n) {
    let e = -1;
    for (let k = i; k < n; k++) {
      if (bars[k]!.repEnd) {
        e = k;
        break;
      }
    }
    if (e < 0) {
      out.push(...bars.slice(i));
      break;
    }
    let s = i;
    for (let k = i; k <= e; k++) if (bars[k]!.repStart) s = k;
    out.push(...bars.slice(i, s));
    const region = bars.slice(s, e + 1);
    const first = region.findIndex((b) => b.ending === 1);
    out.push(...region);
    out.push(...(first >= 0 ? region.slice(0, first) : region));
    i = e + 1;
  }
  return out;
}
