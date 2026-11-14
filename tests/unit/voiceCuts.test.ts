import { describe, expect, it } from 'vitest';
import { planVoiceCuts, type ActiveVoice } from '../../src/audio/voiceCuts';
import { velocityToGain } from '../../src/audio/velocity';

const v = (id: number, sound: ActiveVoice['sound'], startTime: number, endTime?: number): ActiveVoice => ({ id, sound, startTime, endTime });

describe('planVoiceCuts', () => {
  it('closed hat chokes ringing open hat', () => {
    expect(planVoiceCuts([v(1, 'hatOpen', 0, 2)], 'hatClosed', 1, 8)).toEqual([1]);
    expect(planVoiceCuts([v(1, 'hatOpen', 0, 2)], 'hatPedal', 1, 8)).toEqual([1]);
  });
  it('open hat chokes previous open hat', () => {
    expect(planVoiceCuts([v(1, 'hatOpen', 0, 2)], 'hatOpen', 1, 8)).toEqual([1]);
  });
  it('kick chokes nothing; closed hats are not choked', () => {
    expect(planVoiceCuts([v(1, 'hatOpen', 0, 2), v(2, 'hatClosed', 0, 1)], 'kick', 1, 8)).toEqual([]);
    expect(planVoiceCuts([v(2, 'hatClosed', 0, 1)], 'hatOpen', 0.5, 8)).toEqual([]);
  });
  it('does not choke voices starting at/after time or already ended', () => {
    expect(planVoiceCuts([v(1, 'hatOpen', 1, 2), v(2, 'hatOpen', 1.5, 2)], 'hatClosed', 1, 8)).toEqual([]);
    expect(planVoiceCuts([v(1, 'hatOpen', 0, 0.9)], 'hatClosed', 1, 8)).toEqual([]);
  });
  it('enforces the polyphony cap by cutting the oldest', () => {
    const active = [3, 1, 2].map((i) => v(i, 'snare', i));
    expect(planVoiceCuts(active, 'snare', 10, 4)).toEqual([]);
    expect(planVoiceCuts(active, 'snare', 10, 3)).toEqual([1]);
    expect(planVoiceCuts(active, 'snare', 10, 2).sort()).toEqual([1, 2]);
    expect(planVoiceCuts([...active, v(9, 'kick', 0)], 'snare', 10, 3)).toEqual([1]);
  });
  it('does not double-count a voice already choked', () => {
    const active = [v(1, 'hatOpen', 0, 5), v(2, 'hatOpen', 1, 5)];
    expect(planVoiceCuts(active, 'hatOpen', 2, 2).sort()).toEqual([1, 2]);
  });
});

describe('velocityToGain', () => {
  it('maps and clamps', () => {
    expect(velocityToGain(127)).toBe(1);
    expect(velocityToGain(500)).toBe(1);
    expect(velocityToGain(0)).toBeCloseTo((1 / 127) ** 1.6, 12);
    expect(velocityToGain(64)).toBeCloseTo((64 / 127) ** 1.6, 12);
  });
});
