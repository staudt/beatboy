import type { GrooveConfig } from '../../engine/grooveSource';
import { PATTERN_LIMITS, type Pattern } from '../../domain/types';

export const DEFAULT_FILL_ID = 'f-fill-toms';
export const CLICK_ONLY_ID = '__click-only';

export interface GrooveSettings {
  bpm: number;
  beatsPerBar: number;
  countInBars: 0 | 1 | 2;
  click: { enabled: boolean; volume: number };
  /** null = click only. */
  grooveId: string | null;
  fillId: string | null;
  crashAfterFill: boolean;
}

export const DEFAULT_GROOVE_SETTINGS: GrooveSettings = {
  bpm: 100,
  beatsPerBar: 4,
  countInBars: 1,
  click: { enabled: true, volume: 0.8 },
  grooveId: null,
  fillId: DEFAULT_FILL_ID,
  crashAfterFill: true,
};

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
export const clampBpm = (v: number): number =>
  Math.min(PATTERN_LIMITS.maxBpm, Math.max(PATTERN_LIMITS.minBpm, Math.round(v)));
export const clampBeats = (v: number): number => Math.min(7, Math.max(1, Math.round(v)));

/**
 * Validates persisted settings: clamps numbers, drops unknown values, and falls back to defaults.
 * `grooveIds`/`fillIds` are the pattern ids that exist now (unknown ids fall back).
 */
export function sanitizeGrooveSettings(
  raw: unknown,
  grooveIds: ReadonlySet<string>,
  fillIds: ReadonlySet<string>,
  firstFillId: string | null = null,
): GrooveSettings {
  const d = DEFAULT_GROOVE_SETTINGS;
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const click = (r.click && typeof r.click === 'object' ? r.click : {}) as Record<string, unknown>;
  const countIn = r.countInBars;
  const fallbackFill = fillIds.has(DEFAULT_FILL_ID) ? DEFAULT_FILL_ID : firstFillId;
  return {
    bpm: clampBpm(num(r.bpm, d.bpm)),
    beatsPerBar: clampBeats(num(r.beatsPerBar, d.beatsPerBar)),
    countInBars: countIn === 0 || countIn === 1 || countIn === 2 ? countIn : d.countInBars,
    click: {
      enabled: typeof click.enabled === 'boolean' ? click.enabled : d.click.enabled,
      volume: Math.min(1, Math.max(0, num(click.volume, d.click.volume))),
    },
    grooveId: typeof r.grooveId === 'string' && grooveIds.has(r.grooveId) ? r.grooveId : null,
    fillId: typeof r.fillId === 'string' && fillIds.has(r.fillId) ? r.fillId : fallbackFill,
    crashAfterFill: typeof r.crashAfterFill === 'boolean' ? r.crashAfterFill : d.crashAfterFill,
  };
}

/** Builds the engine config from the settings and the shared pattern library. Missing ids = no pattern. */
export function buildGrooveConfig(s: GrooveSettings, library: readonly Pattern[]): GrooveConfig {
  const find = (id: string | null, kind: Pattern['kind']) =>
    id ? (library.find((p) => p.id === id && p.kind === kind) ?? null) : null;
  return {
    pattern: find(s.grooveId, 'groove'),
    beatsPerBar: clampBeats(s.beatsPerBar),
    click: { enabled: s.click.enabled, volume: s.click.volume },
    countInBars: s.countInBars,
    fill: find(s.fillId, 'fill'),
    crashAfterFill: s.crashAfterFill,
  };
}
