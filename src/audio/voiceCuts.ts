import { chokedBy } from '../domain/sounds';
import type { SoundId } from '../domain/types';

export interface ActiveVoice {
  id: number;
  sound: SoundId;
  startTime: number;
  /** Natural end time; voices with endTime <= time count as already ended. */
  endTime?: number;
}

/**
 * Decide which active voices must be faded out when `sound` starts at `time`:
 * choke victims (started strictly before `time`, still sounding) plus the oldest
 * voices of `sound` beyond the polyphony `cap`.
 */
export function planVoiceCuts(active: readonly ActiveVoice[], sound: SoundId, time: number, cap: number): number[] {
  const cuts = new Set<number>();
  const victims = chokedBy(sound);
  const alive = (v: ActiveVoice) => v.endTime === undefined || v.endTime > time;
  for (const v of active) {
    if (victims.includes(v.sound) && v.startTime < time && alive(v)) cuts.add(v.id);
  }
  const same = active.filter((v) => v.sound === sound && alive(v) && !cuts.has(v.id));
  const excess = same.length + 1 - cap;
  if (excess > 0) {
    same.sort((a, b) => a.startTime - b.startTime || a.id - b.id);
    for (let i = 0; i < excess; i++) cuts.add(same[i]!.id);
  }
  return [...cuts];
}
