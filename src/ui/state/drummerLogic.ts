import { PATTERN_LIMITS } from '../../domain/types';

export const DEFAULT_FILL_ID = 'f-fill-toms';
export const DEFAULT_GROOVE_ID = 'f-rock-8ths';

/** Settings shared by every song (the Drummer's transport). */
export interface DrummerSettings {
  bpm: number;
  countInBars: 0 | 1 | 2;
  click: { enabled: boolean; volume: number };
  crashAfterFill: boolean;
  /** Groove last picked in a section: the default for new songs. */
  lastGrooveId: string | null;
}

export const DEFAULT_DRUMMER_SETTINGS: DrummerSettings = {
  bpm: 100,
  countInBars: 1,
  click: { enabled: true, volume: 0.8 },
  crashAfterFill: true,
  lastGrooveId: null,
};

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
export const clampBpm = (v: number): number =>
  Math.min(PATTERN_LIMITS.maxBpm, Math.max(PATTERN_LIMITS.minBpm, Math.round(v)));

/**
 * Validates persisted settings (clamps numbers, falls back to defaults). Also reads the legacy `groove` settings
 * record of the old Groove mode (same field names; its `grooveId` becomes `lastGrooveId`).
 */
export function sanitizeDrummerSettings(raw: unknown, grooveIds?: ReadonlySet<string>): DrummerSettings {
  const d = DEFAULT_DRUMMER_SETTINGS;
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const click = (r.click && typeof r.click === 'object' ? r.click : {}) as Record<string, unknown>;
  const countIn = r.countInBars;
  const last = typeof r.lastGrooveId === 'string' ? r.lastGrooveId : typeof r.grooveId === 'string' ? r.grooveId : null;
  return {
    bpm: clampBpm(num(r.bpm, d.bpm)),
    countInBars: countIn === 0 || countIn === 1 || countIn === 2 ? countIn : d.countInBars,
    click: {
      enabled: typeof click.enabled === 'boolean' ? click.enabled : d.click.enabled,
      volume: Math.min(1, Math.max(0, num(click.volume, d.click.volume))),
    },
    crashAfterFill: typeof r.crashAfterFill === 'boolean' ? r.crashAfterFill : d.crashAfterFill,
    lastGrooveId: last !== null && (!grooveIds || grooveIds.has(last)) ? last : null,
  };
}
