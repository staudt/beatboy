import type { Pattern } from '../../src/domain/types';

export function mkPattern(over: Partial<Pattern> = {}): Pattern {
  return {
    id: 't',
    name: 't',
    category: 't',
    kind: 'groove',
    timeSig: { num: 4, den: 4 },
    bars: 1,
    stepsPerBeat: 4,
    swing: 0.5,
    bpm: 100,
    notes: {},
    mix: {},
    builtIn: false,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}
