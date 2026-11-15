import { DEFAULT_MIX, SOUND_IDS } from '../domain/types';
import type { Pattern, TimeSignature } from '../domain/types';
import { TPQ, beatTicks, patternTicks, swingOffset } from '../domain/time';
import { collectLoopNotes } from './patternSource';
import type { EventSource, NoteOut } from './types';

export interface GrooveConfig {
  /** null = click only. */
  pattern: Pattern | null;
  /** Beats per bar, 1..7 (click accent, count-in, fills). */
  beatsPerBar: number;
  /** volume 0..1 becomes NoteOut.gain for clicks. */
  click: { enabled: boolean; volume: number };
  countInBars: 0 | 1 | 2;
  /** Pattern used by triggerFill; null = no fill available. */
  fill: Pattern | null;
  crashAfterFill: boolean;
}

export interface FillPlan {
  /** First tick (a beat boundary) where the fill is audible and the groove is silenced. */
  start: number;
  /** Bar boundary where the fill ends; the groove resumes here (with crash + kick if enabled). */
  end: number;
  fillId: string;
}

export type FillPhase = 'queued' | 'active' | 'none';

const BEAT = TPQ;
/** Count-in clicks are always at least this loud, even if the user's click volume is low. */
const COUNT_IN_MIN_GAIN = 0.6;
const CLICK_VEL = 100;
const CRASH_VEL = 120;
const KICK_VEL = 110;

const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * Super-metronome source: optional drum groove + click + count-in + manual fills.
 *
 * Semantics
 * - Transport ticks < 0 are the count-in: ONLY clicks, accent on each bar's first beat (count-in bars are
 *   aligned so tick 0 is a downbeat), always audible (click.enabled is ignored) at gain max(volume, 0.6).
 * - Ticks >= 0: the groove loops from tick 0 with its own length (like PatternLoopSource; it need not equal
 *   the bar). Clicks (if enabled): one per beat, 'clickAccent' on bar downbeats, never swung.
 * - Fill: see triggerFill. Fill state is held here (the fill pattern is captured at trigger time), config
 *   is read live on every collect().
 */
export class GrooveSource implements EventSource {
  private plan: FillPlan | null = null;
  private planPattern: Pattern | null = null;
  private planCrash = false;
  private readonly tmp: NoteOut[] = [];

  constructor(private readonly getConfig: () => GrooveConfig) {}

  timeSig(): TimeSignature {
    return { num: this.getConfig().beatsPerBar, den: 4 };
  }

  /** Transport tick at which playback starts so that tick 0 is the first downbeat after the count-in. */
  startTick(): number {
    const c = this.getConfig();
    return -c.countInBars * c.beatsPerBar * BEAT;
  }

  /** Current/pending fill, or null (cleared by collect() once the transport is a beat past `end`). */
  get fill(): FillPlan | null {
    return this.plan;
  }

  /** 'queued' before plan.start, 'active' within [start, end), else 'none'. */
  fillPhase(tick: number): FillPhase {
    const f = this.plan;
    if (!f || tick >= f.end) return 'none';
    return tick < f.start ? 'queued' : 'active';
  }

  reset(): void {
    this.plan = null;
    this.planPattern = null;
  }

  cancelFill(): void {
    this.reset();
  }

  /**
   * Plan a fill. `scheduledUntil` = first tick not yet handed to the sink (nothing before it can change).
   * - No fill pattern, or still in the count-in (scheduledUntil < 0) → null (nothing changes).
   * - A fill is already planned and not yet fully scheduled → the existing plan is returned unchanged.
   * - Otherwise start = first beat boundary >= scheduledUntil; if start is a bar boundary end = start + bar,
   *   else end = the next bar boundary. The fill is aligned so ITS END is `end` (fill tick f plays at
   *   end - fillLen + f) and only notes in [start, end) play (the tail of the fill). If the fill is shorter
   *   than the window the groove keeps playing before the fill's own start. The groove is silenced from
   *   max(start, end - fillLen) to end. With crashAfterFill a crash (120) + kick (110) land at `end`.
   */
  triggerFill(scheduledUntil: number): FillPlan | null {
    const c = this.getConfig();
    if (this.plan && scheduledUntil <= this.plan.end) return this.plan;
    if (!c.fill || scheduledUntil < 0) return null;
    const bar = c.beatsPerBar * BEAT;
    const start = Math.ceil(scheduledUntil / BEAT) * BEAT;
    const end = start % bar === 0 ? start + bar : (Math.floor(start / bar) + 1) * bar;
    this.plan = { start, end, fillId: c.fill.id };
    this.planPattern = c.fill;
    this.planCrash = c.crashAfterFill;
    return this.plan;
  }

  collect(from: number, to: number, out: NoteOut[]): void {
    if (to <= from) return;
    const c = this.getConfig();
    const bar = Math.max(1, c.beatsPerBar) * BEAT;

    // Count-in: clicks only.
    if (from < 0) {
      const gain = Math.max(c.click.volume, COUNT_IN_MIN_GAIN);
      const end = Math.min(to, 0);
      for (let t = Math.ceil(from / BEAT) * BEAT; t < end; t += BEAT) {
        out.push({
          tick: t,
          offsetTicks: 0,
          sound: mod(t, bar) === 0 ? 'clickAccent' : 'click',
          vel: CLICK_VEL,
          gain,
        });
      }
    }
    if (to <= 0) return;
    const lo = Math.max(from, 0);

    // Fill state: drop it once the transport is a beat past its end.
    if (this.plan && lo >= this.plan.end + BEAT) this.reset();
    const plan = this.plan;
    const fp = this.planPattern;
    const fillLen = fp ? patternTicks(fp) : 0;
    const silence = plan && fp ? { from: Math.max(plan.start, plan.end - fillLen), to: plan.end } : null;

    // Groove (minus the silenced fill region).
    const base = this.tmp;
    base.length = 0;
    if (c.pattern) collectLoopNotes(c.pattern, lo, to, base, silence);

    // Fill tail.
    if (plan && fp && fillLen > 0) {
      const beat = beatTicks(fp.timeSig);
      const swing = fp.stepsPerBeat === 3 ? 0.5 : fp.swing;
      const origin = plan.end - fillLen;
      for (const sound of SOUND_IDS) {
        const notes = fp.notes[sound];
        if (!notes || notes.length === 0) continue;
        const mix = fp.mix[sound] ?? DEFAULT_MIX;
        if (mix.muted) continue;
        for (const n of notes) {
          if (n.tick < 0 || n.tick >= fillLen) continue;
          const abs = origin + n.tick;
          if (abs < plan.start || abs >= plan.end || abs < lo || abs >= to) continue;
          base.push({ tick: abs, offsetTicks: swingOffset(n.tick, beat, swing), sound, vel: n.vel, gain: mix.gain });
        }
      }
    }

    // Crash + kick on the downbeat after the fill (merged with identical groove sounds: max velocity).
    if (plan && this.planCrash && plan.end >= lo && plan.end < to) {
      for (const [sound, vel] of [
        ['crash', CRASH_VEL],
        ['kick', KICK_VEL],
      ] as const) {
        const existing = base.find((n) => n.tick === plan.end && n.sound === sound);
        if (existing) existing.vel = Math.max(existing.vel, vel);
        else base.push({ tick: plan.end, offsetTicks: 0, sound, vel, gain: 1 });
      }
    }
    for (let i = 0; i < base.length; i++) out.push(base[i]!);
    base.length = 0;

    // Click.
    if (c.click.enabled) {
      for (let t = Math.ceil(lo / BEAT) * BEAT; t < to; t += BEAT) {
        out.push({
          tick: t,
          offsetTicks: 0,
          sound: t % bar === 0 ? 'clickAccent' : 'click',
          vel: CLICK_VEL,
          gain: c.click.volume,
        });
      }
    }
  }
}
