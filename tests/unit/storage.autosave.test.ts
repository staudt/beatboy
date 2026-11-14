import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Autosaver, type SaveStatus } from '../../src/storage/autosave';

type Item = { id: string; v: number };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function make(write: (i: Item) => Promise<void>, remove?: (id: string) => Promise<void>) {
  const statuses: SaveStatus[] = [];
  const saver = new Autosaver<Item>({ write, remove, delayMs: 400, onStatus: (s) => statuses.push(s) });
  return { saver, statuses };
}

describe('Autosaver', () => {
  it('coalesces 10 schedules into one write of the last value', async () => {
    const write = vi.fn(async () => {});
    const { saver } = make(write);
    for (let i = 0; i < 10; i++) saver.schedule({ id: 'a', v: i });
    expect(saver.pendingCount).toBe(1);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith({ id: 'a', v: 9 });
    expect(saver.pendingCount).toBe(0);
    expect(saver.status).toBe('saved');
  });

  it('debounce restarts on each schedule', async () => {
    const write = vi.fn(async () => {});
    const { saver } = make(write);
    saver.schedule({ id: 'a', v: 1 });
    await vi.advanceTimersByTimeAsync(300);
    saver.schedule({ id: 'a', v: 2 });
    await vi.advanceTimersByTimeAsync(300);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('handles multiple ids', async () => {
    const write = vi.fn(async (_i: Item) => {});
    const { saver } = make(write);
    saver.schedule({ id: 'a', v: 1 });
    saver.schedule({ id: 'b', v: 2 });
    saver.schedule({ id: 'a', v: 3 });
    await vi.advanceTimersByTimeAsync(400);
    expect(write.mock.calls.map((c) => c[0])).toEqual([
      { id: 'a', v: 3 },
      { id: 'b', v: 2 },
    ]);
  });

  it('flush writes immediately', async () => {
    const write = vi.fn(async () => {});
    const { saver } = make(write);
    saver.schedule({ id: 'a', v: 1 });
    await saver.flush();
    expect(write).toHaveBeenCalledTimes(1);
    expect(saver.status).toBe('saved');
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('schedule during an in-flight write triggers a second write afterwards, never concurrent', async () => {
    let release!: () => void;
    let active = 0;
    let maxActive = 0;
    const log: number[] = [];
    const write = vi.fn(async (i: Item) => {
      active++;
      maxActive = Math.max(maxActive, active);
      log.push(i.v);
      if (i.v === 1) await new Promise<void>((r) => (release = r));
      active--;
    });
    const { saver } = make(write);
    saver.schedule({ id: 'a', v: 1 });
    await vi.advanceTimersByTimeAsync(400);
    expect(write).toHaveBeenCalledTimes(1);
    saver.schedule({ id: 'a', v: 2 });
    saver.schedule({ id: 'a', v: 3 });
    await vi.advanceTimersByTimeAsync(400); // timer fires while in flight
    expect(write).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    await saver.flush();
    expect(log).toEqual([1, 3]);
    expect(maxActive).toBe(1);
    expect(saver.pendingCount).toBe(0);
    expect(saver.status).toBe('saved');
  });

  it('failure sets error and retains data; retry succeeds', async () => {
    let fail = true;
    const write = vi.fn(async () => {
      if (fail) throw new Error('quota');
    });
    const { saver, statuses } = make(write);
    saver.schedule({ id: 'a', v: 1 });
    await vi.advanceTimersByTimeAsync(400);
    expect(saver.status).toBe('error');
    expect(saver.pendingCount).toBe(1);
    fail = false;
    await saver.retry();
    expect(saver.status).toBe('saved');
    expect(saver.pendingCount).toBe(0);
    expect(write).toHaveBeenCalledTimes(2);
    expect(statuses).toEqual(['saving', 'error', 'saving', 'saved']);
  });

  it('scheduleDelete cancels the pending write and calls remove', async () => {
    const write = vi.fn(async () => {});
    const remove = vi.fn(async () => {});
    const { saver } = make(write, remove);
    saver.schedule({ id: 'a', v: 1 });
    saver.scheduleDelete('a');
    expect(saver.pendingCount).toBe(1);
    await vi.advanceTimersByTimeAsync(400);
    expect(write).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith('a');
    expect(saver.status).toBe('saved');
  });

  it('emits status sequence saving -> saved and does not repeat', async () => {
    const { saver, statuses } = make(async () => {});
    saver.schedule({ id: 'a', v: 1 });
    saver.schedule({ id: 'a', v: 2 });
    await vi.advanceTimersByTimeAsync(400);
    expect(statuses).toEqual(['saving', 'saved']);
    expect(saver.status).toBe('saved');
  });
});
