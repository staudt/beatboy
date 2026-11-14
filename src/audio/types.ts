import type { SoundId } from '../domain/types';

/** Shape of public/kits/<id>/kit.json — a single audio sprite plus an offset map. */
export interface KitManifest {
  id: string;
  name: string;
  version: number;
  /** Sprite file name, relative to the kit.json location. */
  file: string;
  sampleRate: number;
  sounds: Partial<Record<SoundId, KitSound>>;
  credits: KitCredit[];
}

export interface KitSound {
  /** Seconds from the start of the sprite (in the source WAV, before MP3 encoding). */
  start: number;
  duration: number;
  /** Balance gain 0..1 applied to every hit of this sound. */
  gain: number;
}

export interface KitCredit {
  name: string;
  author: string;
  license: string;
  url: string;
  commit?: string;
  note?: string;
}

export interface KitIndex {
  kits: { id: string; name: string; path: string }[];
}
