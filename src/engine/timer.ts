export interface Ticker {
  start(): void;
  stop(): void;
}

/** Periodic callback driven by a Worker's setInterval; falls back to main-thread setInterval. */
export function createTicker(intervalMs: number, onTick: () => void): Ticker {
  let worker: Worker | null = null;
  let workerFailed = false;
  let fallbackId: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const startFallback = () => {
    if (fallbackId === null) fallbackId = setInterval(onTick, intervalMs);
  };

  const ensureWorker = (): Worker | null => {
    if (worker || workerFailed) return worker;
    if (typeof Worker === 'undefined') {
      workerFailed = true;
      return null;
    }
    try {
      const w = new Worker(new URL('./timerWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = () => {
        if (running) onTick();
      };
      w.onerror = () => {
        workerFailed = true;
        w.terminate();
        worker = null;
        if (running) startFallback();
      };
      worker = w;
    } catch {
      workerFailed = true;
      worker = null;
    }
    return worker;
  };

  return {
    start() {
      if (running) return;
      running = true;
      const w = ensureWorker();
      if (w) w.postMessage({ cmd: 'start', interval: intervalMs });
      else startFallback();
    },
    stop() {
      running = false;
      if (worker) worker.postMessage({ cmd: 'stop' });
      if (fallbackId !== null) {
        clearInterval(fallbackId);
        fallbackId = null;
      }
    },
  };
}
