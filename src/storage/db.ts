import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Pattern } from '../domain/types';

export const DB_VERSION = 1;
export const PATTERN_SCHEMA_VERSION = 3;

export type StoredPattern = Pattern & { schemaVersion: number };

export interface BeatboyDB extends DBSchema {
  patterns: {
    key: string;
    value: StoredPattern;
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
      // Ordered version steps. To add v2: bump DB_VERSION and append
      // `if (oldVersion < 2) { ...create songs / userSamples stores... }`.
      if (oldVersion < 1) {
        const patterns = db.createObjectStore('patterns', { keyPath: 'id' });
        patterns.createIndex('updatedAt', 'updatedAt');
        db.createObjectStore('settings');
      }
    },
  });
}
