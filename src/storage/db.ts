import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Pattern } from '../domain/types';
import type { Song } from '../domain/song';

export const DB_VERSION = 2;
export const PATTERN_SCHEMA_VERSION = 3;

export const SONG_SCHEMA_VERSION = 1;

export type StoredSong = Song & { schemaVersion: number };
export type StoredPattern = Pattern & { schemaVersion: number };

export interface BeatboyDB extends DBSchema {
  patterns: {
    key: string;
    value: StoredPattern;
    indexes: { updatedAt: number };
  };
  songs: {
    key: string;
    value: StoredSong;
    indexes: { updatedAt: number };
  };
  settings: {
    key: string;
    value: unknown;
  };
}

export type BeatboyDb = IDBPDatabase<BeatboyDB>;

export function openBeatboyDb(name = 'beatboy'): Promise<BeatboyDb> {
  return openDB<BeatboyDB>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      // Ordered version steps; append `if (oldVersion < N) { ... }` when bumping DB_VERSION.
      if (oldVersion < 1) {
        const patterns = db.createObjectStore('patterns', { keyPath: 'id' });
        patterns.createIndex('updatedAt', 'updatedAt');
        db.createObjectStore('settings');
      }
      if (oldVersion < 2) {
        const songs = db.createObjectStore('songs', { keyPath: 'id' });
        songs.createIndex('updatedAt', 'updatedAt');
      }
    },
  });
}
