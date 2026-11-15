import { computed, effect, signal } from '@preact/signals';
import { engine } from '../../audio/engine';
import type { FillPhase } from '../../engine/grooveSource';
import { registerTap } from '../../input/tapTempo';
import type { Pattern } from '../../domain/types';
import { createPattern } from '../../domain/patternOps';
import {
  CLICK_ONLY_ID,
  DEFAULT_GROOVE_SETTINGS as D,
  buildGrooveConfig,
  clampBeats,
  clampBpm,
  sanitizeGrooveSettings,
  type GrooveSettings,
} from './grooveLogic';
import { getRepo, initLab, library, trackKit } from './lab';

const SETTINGS_KEY = 'groove';
const SAVE_DEBOUNCE = 300;

// ── settings ─────────────────────────────────────────────────────
export const bpm = signal<number>(D.bpm);
export const beatsPerBar = signal<number>(D.beatsPerBar);
export const countInBars = signal<0 | 1 | 2>(D.countInBars);
export const click = signal<{ enabled: boolean; volume: number }>({ ...D.click });
/** null = "Click only". */
export const grooveId = signal<string | null>(D.grooveId);
export const fillId = signal<string | null>(D.fillId);
export const crashAfterFill = signal<boolean>(D.crashAfterFill);

// ── derived ──────────────────────────────────────────────────────
export const grooves = computed(() => library.value.filter((p) => p.kind === 'groove'));
export const fills = computed(() => library.value.filter((p) => p.kind === 'fill'));
export const selectedGroove = computed<Pattern | null>(
  () => (grooveId.value ? (grooves.value.find((p) => p.id === grooveId.value) ?? null) : null),
);
export const selectedFill = computed<Pattern | null>(
  () => (fillId.value ? (fills.value.find((p) => p.id === fillId.value) ?? null) : null),
);
/** Synthetic first row of the groove picker. */
export const CLICK_ONLY: Pattern = {
  ...createPattern({ name: 'Click only', category: 'Metronome' }),
  id: CLICK_ONLY_ID,
  builtIn: true,
};
export const groovePickerList = computed<Pattern[]>(() => [CLICK_ONLY, ...grooves.value]);

// ── runtime ──────────────────────────────────────────────────────
export const playing = signal(false);
/** 0-based beat of the audible position; null when stopped. */
export const beat = signal<number | null>(null);
export const bar = signal<number | null>(null);
/** Count-in beats remaining (4,3,2,1) or null. */
export const countIn = signal<number | null>(null);
export const fillPhase = signal<FillPhase>('none');

function currentSettings(): GrooveSettings {
  return {
    bpm: bpm.peek(),
    beatsPerBar: beatsPerBar.peek(),
    countInBars: countInBars.peek(),
    click: click.peek(),
    grooveId: grooveId.peek(),
    fillId: fillId.peek(),
    crashAfterFill: crashAfterFill.peek(),
  };
}

/** Read live by the engine on every scheduling pass (peek: no subscriptions). */
export function getConfig() {
  return buildGrooveConfig(currentSettings(), library.peek());
}

export function setBpm(v: number): void {
  bpm.value = clampBpm(v);
}
export function nudgeBpm(d: number): void {
  setBpm(bpm.peek() + d);
}
export function setBeats(v: number): void {
  beatsPerBar.value = clampBeats(v);
}
export function setCountIn(v: 0 | 1 | 2): void {
  countInBars.value = v;
}
export function setClickEnabled(enabled: boolean): void {
  click.value = { ...click.peek(), enabled };
}
export function setClickVolume(volume: number): void {
  click.value = { ...click.peek(), volume: Math.min(1, Math.max(0, volume)) };
}
export function selectGroove(id: string | null): void {
  grooveId.value = id === CLICK_ONLY_ID ? null : id;
}
export function selectFill(id: string): void {
  fillId.value = id;
}

let taps: number[] = [];
export function tap(now: number = performance.now()): void {
  const r = registerTap(taps, now);
  taps = r.taps;
  if (r.bpm !== null) setBpm(r.bpm);
}

// ── transport ────────────────────────────────────────────────────
/** Call synchronously from a user gesture (unlocks the AudioContext). */
export function play(): void {
  engine.setBpm(bpm.peek());
  const started = engine.playGroove(getConfig);
  trackKit(started);
  started.catch(() => {});
}

export function stop(): void {
  engine.stop();
}

export function togglePlay(): void {
  if (engine.mode === 'groove') stop();
  else play();
}

export function fill(): void {
  if (engine.mode !== 'groove') return;
  engine.triggerFill();
  fillPhase.value = engine.fillPhase();
}

// ── rAF loop + wake lock ─────────────────────────────────────────
let rafId = 0;
function loop(): void {
  const info = engine.beatInfo();
  if (info) {
    if (beat.peek() !== info.beat) beat.value = info.beat;
    if (bar.peek() !== info.bar) bar.value = info.bar;
    if (countIn.peek() !== info.countIn) countIn.value = info.countIn;
    const ph = engine.fillPhase();
    if (fillPhase.peek() !== ph) fillPhase.value = ph;
  }
  rafId = requestAnimationFrame(loop);
}

interface WakeLockSentinelLike {
  release(): Promise<void>;
}
let lock: WakeLockSentinelLike | null = null;
async function acquireLock(): Promise<void> {
  try {
    const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<WakeLockSentinelLike> } }).wakeLock;
    if (!wl || lock || !playing.peek() || document.visibilityState !== 'visible') return;
    const l = await wl.request('screen');
    if (!playing.peek()) {
      void l.release().catch(() => {});
      return;
    }
    lock = l;
  } catch {
    /* denied or unsupported: ignore */
  }
}
function releaseLock(): void {
  const l = lock;
  lock = null;
  void l?.release().catch(() => {});
}

function sync(): void {
  const now = engine.mode === 'groove';
  if (now === playing.peek()) return;
  playing.value = now;
  cancelAnimationFrame(rafId);
  if (now) {
    rafId = requestAnimationFrame(loop);
    void acquireLock();
  } else {
    beat.value = null;
    bar.value = null;
    countIn.value = null;
    fillPhase.value = 'none';
    releaseLock();
  }
}

// ── persistence / init ───────────────────────────────────────────
let initPromise: Promise<void> | null = null;
export function initGroove(): Promise<void> {
  initPromise ??= doInit();
  return initPromise;
}

async function doInit(): Promise<void> {
  engine.subscribe(sync);
  document.addEventListener('visibilitychange', () => {
    // The browser drops the lock when the page is hidden; take it again when we come back.
    if (document.visibilityState === 'visible') {
      lock = null;
      void acquireLock();
    }
  });
  // Tempo is the groove's own: follow the BPM signal while the groove plays.
  effect(() => {
    const b = bpm.value;
    if (engine.mode === 'groove') engine.setBpm(b);
  });

  await initLab();
  const repo = getRepo();
  if (!repo) return;
  try {
    const raw = await repo.getSetting<unknown>(SETTINGS_KEY);
    const lib = library.peek();
    const s = sanitizeGrooveSettings(
      raw,
      new Set(lib.filter((p) => p.kind === 'groove').map((p) => p.id)),
      new Set(lib.filter((p) => p.kind === 'fill').map((p) => p.id)),
      lib.find((p) => p.kind === 'fill')?.id ?? null,
    );
    bpm.value = s.bpm;
    beatsPerBar.value = s.beatsPerBar;
    countInBars.value = s.countInBars;
    click.value = s.click;
    grooveId.value = s.grooveId;
    fillId.value = s.fillId;
    crashAfterFill.value = s.crashAfterFill;
  } catch (e) {
    console.warn('[beatboy] could not restore groove settings', e);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const write = () => {
    clearTimeout(timer);
    timer = undefined;
    void repo.setSetting(SETTINGS_KEY, currentSettings()).catch(() => {});
  };
  let first = true;
  effect(() => {
    // subscribe to everything persisted
    void [bpm.value, beatsPerBar.value, countInBars.value, click.value, grooveId.value, fillId.value, crashAfterFill.value];
    if (first) {
      first = false;
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(write, SAVE_DEBOUNCE);
  });
  const flush = () => timer !== undefined && write();
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
}
