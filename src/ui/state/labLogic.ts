/** Pure, DOM-free store reducers (unit-tested). */
import { duplicatePattern, setBpm } from '../../domain/patternOps';
import type { Pattern } from '../../domain/types';

export interface LibState {
  library: Pattern[];
  currentId: string;
}

export type BpmOverrides = Readonly<Record<string, number>>;

export interface EditResult extends LibState {
  /** The pattern that now holds the edit (null when fn was a no-op). */
  changed: Pattern | null;
  /** Set when a built-in was copied. */
  copiedFrom: Pattern | null;
  /** Override map after the edit (a built-in's tempo override moves onto its copy). */
  overrides: BpmOverrides;
}

export function findPattern(library: readonly Pattern[], id: string): Pattern | undefined {
  return library.find((p) => p.id === id);
}

export function effectiveBpm(p: Pattern, overrides: BpmOverrides): number {
  return overrides[p.id] ?? p.bpm;
}

/** Copy-on-write edit of the current pattern. */
export function applyEdit(
  state: LibState,
  overrides: BpmOverrides,
  fn: (p: Pattern) => Pattern,
  now: number,
): EditResult {
  const cur = findPattern(state.library, state.currentId);
  if (!cur) return { ...state, changed: null, copiedFrom: null, overrides };
  const result = fn(cur);
  if (result === cur) return { ...state, changed: null, copiedFrom: null, overrides };
  if (!cur.builtIn) {
    return {
      library: state.library.map((p) => (p.id === cur.id ? result : p)),
      currentId: cur.id,
      changed: result,
      copiedFrom: null,
      overrides,
    };
  }
  const renamed = result.name !== cur.name;
  let copy = duplicatePattern(result, now, renamed ? result.name : `My ${cur.name}`);
  const ov = overrides[cur.id];
  const nextOverrides: Record<string, number> = { ...overrides };
  if (ov !== undefined) {
    copy = setBpm(copy, ov, now);
    delete nextOverrides[cur.id];
  }
  return {
    library: [...state.library, copy],
    currentId: copy.id,
    changed: copy,
    copiedFrom: cur,
    overrides: nextOverrides,
  };
}

export interface TempoResult {
  library: Pattern[];
  overrides: BpmOverrides;
  /** Set when a user pattern was edited (needs saving). */
  changed: Pattern | null;
  bpm: number;
}

/** Tempo change: edits a user pattern, but only overrides in memory for a built-in. */
export function applyTempo(state: LibState, overrides: BpmOverrides, bpm: number, now: number): TempoResult {
  const cur = findPattern(state.library, state.currentId);
  if (!cur) return { library: state.library, overrides, changed: null, bpm };
  const next = setBpm(cur, bpm, now);
  if (cur.builtIn) {
    return {
      library: state.library,
      overrides: { ...overrides, [cur.id]: next.bpm },
      changed: null,
      bpm: next.bpm,
    };
  }
  return {
    library: state.library.map((p) => (p.id === cur.id ? next : p)),
    overrides,
    changed: next,
    bpm: next.bpm,
  };
}

/** "Beat N" with N one past the highest existing "Beat N". */
export function nextBeatName(library: readonly Pattern[]): string {
  let max = 0;
  for (const p of library) {
    const m = /^Beat (\d+)$/.exec(p.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `Beat ${max + 1}`;
}

/** Remove a user pattern; returns the new library and which pattern to show. */
export function removePattern(
  state: LibState,
  id: string,
  fallbackId: string,
): LibState | null {
  const target = findPattern(state.library, id);
  if (!target || target.builtIn) return null;
  const library = state.library.filter((p) => p.id !== id);
  if (state.currentId !== id) return { library, currentId: state.currentId };
  const nextUser = library.find((p) => !p.builtIn);
  const currentId = nextUser?.id ?? (library.some((p) => p.id === fallbackId) ? fallbackId : (library[0]?.id ?? ''));
  return { library, currentId };
}
