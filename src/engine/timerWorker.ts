/// <reference lib="webworker" />
// Dedicated timer worker: immune to main-thread timer throttling in most browsers.
interface Scope {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(msg: unknown): void;
}
const scope = self as unknown as Scope;
let id: ReturnType<typeof setInterval> | null = null;

scope.onmessage = (e: MessageEvent) => {
  const d = e.data as { cmd?: string; interval?: number } | string;
  const cmd = typeof d === 'string' ? d : d.cmd;
  if (cmd === 'start') {
    if (id !== null) clearInterval(id);
    const ms = typeof d === 'object' && d.interval ? d.interval : 25;
    id = setInterval(() => scope.postMessage('tick'), ms);
  } else if (cmd === 'stop') {
    if (id !== null) clearInterval(id);
    id = null;
  }
};
