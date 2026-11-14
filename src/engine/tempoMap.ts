import type { TempoSegment } from './types';

/** Piecewise-linear tick <-> audio-time map. Position stays continuous across tempo changes. */
export class TempoMap {
  private segs: TempoSegment[] = [{ tick: 0, time: 0, secondsPerTick: 0.001 }];

  get segments(): readonly TempoSegment[] {
    return this.segs;
  }

  /** Seconds per tick of the last (active) segment. */
  get rate(): number {
    return this.segs[this.segs.length - 1]!.secondsPerTick;
  }

  reset(tick: number, time: number, secondsPerTick: number): void {
    this.segs = [{ tick, time, secondsPerTick }];
  }

  change(atTick: number, secondsPerTick: number): void {
    const last = this.segs[this.segs.length - 1]!;
    if (atTick === last.tick) {
      last.secondsPerTick = secondsPerTick;
      return;
    }
    this.segs.push({ tick: atTick, time: this.timeAt(atTick), secondsPerTick });
  }

  timeAt(tick: number): number {
    const s = this.segs[this.segIndexForTick(tick)]!;
    return s.time + (tick - s.tick) * s.secondsPerTick;
  }

  tickAt(time: number): number {
    const s = this.segs[this.segIndexForTime(time)]!;
    return s.tick + (time - s.time) / s.secondsPerTick;
  }

  /** Drop segments that end at or before `beforeTime`. Always keeps at least one. */
  prune(beforeTime: number): void {
    let drop = 0;
    while (drop < this.segs.length - 1 && this.segs[drop + 1]!.time <= beforeTime) drop++;
    if (drop > 0) this.segs.splice(0, drop);
  }

  private segIndexForTick(tick: number): number {
    let i = this.segs.length - 1;
    while (i > 0 && this.segs[i]!.tick > tick) i--;
    return i;
  }

  private segIndexForTime(time: number): number {
    let i = this.segs.length - 1;
    while (i > 0 && this.segs[i]!.time > time) i--;
    return i;
  }
}
