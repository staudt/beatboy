/** Settings shared by every song and the transport tempo (persisted; the engine follows `bpm`). */
import { computed, effect, signal } from '@preact/signals';
import { engine } from '../../audio/engine';
import { registerTap } from '../../input/tapTempo';
import {
  DEFAULT_DRUMMER_SETTINGS as D,
  clampBpm,
  sanitizeDrummerSettings,
  type DrummerSettings,
} from './drummerLogic';
import { getRepo, initLab, library } from './lab';

const SETTINGS_KEY = 'drummer';
const LEGACY_KEY = 'groove';
const SAVE_DEBOUNCE = 300;

export const bpm = signal<number>(D.bpm);
export const countInBars = signal<0 | 1 | 2>(D.countInBars);
export const click = signal<{ enabled: boolean; volume: number }>({ ...D.click });
export const crashAfterFill = signal<boolean>(D.crashAfterFill);
export const lastGrooveId = signal<string | null>(D.lastGrooveId);

export const grooves = computed(() => library.value.filter((p) => p.kind === 'groove'));
export const fills = computed(() => library.value.filter((p) => p.kind === 'fill'));

function currentSettings(): DrummerSettings {
  return {
    bpm: bpm.peek(),
    countInBars: countInBars.peek(),
    click: click.peek(),
    crashAfterFill: crashAfterFill.peek(),
    lastGrooveId: lastGrooveId.peek(),
  };
}

export function setBpm(v: number): void {
  bpm.value = clampBpm(v);
}
export function nudgeBpm(d: number): void {
  setBpm(bpm.peek() + d);
}
export function setCountIn(v: 0 | 1 | 2): void {
  countInBars.value = v;
}
export function setClickEnabled(enabled: boolean): void {
  click.value = { ...click.peek(), enabled };
}
export function toggleClick(): void {
  setClickEnabled(!click.peek().enabled);
}
export function setClickVolume(volume: number): void {
  click.value = { ...click.peek(), volume: Math.min(1, Math.max(0, volume)) };
}

let taps: number[] = [];
export function tap(now: number = performance.now()): void {
  const r = registerTap(taps, now);
  taps = r.taps;
  if (r.bpm !== null) setBpm(r.bpm);
}

// ── wake lock (held while a song plays) ──────────────────────────
interface WakeLockSentinelLike {
  release(): Promise<void>;
}
let lock: WakeLockSentinelLike | null = null;
let wanted = false;
async function acquireLock(): Promise<void> {
  try {
    const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<WakeLockSentinelLike> } }).wakeLock;
    if (!wl || lock || !wanted || document.visibilityState !== 'visible') return;
    const l = await wl.request('screen');
    if (!wanted) {
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
export function setSongWakeLock(on: boolean): void {
  wanted = on;
  if (on) void acquireLock();
  else releaseLock();
}

// ── persistence / init ───────────────────────────────────────────
let initPromise: Promise<void> | null = null;
export function initDrummer(): Promise<void> {
  initPromise ??= doInit();
  return initPromise;
}

async function doInit(): Promise<void> {
  document.addEventListener('visibilitychange', () => {
    // The browser drops the lock when the page is hidden; take it again when we come back.
    if (document.visibilityState === 'visible') {
      lock = null;
      void acquireLock();
    }
  });
  // One shared tempo for both tabs: the engine always follows the BPM signal.
  effect(() => {
    engine.setBpm(bpm.value);
  });

  await initLab();
  const repo = getRepo();
  if (!repo) return;
  try {
    // Users of the old Groove mode keep their tempo, click and count-in (legacy `groove` record).
    const raw = (await repo.getSetting<unknown>(SETTINGS_KEY)) ?? (await repo.getSetting<unknown>(LEGACY_KEY));
    const ids = new Set(library.peek().filter((p) => p.kind === 'groove').map((p) => p.id));
    const s = sanitizeDrummerSettings(raw, ids);
    bpm.value = s.bpm;
    countInBars.value = s.countInBars;
    click.value = s.click;
    crashAfterFill.value = s.crashAfterFill;
    lastGrooveId.value = s.lastGrooveId;
  } catch (e) {
    console.warn('[beatboy] could not restore drummer settings', e);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const write = () => {
    clearTimeout(timer);
    timer = undefined;
    void repo.setSetting(SETTINGS_KEY, currentSettings()).catch(() => {});
  };
  let first = true;
  effect(() => {
    void [bpm.value, countInBars.value, click.value, crashAfterFill.value, lastGrooveId.value];
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
