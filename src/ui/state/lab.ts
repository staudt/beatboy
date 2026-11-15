import { computed, effect, signal } from '@preact/signals';
import { engine } from '../../audio/engine';
import { factoryPatterns } from '../../domain/factory';
import { addBeat, duplicatePattern, createPattern, lastBeatHasNotes, removeLastBeat, rename } from '../../domain/patternOps';
import { patternTicks, stepTicks } from '../../domain/time';
import type { Pattern, SoundId } from '../../domain/types';
import { registerTap } from '../../input/tapTempo';
import { Autosaver, installLifecycleFlush, type SaveStatus } from '../../storage/autosave';
import { PatternRepo, requestPersistentStorage } from '../../storage/patternRepo';
import {
  applyEdit,
  applyTempo,
  effectiveBpm,
  findPattern,
  nextBeatName,
  removePattern,
  type BpmOverrides,
} from './labLogic';

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
export const bpmOverrides = signal<BpmOverrides>({});
export const current = computed<Pattern>(
  () => findPattern(library.value, currentId.value) ?? (factoryPatterns()[0] as Pattern),
);
/** Tempo of the current pattern (override for built-ins). */
export const bpm = computed(() => effectiveBpm(current.value, bpmOverrides.value));
export const selectedSound = signal<SoundId>('kick');
/** While playing, the lane/grid scrolls to keep the playhead in view. Turned off by manual scrolling. */
export const followPlayhead = signal(true);
export const labView = signal<LabView>('grid');
export const playheadStep = signal<number | null>(null);
export const playing = signal(false);
export const saveStatus = signal<SaveStatus>('idle');
export const saveMessage = signal<string | null>(null);
export const kitStatus = signal<KitStatus>('idle');
export const toast = signal<ToastMsg | null>(null);
export const confirmReq = signal<ConfirmReq | null>(null);
export const browserOpen = signal(false);
export const renameOpen = signal(false);
export const settingsOpen = signal(false);
export const velPopover = signal<VelPopover | null>(null);
export const ready = signal(false);
/** Unsaved text-editor draft; null = follow the pattern. */
export const textDraft = signal<string | null>(null);

/** Timeline shape as primitives so cells re-render only when the structure changes. */
export const beatCount = computed(() => current.value.timeSig.num);
export const stepsPerBeatSig = computed(() => current.value.stepsPerBeat);

/** Appends one empty beat. */
export function addBeatAction(): void {
  editCurrent((p) => addBeat(p));
}

/** Removes the last beat; asks first when that beat has notes. */
export function removeBeatAction(): void {
  const p = current.peek();
  if (p.timeSig.num <= 1) return;
  if (!lastBeatHasNotes(p)) {
    editCurrent((q) => removeLastBeat(q));
    return;
  }
  confirmReq.value = {
    title: `Remove beat ${p.timeSig.num}?`,
    body: 'It has notes.',
    confirmLabel: 'Remove',
    onConfirm: () => editCurrent((q) => removeLastBeat(q)),
  };
}

// ── persistence ──────────────────────────────────────────────────
let repo: PatternRepo | null = null;
let saver: Autosaver<Pattern> | null = null;
let persistAsked = false;

function save(p: Pattern | null): void {
  if (p && !p.builtIn) saver?.schedule(p);
}

// ── toast ────────────────────────────────────────────────────────
let toastSeq = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function showToast(message: string, action?: ToastMsg['action']): void {
  const id = ++toastSeq;
  toast.value = action ? { id, message, action } : { id, message };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (toast.peek()?.id === id) toast.value = null;
  }, action ? 8000 : 3200);
}
export function dismissToast(): void {
  toast.value = null;
}

// ── editing ──────────────────────────────────────────────────────
/** Copy-on-write edit of the current pattern. */
export function editCurrent(fn: (p: Pattern) => Pattern, opts: { quiet?: boolean } = {}): void {
  const res = applyEdit({ library: library.peek(), currentId: currentId.peek() }, bpmOverrides.peek(), fn, Date.now());
  if (!res.changed) return;
  library.value = res.library;
  currentId.value = res.currentId;
  bpmOverrides.value = res.overrides;
  save(res.changed);
  if (res.copiedFrom && !opts.quiet) showToast(`Saved as ${res.changed.name}`);
}

export function setTempo(value: number): void {
  const res = applyTempo(
    { library: library.peek(), currentId: currentId.peek() },
    bpmOverrides.peek(),
    Math.round(value),
    Date.now(),
  );
  library.value = res.library;
  bpmOverrides.value = res.overrides;
  save(res.changed);
}

let taps: number[] = [];
export function tap(now: number = performance.now()): void {
  const r = registerTap(taps, now);
  taps = r.taps;
  if (r.bpm !== null) setTempo(r.bpm);
}

export function selectPattern(id: string): void {
  if (!findPattern(library.peek(), id)) return;
  currentId.value = id;
  textDraft.value = null;
}

export function newPattern(): void {
  const p = createPattern({ name: nextBeatName(library.peek()), category: 'My beats' });
  library.value = [...library.peek(), p];
  selectPattern(p.id);
  save(p);
}

export function duplicateCurrent(): void {
  const cur = current.peek();
  const copy = duplicatePattern(
    { ...cur, bpm: effectiveBpm(cur, bpmOverrides.peek()) },
    Date.now(),
    `${cur.name} copy`,
  );
  library.value = [...library.peek(), copy];
  selectPattern(copy.id);
  save(copy);
  showToast(`Duplicated as ${copy.name}`);
}

export function renameCurrent(name: string): void {
  editCurrent((p) => rename(p, name), { quiet: true });
}

export function requestDelete(id: string): void {
  const p = findPattern(library.peek(), id);
  if (!p || p.builtIn) return;
  confirmReq.value = {
    title: 'Delete pattern?',
    body: `"${p.name}" will be removed from this device. This can't be undone.`,
    confirmLabel: 'Delete',
    onConfirm: () => {
      const next = removePattern({ library: library.peek(), currentId: currentId.peek() }, id, DEFAULT_PATTERN_ID);
      if (!next) return;
      const switched = next.currentId !== currentId.peek();
      library.value = next.library;
      if (switched) selectPattern(next.currentId);
      saver?.scheduleDelete(id);
      showToast(`Deleted ${p.name}`);
    },
  };
}

// ── audio / playback ─────────────────────────────────────────────
function trackKit(p: Promise<void>): void {
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

export function togglePlay(): void {
  if (engine.playing) {
    engine.stop();
    return;
  }
  const started = engine.playPattern(() => current.peek());
  trackKit(started);
  started.catch(() => {});
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
  // Keep the engine tempo in step with the current pattern / overrides.
  effect(() => engine.setBpm(bpm.value));

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
