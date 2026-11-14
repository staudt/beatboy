export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

type TimeoutHandle = unknown;

export interface AutosaverOptions<T extends { id: string }> {
  write: (item: T) => Promise<void>;
  remove?: (id: string) => Promise<void>;
  delayMs?: number;
  onStatus?: (s: SaveStatus, err?: unknown) => void;
  setTimeoutFn?: (fn: () => void, ms: number) => TimeoutHandle;
  clearTimeoutFn?: (h: TimeoutHandle) => void;
}

type Op<T> = { kind: 'write'; item: T } | { kind: 'delete' };

/**
 * Debounced, coalescing write queue. One pending op per id (latest wins);
 * a single drain loop serializes all writes so an id never has two in flight.
 * Failed ops stay pending (unless superseded by a newer schedule).
 */
export class Autosaver<T extends { id: string }> {
  private readonly pending = new Map<string, Op<T>>();
  private readonly delayMs: number;
  private readonly setT: (fn: () => void, ms: number) => TimeoutHandle;
  private readonly clearT: (h: TimeoutHandle) => void;
  private timer: TimeoutHandle | undefined;
  private draining: Promise<void> | null = null;
  private _status: SaveStatus = 'idle';
  private failed = false;

  constructor(private readonly opts: AutosaverOptions<T>) {
    this.delayMs = opts.delayMs ?? 400;
    this.setT = opts.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearT = opts.clearTimeoutFn ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  get status(): SaveStatus {
    return this._status;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  schedule(item: T): void {
    this.pending.set(item.id, { kind: 'write', item });
    this.arm();
  }

  scheduleDelete(id: string): void {
    this.pending.set(id, { kind: 'delete' });
    this.arm();
  }

  async flush(): Promise<void> {
    this.disarm();
    await this.drain();
  }

  async retry(): Promise<void> {
    await this.flush();
  }

  private setStatus(s: SaveStatus, err?: unknown): void {
    if (s === this._status && s !== 'error') return;
    this._status = s;
    this.opts.onStatus?.(s, err);
  }

  private arm(): void {
    this.setStatus('saving');
    this.disarm();
    this.timer = this.setT(() => {
      this.timer = undefined;
      void this.drain();
    }, this.delayMs);
  }

  private disarm(): void {
    if (this.timer !== undefined) {
      this.clearT(this.timer);
      this.timer = undefined;
    }
  }

  private drain(): Promise<void> {
    if (this.draining) {
      // The running loop re-checks pending, but an op queued after its last check
      // (just before it settles) would be missed — so chain another drain after it.
      return this.draining.then(() => (this.pending.size > 0 && !this.failed ? this.drain() : undefined));
    }
    if (this.pending.size === 0) return Promise.resolve();
    this.draining = this.run().finally(() => {
      this.draining = null;
    });
    return this.draining;
  }

  private async run(): Promise<void> {
    this.failed = false;
    this.setStatus('saving');
    const attempted = new Set<string>();
    for (;;) {
      const next = [...this.pending.entries()].find(([id]) => !attempted.has(id));
      if (!next) break;
      const [id, op] = next;
      attempted.add(id);
      try {
        if (op.kind === 'write') await this.opts.write(op.item);
        else await this.opts.remove?.(id);
        // Only clear if not superseded while in flight.
        if (this.pending.get(id) === op) this.pending.delete(id);
        else attempted.delete(id); // newer version arrived: write it too
      } catch (err) {
        this.failed = true;
        this.setStatus('error', err);
      }
    }
    if (this.failed) {
      // keep 'error'; but a timer-armed newer schedule may still be pending
      return;
    }
    if (this.pending.size > 0) {
      // Shouldn't happen (loop drains all), defensive.
      return;
    }
    this.setStatus('saved');
  }
}

export function installLifecycleFlush(saver: { flush(): Promise<void> }): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => {};
  const onVis = () => {
    if (document.visibilityState === 'hidden') void saver.flush();
  };
  const onHide = () => {
    void saver.flush();
  };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('pagehide', onHide);
  return () => {
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('pagehide', onHide);
  };
}
