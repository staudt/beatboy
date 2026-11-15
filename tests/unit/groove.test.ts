import { afterEach, describe, expect, it, vi } from 'vitest';
import { factoryPatterns } from '../../src/domain/factory';
import { createHoldRepeat, repeatDelay } from '../../src/input/holdRepeat';
import { DEFAULT_GROOVE_SETTINGS, buildGrooveConfig, sanitizeGrooveSettings } from '../../src/ui/state/grooveLogic';

const lib = factoryPatterns();
const ids = (kind: string) => new Set(lib.filter((p) => p.kind === kind).map((p) => p.id));

describe('hold repeat', () => {
  afterEach(() => vi.useRealTimers());

  it('delays: long first wait, then accelerating down to a floor', () => {
    expect(repeatDelay(0)).toBe(400);
    expect(repeatDelay(1)).toBeGreaterThan(repeatDelay(5));
    expect(repeatDelay(100)).toBe(40);
  });

  it('steps once on start, repeats while held, stops on stop()', () => {
    vi.useFakeTimers();
    const step = vi.fn();
    const h = createHoldRepeat(step);
    h.start();
    expect(step).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(399);
    expect(step).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(step).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(140);
    expect(step).toHaveBeenCalledTimes(3);
    h.stop();
    vi.advanceTimersByTime(5000);
    expect(step).toHaveBeenCalledTimes(3);
  });

  it('a quick tap never repeats', () => {
    vi.useFakeTimers();
    const step = vi.fn();
    const h = createHoldRepeat(step);
    h.start();
    vi.advanceTimersByTime(100);
    h.stop();
    vi.advanceTimersByTime(2000);
    expect(step).toHaveBeenCalledTimes(1);
  });
});

describe('groove settings validation', () => {
  const sanitize = (raw: unknown) => sanitizeGrooveSettings(raw, ids('groove'), ids('fill'), 'f-fill-toms');

  it('uses defaults for garbage', () => {
    expect(sanitize(undefined)).toEqual(DEFAULT_GROOVE_SETTINGS);
    expect(sanitize('x')).toEqual(DEFAULT_GROOVE_SETTINGS);
    expect(sanitize({ bpm: 'fast', countInBars: 5, click: 3 })).toEqual(DEFAULT_GROOVE_SETTINGS);
  });

  it('clamps numbers', () => {
    const s = sanitize({ bpm: 9999, beatsPerBar: 0, click: { enabled: false, volume: 4 } });
    expect(s.bpm).toBe(300);
    expect(s.beatsPerBar).toBe(1);
    expect(s.click).toEqual({ enabled: false, volume: 1 });
    expect(sanitize({ bpm: 1, beatsPerBar: 99 })).toMatchObject({ bpm: 30, beatsPerBar: 7 });
  });

  it('falls back for unknown pattern ids and keeps valid ones', () => {
    expect(sanitize({ grooveId: 'nope', fillId: 'nope' })).toMatchObject({ grooveId: null, fillId: 'f-fill-toms' });
    expect(sanitize({ grooveId: 'f-rock-8ths', fillId: 'f-fill-snare', countInBars: 2 })).toMatchObject({
      grooveId: 'f-rock-8ths',
      fillId: 'f-fill-snare',
      countInBars: 2,
    });
    // a fill id is not a valid groove id
    expect(sanitize({ grooveId: 'f-fill-toms' }).grooveId).toBeNull();
  });
});

describe('buildGrooveConfig', () => {
  it('resolves patterns from the library; click only when no groove', () => {
    const c = buildGrooveConfig({ ...DEFAULT_GROOVE_SETTINGS, grooveId: 'f-rock-8ths', beatsPerBar: 3 }, lib);
    expect(c.pattern?.id).toBe('f-rock-8ths');
    expect(c.fill?.id).toBe('f-fill-toms');
    expect(c.beatsPerBar).toBe(3);
    expect(c.countInBars).toBe(1);
    expect(buildGrooveConfig(DEFAULT_GROOVE_SETTINGS, lib).pattern).toBeNull();
  });

  it('missing or wrong-kind ids become null', () => {
    const c = buildGrooveConfig({ ...DEFAULT_GROOVE_SETTINGS, grooveId: 'gone', fillId: 'f-rock-8ths' }, lib);
    expect(c.pattern).toBeNull();
    expect(c.fill).toBeNull();
  });
});
