import type { SoundId } from './types';

export interface SoundInfo {
  id: SoundId;
  /** Short pad label (≤ 6 chars). */
  short: string;
  /** Full name. */
  name: string;
  /** Canonical notation letter (lowercase). */
  letter: string;
  /** Choke group: a new hit in the group cuts ringing open sounds of that group. */
  chokeGroup?: 'hat';
}

export const SOUNDS: Record<SoundId, SoundInfo> = {
  kick: { id: 'kick', short: 'KICK', name: 'Kick', letter: 'k' },
  snare: { id: 'snare', short: 'SNARE', name: 'Snare', letter: 's' },
  sidestick: { id: 'sidestick', short: 'STICK', name: 'Side stick', letter: 'j' },
  clap: { id: 'clap', short: 'CLAP', name: 'Clap', letter: 'l' },
  hatClosed: { id: 'hatClosed', short: 'HH CL', name: 'Hi-hat closed', letter: 'h', chokeGroup: 'hat' },
  hatPedal: { id: 'hatPedal', short: 'HH PD', name: 'Hi-hat pedal', letter: 'd', chokeGroup: 'hat' },
  hatOpen: { id: 'hatOpen', short: 'HH OP', name: 'Hi-hat open', letter: 'o', chokeGroup: 'hat' },
  ride: { id: 'ride', short: 'RIDE', name: 'Ride', letter: 'r' },
  rideBell: { id: 'rideBell', short: 'BELL', name: 'Ride bell', letter: 'e' },
  crash: { id: 'crash', short: 'CRASH', name: 'Crash', letter: 'c' },
  crash2: { id: 'crash2', short: 'CRSH2', name: 'Crash 2', letter: 'i' },
  tomHigh: { id: 'tomHigh', short: 'TOM H', name: 'High tom', letter: 't' },
  tomMid: { id: 'tomMid', short: 'TOM M', name: 'Mid tom', letter: 'm' },
  tomFloor: { id: 'tomFloor', short: 'TOM F', name: 'Floor tom', letter: 'f' },
  tambourine: { id: 'tambourine', short: 'TAMB', name: 'Tambourine', letter: 'z' },
  cowbell: { id: 'cowbell', short: 'COWBL', name: 'Cowbell', letter: 'w' },
};

/** Notation letters → sound. Aliases: `b` = kick, `x` = closed hat. */
export const LETTER_TO_SOUND: Readonly<Record<string, SoundId>> = {
  k: 'kick',
  b: 'kick',
  s: 'snare',
  j: 'sidestick',
  l: 'clap',
  h: 'hatClosed',
  x: 'hatClosed',
  d: 'hatPedal',
  o: 'hatOpen',
  r: 'ride',
  e: 'rideBell',
  c: 'crash',
  i: 'crash2',
  t: 'tomHigh',
  m: 'tomMid',
  f: 'tomFloor',
  z: 'tambourine',
  w: 'cowbell',
};

/**
 * Which sounding voices a new hit cuts off. Any hi-hat hit (closed, pedal or a new open)
 * chokes a ringing open hat, like a real hi-hat.
 */
export function chokedBy(sound: SoundId): readonly SoundId[] {
  return SOUNDS[sound].chokeGroup === 'hat' ? ['hatOpen'] : [];
}
