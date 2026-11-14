import { describe, expect, it } from 'vitest';
import { findOnset, sliceRegions } from '../../src/audio/onset';
import type { KitSound } from '../../src/audio/types';
import type { SoundId } from '../../src/domain/types';

const SR = 1000;

describe('findOnset', () => {
  it('finds the first sample above threshold, either polarity', () => {
    const d = new Float32Array(100);
    d[40] = -0.5;
    d[50] = 0.9;
    expect(findOnset(d, 0, 100)).toBe(40);
    expect(findOnset(d, 41, 100)).toBe(50);
  });
  it('respects the range [from,to) and bounds', () => {
    const d = new Float32Array(100);
    d[50] = 1;
    expect(findOnset(d, 0, 50)).toBeNull();
    expect(findOnset(d, 0, 51)).toBe(50);
    expect(findOnset(d, -20, 1000)).toBe(50);
    expect(findOnset(d, 200, 300)).toBeNull();
  });
  it('ignores samples under threshold', () => {
    const d = new Float32Array(10);
    d[3] = 0.001; // -60 dB
    d[6] = 0.01; // -40 dB
    expect(findOnset(d, 0, 10)).toBe(6);
    expect(findOnset(d, 0, 10, -70)).toBe(3);
  });
});

function sprite(starts: Record<string, number>, shiftS: number, skip: string[] = []) {
  const data = new Float32Array(2 * SR);
  const sounds: Partial<Record<SoundId, KitSound>> = {};
  for (const [id, start] of Object.entries(starts)) {
    sounds[id as SoundId] = { start, duration: 0.2, gain: 1 };
    if (skip.includes(id)) continue;
    const on = Math.round((start + shiftS) * SR);
    for (let i = 0; i < 100; i++) data[on + i] = 0.8;
  }
  return { data, sounds };
}

describe('sliceRegions', () => {
  it('slices at declared start with 1 ms preroll when unshifted', () => {
    const { data, sounds } = sprite({ kick: 0.1, snare: 0.5 }, 0);
    const r = sliceRegions(data, SR, sounds);
    expect(r.kick).toEqual({ startSample: 99, length: 200 });
    expect(r.snare!.startSample).toBe(499);
  });
  it('compensates a constant encoder-delay shift', () => {
    const { data, sounds } = sprite({ kick: 0.1, snare: 0.5, crash: 1.0 }, 0.04);
    const r = sliceRegions(data, SR, sounds);
    expect(r.kick!.startSample).toBe(139);
    expect(r.snare!.startSample).toBe(539);
    expect(r.crash!.startSample).toBe(1039);
  });
  it('uses the median shift when an onset is missing', () => {
    const { data, sounds } = sprite({ kick: 0.1, snare: 0.5, crash: 1.0, ride: 1.4 }, 0.03, ['ride']);
    const r = sliceRegions(data, SR, sounds);
    expect(r.ride!.startSample).toBe(1430);
  });
  it('falls back to shift 0 when nothing is found, and clamps to data end', () => {
    const { data, sounds } = sprite({ kick: 0.1, crash2: 1.95 }, 0, ['kick', 'crash2']);
    const r = sliceRegions(data, SR, sounds);
    expect(r.kick!.startSample).toBe(100);
    expect(r.crash2!.startSample).toBe(1950);
    expect(r.crash2!.length).toBe(50);
  });
});

describe('sliceRegions pre-echo handling', () => {
  it('ignores low-level MP3 pre-echo before the transient', () => {
    const sr = 1000;
    const data = new Float32Array(1000);
    // declared start at 100; pre-echo (-40 dB re peak) from 95, transient (peak 0.9) at 100
    for (let i = 95; i < 100; i++) data[i] = 0.009;
    for (let i = 100; i < 150; i++) data[i] = 0.9;
    const r = sliceRegions(data, sr, { kick: { start: 0.1, duration: 0.2, gain: 1 } });
    expect(r.kick!.startSample).toBe(100 - 1); // onset at 100, minus 1 ms preroll
  });
});
