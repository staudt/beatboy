import type { Pattern } from '../domain/types';
import { openBeatboyDb, PATTERN_SCHEMA_VERSION, type BeatboyDb, type StoredPattern } from './db';
import { migratePattern } from './migrations';

export class PatternRepo {
  private constructor(private readonly db: BeatboyDb) {}

  static async open(dbName?: string): Promise<PatternRepo> {
    return new PatternRepo(await openBeatboyDb(dbName));
  }

  close(): void {
    this.db.close();
  }

  async list(): Promise<Pattern[]> {
    const raws = await this.db.getAll('patterns');
    const out: Pattern[] = [];
    for (const raw of raws) {
      const p = migratePattern(raw);
      if (p) out.push(p);
      else console.warn('[beatboy] skipping corrupt pattern record', (raw as { id?: unknown })?.id);
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<Pattern | undefined> {
    const raw = await this.db.get('patterns', id);
    if (raw === undefined) return undefined;
    const p = migratePattern(raw);
    if (!p) console.warn('[beatboy] corrupt pattern record', id);
    return p ?? undefined;
  }

  async put(p: Pattern): Promise<void> {
    if (p.builtIn) throw new Error('Built-in patterns are read-only; save a copy instead.');
    const rec: StoredPattern = { ...p, schemaVersion: PATTERN_SCHEMA_VERSION };
    await this.db.put('patterns', rec);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete('patterns', id);
  }

  async getSetting<T>(key: string): Promise<T | undefined> {
    return (await this.db.get('settings', key)) as T | undefined;
  }

  async setSetting<T>(key: string, value: T): Promise<void> {
    await this.db.put('settings', value, key);
  }
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined') return false;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
