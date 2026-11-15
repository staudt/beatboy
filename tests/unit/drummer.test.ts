import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHoldRepeat, repeatDelay } from '../../src/input/holdRepeat';
import { DEFAULT_DRUMMER_SETTINGS, sanitizeDrummerSettings } from '../../src/ui/state/drummerLogic';

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

describe('drummer settings validation', () => {
  const grooves = new Set(['f-rock-8ths']);
  it('defaults for missing or garbage input', () => {
    expect(sanitizeDrummerSettings(undefined)).toEqual(DEFAULT_DRUMMER_SETTINGS);
    expect(sanitizeDrummerSettings('x')).toEqual(DEFAULT_DRUMMER_SETTINGS);
  });
  it('clamps numbers and drops bad values', () => {
    expect(sanitizeDrummerSettings({ bpm: 1, countInBars: 7, click: { enabled: 'x', volume: 9 } })).toMatchObject({
      bpm: 30,
      countInBars: 1,
      click: { enabled: true, volume: 1 },
    });
  });
  it('migrates the legacy Groove-mode record (tempo, click, count-in, last groove)', () => {
    const legacy = { bpm: 133, beatsPerBar: 3, countInBars: 2, click: { enabled: false, volume: 0.5 }, grooveId: 'f-rock-8ths', fillId: 'f-fill-toms', crashAfterFill: false };
    expect(sanitizeDrummerSettings(legacy, grooves)).toEqual({
      bpm: 133,
      countInBars: 2,
      click: { enabled: false, volume: 0.5 },
      crashAfterFill: false,
      lastGrooveId: 'f-rock-8ths',
    });
    expect(sanitizeDrummerSettings({ grooveId: 'gone' }, grooves).lastGrooveId).toBeNull();
  });
});
