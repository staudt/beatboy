import { computed, effect, signal } from '@preact/signals';
import { engine, type EngineMode } from '../../audio/engine';
import { factoryPatterns } from '../../domain/factory';
import { addBeat, duplicatePattern, createPattern, lastBeatHasNotes, removeLastBeat, rename } from '../../domain/patternOps';
import { isSongLocal, promoteToGroove } from '../../domain/songBeats';
import { patternSteps, patternTicks, stepTicks } from '../../domain/time';
import type { Pattern, SoundId } from '../../domain/types';
import { Autosaver, installLifecycleFlush, type SaveStatus } from '../../storage/autosave';
import { PatternRepo, requestPersistentStorage } from '../../storage/patternRepo';
import { usedInMessage } from './songLogic';
import { applyEdit, findPattern, nextBeatName, removePattern } from './labLogic';

export const DEFAULT_PATTERN_ID = 'f-rock-8ths';

export type LabView = 'grid' | 'text' | 'mix';
export type KitStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ToastMsg {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}
export interface ConfirmReq {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  /** Informational only: a single OK button (nothing to confirm). */
  blocked?: boolean;
}
export interface VelPopover {
  sound: SoundId;
  step: number;
  x: number;
  y: number;
}

// ── state ────────────────────────────────────────────────────────
export const library = signal<Pattern[]>([...factoryPatterns()]);
export const currentId = signal<string>(DEFAULT_PATTERN_ID);
export const current = computed<Pattern>(
  () => findPattern(library.value, currentId.value) ?? (factoryPatterns()[0] as Pattern),
);
export const selectedSound = signal<SoundId>('kick');
/** While playing, the lane/grid scrolls to keep the playhead in view. Turned off by manual scrolling. */
export const followPlayhead = signal(true);
export const labView = signal<LabView>('grid');
export const playheadStep = signal<number | null>(null);
/** True while anything is audible (editor loop or a song). */
export const playing = signal(false);
/** Mirror of engine.mode. */
export const mode = signal<EngineMode>('idle');
export const saveStatus = signal<SaveStatus>('idle');
export const saveMessage = signal<string | null>(null);
export const kitStatus = signal<KitStatus>('idle');
export const toast = signal<ToastMsg | null>(null);
export const confirmReq = signal<ConfirmReq | null>(null);
export const settingsOpen = signal(false);
/** "Save as groove" sheet for a song-local beat (null = closed). */
export const saveGrooveReq = signal<{ id: string; name: string } | null>(null);
export const velPopover = signal<VelPopover | null>(null);
export const ready = signal(false);
/** Unsaved text-editor draft; null = follow the pattern. */
export const textDraft = signal<string | null>(null);

/** Timeline shape as primitives so cells re-render only when the structure changes. */
/** Loop length in squares (steps); a partial last beat is possible. */
export const stepCount = computed(() => patternSteps(current.value));
export const stepsPerBeatSig = computed(() => current.value.stepsPerBeat);

/** Appends one empty beat. */
export function addBeatAction(): void {
  editCurrent((p) => addBeat(p));
}

/** Removes the last beat's worth of squares (min 1 step); asks first when they have notes. */
export function removeBeatAction(): void {
  const p = current.peek();
  const cur = patternSteps(p);
  const spb = p.stepsPerBeat;
  const next = Math.max(1, cur - spb);
  if (next === cur) return;
  if (!lastBeatHasNotes(p)) {
    editCurrent((q) => removeLastBeat(q));
    return;
  }
  const whole = cur % spb === 0 && next % spb === 0;
  confirmReq.value = {
    title: whole ? `Remove beat ${cur / spb}?` : next + 1 === cur ? `Remove step ${cur}?` : `Remove steps ${next + 1}-${cur}?`,
    body: 'It has notes.',
    confirmLabel: 'Remove',
    onConfirm: () => editCurrent((q) => removeLastBeat(q)),
  };
}

// ── persistence ──────────────────────────────────────────────────
let repo: PatternRepo | null = null;
/** The shared repository (null until initLab resolves, or when storage is unavailable). */
export const getRepo = (): PatternRepo | null => repo;
let saver: Autosaver<Pattern> | null = null;
let persistAsked = false;

function save(p: Pattern | null): void {
  if (p && !p.builtIn) saver?.schedule(p);
}

// ── library helpers for song-local beats (songs.ts) ──────────────
/** Adds a pattern to the library without touching the editor's selection. */
export function addLibraryPattern(p: Pattern): void {
  library.value = [...library.peek(), p];
  save(p);
}
/** Replaces a pattern (same id) in the library without touching the editor's selection. */
export function putLibraryPattern(p: Pattern): void {
  library.value = library.peek().map((x) => (x.id === p.id ? p : x));
  save(p);
}
/** Deletes user patterns (song-local garbage collection). The editor moves off a deleted pattern. */
export function dropLibraryPatterns(ids: readonly string[]): void {
  if (ids.length === 0) return;
  const gone = new Set(ids);
  library.value = library.peek().filter((p) => p.builtIn || !gone.has(p.id));
  if (gone.has(currentId.peek())) currentId.value = DEFAULT_PATTERN_ID;
  for (const id of ids) saver?.scheduleDelete(id);
}

export function requestSaveAsGroove(id: string): void {
  const p = findPattern(library.peek(), id);
  if (p && isSongLocal(p)) saveGrooveReq.value = { id, name: p.name };
}
/** Promotes a song-local beat to the groove library (sections keep pointing at it). */
export function saveAsGroove(id: string, name: string): void {
  const p = findPattern(library.peek(), id);
  if (!p || !isSongLocal(p)) return;
  const q = promoteToGroove(p, name);
  putLibraryPattern(q);
  showToast(`Saved as groove ${q.name}`);
}

// ── toast ────────────────────────────────────────────────────────
let toastSeq = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function showToast(message: string, action?: ToastMsg['action'], ms?: number): void {
  const id = ++toastSeq;
  toast.value = action ? { id, message, action } : { id, message };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (toast.peek()?.id === id) toast.value = null;
  }, ms ?? (action ? 8000 : 3200));
}
export function dismissToast(): void {
  toast.value = null;
}

// ── editing ──────────────────────────────────────────────────────
/** Set by state/link.ts: called when a built-in was copied by an edit (so the Drummer can follow). */
export const hooks: {
  onCopied?: (from: Pattern, copy: Pattern) => void;
  /** Names of the songs that use a pattern (delete protection); set by state/songs.ts. */
  songsUsing?: (patternId: string) => string[];
} = {};

/** Copy-on-write edit of the current pattern. */
export function editCurrent(fn: (p: Pattern) => Pattern, opts: { quiet?: boolean } = {}): void {
  const res = applyEdit({ library: library.peek(), currentId: currentId.peek() }, fn, Date.now());
  if (!res.changed) return;
  library.value = res.library;
  currentId.value = res.currentId;
  save(res.changed);
  if (res.copiedFrom) {
    hooks.onCopied?.(res.copiedFrom, res.changed);
    if (!opts.quiet) showToast(`Saved as ${res.changed.name}`);
  }
}

/** Raw selection (no playback side effects). */
export function selectPattern(id: string): void {
  if (!findPattern(library.peek(), id)) return;
  currentId.value = id;
  textDraft.value = null;
}

/**
 * The editor moved to a different pattern on its own initiative ("something else"): if a song is
 * playing, keep the transport running but loop the editor's new pattern instead (no click, no fills).
 */
function followEditorPattern(): void {
  if (engine.mode === 'song') void engine.playPattern(() => current.peek()).catch(() => {});
}

/** User picked a pattern in the editor. */
export function choosePattern(id: string): void {
  if (id === currentId.peek() || !findPattern(library.peek(), id)) return;
  selectPattern(id);
  followEditorPattern();
}

export function newPattern(): void {
  const p = createPattern({ name: nextBeatName(library.peek()), category: 'My beats' });
  library.value = [...library.peek(), p];
  selectPattern(p.id);
  save(p);
  followEditorPattern();
}

export function duplicateCurrent(): void {
  const cur = current.peek();
  const copy = duplicatePattern(cur, Date.now(), `${cur.name} copy`);
  library.value = [...library.peek(), copy];
  selectPattern(copy.id);
  save(copy);
  followEditorPattern();
  showToast(`Duplicated as ${copy.name}`);
}

export function renameCurrent(name: string): void {
  editCurrent((p) => rename(p, name), { quiet: true });
}

export function requestDelete(id: string): void {
  const p = findPattern(library.peek(), id);
  if (!p || p.builtIn) return;
  const usedBy = hooks.songsUsing?.(id) ?? [];
  if (usedBy.length > 0) {
    confirmReq.value = {
      title: "Can't delete this pattern",
      body: `"${p.name}" is part of a song. ${usedInMessage(usedBy)} Pick another groove there first.`,
      confirmLabel: 'OK',
      blocked: true,
      onConfirm: () => {},
    };
    return;
  }
  confirmReq.value = {
    title: 'Delete pattern?',
    body: `"${p.name}" will be removed from this device. This can't be undone.`,
    confirmLabel: 'Delete',
    onConfirm: () => {
      const next = removePattern({ library: library.peek(), currentId: currentId.peek() }, id, DEFAULT_PATTERN_ID);
      if (!next) return;
      const switched = next.currentId !== currentId.peek();
      library.value = next.library;
      if (switched) {
        selectPattern(next.currentId);
        followEditorPattern();
      }
      saver?.scheduleDelete(id);
      showToast(`Deleted ${p.name}`);
    },
  };
}

// ── audio / playback ─────────────────────────────────────────────
export function trackKit(p: Promise<void>): void {
  if (kitStatus.peek() !== 'ready') kitStatus.value = 'loading';
  p.then(
    () => {
      kitStatus.value = 'ready';
    },
    () => {
      kitStatus.value = 'error';
      showToast("Couldn't load the drum sounds.", { label: 'Retry', run: () => prepareAudio() });
    },
  );
}

/** Must be called synchronously from a user gesture. */
export function prepareAudio(): void {
  if (kitStatus.peek() === 'ready') return;
  trackKit(engine.ensureReady());
}

export function auditionSound(sound: SoundId, vel?: number): void {
  prepareAudio();
  engine.audition(sound, vel);
}

let rafId = 0;
function tickLoop(): void {
  const t = engine.currentTick();
  if (t === null) {
    if (playheadStep.peek() !== null) playheadStep.value = null;
  } else {
    const p = current.peek();
    const len = patternTicks(p);
    const m = ((t % len) + len) % len;
    const step = Math.floor(m / stepTicks(p.timeSig, p.stepsPerBeat));
    if (playheadStep.peek() !== step) playheadStep.value = step;
  }
  rafId = requestAnimationFrame(tickLoop);
}

function syncPlaying(): void {
  mode.value = engine.mode;
  const now = engine.playing;
  if (now === playing.peek()) return;
  playing.value = now;
  if (now) {
    followPlayhead.value = true;
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tickLoop);
  } else {
    cancelAnimationFrame(rafId);
    playheadStep.value = null;
  }
}

// ── init ─────────────────────────────────────────────────────────
let initPromise: Promise<void> | null = null;

export function initLab(): Promise<void> {
  initPromise ??= doInit();
  return initPromise;
}

async function doInit(): Promise<void> {
  engine.subscribe(() => {
    syncPlaying();
    if (engine.kitReady && kitStatus.peek() !== 'ready') kitStatus.value = 'ready';
  });
  try {
    repo = await PatternRepo.open();
    const user = await repo.list();
    library.value = [...factoryPatterns(), ...user.filter((p) => !p.builtIn)];
    const last = await repo.getSetting<string>('lastPatternId');
    if (last && findPattern(library.value, last)) currentId.value = last;
    const r = repo;
    saver = new Autosaver<Pattern>({
      write: (p) => r.put(p),
      remove: (id) => r.delete(id),
      onStatus: (s) => {
        saveStatus.value = s;
        if (s === 'error') saveMessage.value = "Couldn't save — your changes may be lost when you close the app.";
        else saveMessage.value = null;
        if (s === 'saved' && !persistAsked) {
          persistAsked = true;
          void requestPersistentStorage();
        }
      },
    });
    installLifecycleFlush(saver);
    effect(() => {
      const id = currentId.value;
      void r.setSetting('lastPatternId', id).catch(() => {});
    });
  } catch (e) {
    console.warn('[beatboy] storage unavailable', e);
    saveStatus.value = 'error';
    saveMessage.value = "Storage is unavailable (private mode?). Your work is kept only until you close this tab.";
  }
  ready.value = true;
}

export function retrySave(): void {
  void saver?.retry();
}
