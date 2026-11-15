/** Delay before the nth step of a press-and-hold (n = 0 is the wait after the initial step). */
export function repeatDelay(n: number): number {
  if (n <= 0) return 400;
  return Math.max(40, 140 - (n - 1) * 10);
}

export interface HoldRepeat {
  /** Steps once immediately, then keeps stepping (accelerating) until stop(). */
  start(): void;
  stop(): void;
}

export function createHoldRepeat(step: () => void): HoldRepeat {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = (n: number) => {
    timer = setTimeout(() => {
      step();
      run(n + 1);
    }, repeatDelay(n));
  };
  return {
    start() {
      clearTimeout(timer);
      step();
      run(0);
    },
    stop() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
