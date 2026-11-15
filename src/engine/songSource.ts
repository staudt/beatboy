import type { Pattern, TimeSignature } from '../domain/types';
import { patternTicks } from '../domain/time';
import type { Section, Song, SongAction } from '../domain/song';
import {
  BEAT,
  CRASH_VEL,
  KICK_VEL,
  addHit,
  collectClicks,
  collectCountIn,
  collectFillTail,
} from './drumParts';
import { collectLoopNotes } from './patternSource';
import type { EventSource, NoteOut } from './types';

export interface SongConfig {
  /** Read live on every collect: edits while playing apply from the next planned bar. */
  song: Song;
  /** Library lookup; a missing pattern means silence for that section (never throws). */
  getPattern: (id: string) => Pattern | null;
  click: { enabled: boolean; volume: number };
  countInBars: 0 | 1 | 2;
  crashAfterFill: boolean;
}

export interface SongInfo {
  sectionIndex: number;
  barInSection: number;
  sectionBars: number;
  /** Absolute bar index (0 = first bar after the count-in, negative in the count-in). */
  bar: number;
  /** 0-based beat in the bar (= one pass of the section's groove). */
  beat: number;
  /** Beats in the current bar (the section's groove length). */
  beatsPerBar: number;
  /** Beats remaining in the count-in, else null. */
  countIn: number | null;
  /** Where the arrangement goes after this section (null = the song ends). */
  nextSectionIndex: number | null;
  /** Pending section change (null = none). sectionIndex null = the final hit. */
  queued: { kind: 'next' | 'prev' | 'jump'; sectionIndex: number | null } | null;
  /** Runtime loop flag of the current section. */
  loop: boolean;
  phase: 'normal' | 'fill' | 'break' | 'final';
  breakQueued: boolean;
  fillQueued: boolean;
}

/**
 * Bar-by-bar performer.
 *
 * - Tick 0 is the first downbeat of the song; ticks < 0 are the count-in (clicks only, accented downbeats,
 *   always audible at gain max(volume, 0.6)).
 * - The performer owns a cursor (the section/bar of the NEXT bar to plan) and decides a `BarPlan` for each
 *   bar the first time a window reaches the bar's first tick (just in time, `planUpTo`). A planned bar is
 *   never re-planned; plans are kept in a short history for `infoAt` and for emission.
 * - Plan decisions (in order): apply a queued section change (NEXT/PREV/jump) whose applyTick <= bar start;
 *   otherwise advance the arrangement (end of section: loop flag -> restart the section, else next section,
 *   after the last one the FINAL bar: crash + kick at its downbeat, `ended` = that tick, nothing afterwards).
 *   Then: queued BREAK (stab bar), transition fill (last bar of a section that is followed by a different
 *   pass/section or the final hit, if section.fill.enabled), and the "hit at start" (crash + kick) that
 *   follows a break or a crashAfterFill fill.
 * - Live actions (`act`) never touch planned bars: they are applied at the first unplanned bar boundary
 *   (cursor.nextStart, always >= scheduledUntil) or, for manual fills, as an overlay on not-yet-scheduled ticks.
 * - A bar is one pass of the section's groove (its length varies per section; missing pattern = 4 beats), so
 *   the time signature comes from the grooves. Groove phase = tick - bar start.
 *   Section/pattern/fill ids are resolved against the live song at collect time; the arrangement (section,
 *   bar counts, order) is re-resolved by section id at every bar plan, so edits never crash.
 */

interface FillSpan {
  start: number;
  end: number;
  patternId: string;
  /** Crash + kick on `end` (manual fills only; transition fills use BarPlan.nextHit). */
  crash: boolean;
  origin: 'manual' | 'next';
}

interface Via {
  kind: 'next' | 'prev' | 'jump';
  sectionIndex: number | null;
}

interface BarPlan {
  n: number;
  start: number;
  end: number;
  sectionIndex: number;
  sectionId: string | null;
  barInSection: number;
  sectionBars: number;
  sectionStart: number;
  loop: boolean;
  final: boolean;
  /** Final bar of a song without sections: only the end marker, no hit. */
  silentEnd: boolean;
  brk: boolean;
  /** Transition fill inside this bar. */
  fill: { patternId: string } | null;
  /** Crash + kick on this bar's downbeat. */
  hitAtStart: boolean;
  /** Next bar gets the resumption hit. */
  nextHit: boolean;
  via: Via | null;
}

interface Queued extends Via {
  applyTick: number;
  targetId: string | null;
  targetIndex: number | null;
}

const HISTORY = 48;

export class SongSource implements EventSource {
  private plans: BarPlan[] = [];
  private nextStart = 0;
  private barCount = 0;
  private entered = false;
  private curId: string | null = null;
  private curIndex = 0;
  private curBarInSection = 0;
  private curSectionStart = 0;
  private curLoop = false;
  private queue: Queued | null = null;
  private breakQ: { applyTick: number } | null = null;
  private overlay: FillSpan | null = null;
  private _ended: number | null = null;
  private readonly tmp: NoteOut[] = [];
  private readonly startSection: number;

  constructor(
    private readonly getConfig: () => SongConfig,
    opts: { startSection?: number } = {},
  ) {
    this.startSection = Math.max(0, Math.floor(opts.startSection ?? 0));
  }

  /** Tick where the song's final hit lands (null while running). */
  get ended(): number | null {
    return this._ended;
  }

  /**
   * Num = beats of the current section's groove; den stays 4 so the tempo pulse is always the quarter note
   * (simple meter: secondsPerTick never depends on num) and sections of different lengths never change tempo.
   */
  timeSig(): TimeSignature {
    const cfg = this.getConfig();
    const last = this.plans[this.plans.length - 1];
    const sec = (last && cfg.song.sections.find((s) => s.id === last.sectionId)) ?? this.startSec(cfg);
    return { num: Math.min(32, Math.max(1, Math.round(this.barLenFor(cfg, sec) / BEAT))), den: 4 };
  }

  startTick(): number {
    const cfg = this.getConfig();
    return -cfg.countInBars * this.barLenFor(cfg, this.startSec(cfg));
  }

  reset(): void {
    this.plans = [];
    this.nextStart = 0;
    this.barCount = 0;
    this.entered = false;
    this.curId = null;
    this.curIndex = 0;
    this.curBarInSection = 0;
    this.curSectionStart = 0;
    this.curLoop = false;
    this.queue = null;
    this.breakQ = null;
    this.overlay = null;
    this._ended = null;
  }

  private startSec(cfg: SongConfig): Section | undefined {
    const secs = cfg.song.sections;
    return secs.length ? secs[Math.min(this.startSection, secs.length - 1)] : undefined;
  }

  /** A bar is one pass of the section's groove; a missing/empty pattern keeps time as 4 beats. */
  private barLenFor(cfg: SongConfig, sec: Section | undefined): number {
    const pat = sec ? cfg.getPattern(sec.patternId) : null;
    const len = pat ? patternTicks(pat) : 0;
    return len > 0 ? len : 4 * BEAT;
  }

  // ───────────────────────── planning ─────────────────────────

  private planUpTo(limit: number): void {
    while (this._ended === null && this.nextStart < limit) this.planBar();
  }

  private planBar(): void {
    const cfg = this.getConfig();
    const secs = cfg.song.sections;
    const t = this.nextStart;
    const prev = this.plans[this.plans.length - 1] ?? null;

    // 1. Which section does this bar belong to?
    let enter: number | null | undefined; // undefined = stay in the current pass
    let reinitLoop = true;
    let via: Via | null = null;
    const q = this.queue;
    if (q && q.applyTick <= t) {
      this.queue = null;
      let idx: number | null = null;
      if (q.targetId !== null) {
        const found = secs.findIndex((s) => s.id === q.targetId);
        idx = found >= 0 ? found : Math.min(Math.max(0, q.targetIndex ?? 0), secs.length - 1);
      }
      enter = secs.length === 0 ? null : idx;
      via = { kind: q.kind, sectionIndex: enter };
    } else if (!this.entered) {
      enter = secs.length === 0 ? null : Math.min(this.startSection, secs.length - 1);
    } else {
      const idx = secs.findIndex((s) => s.id === this.curId);
      if (idx < 0) {
        // Current section was deleted: continue with whatever sits at the same index, or end.
        enter = this.curIndex < secs.length ? this.curIndex : null;
      } else if (this.curBarInSection >= Math.max(1, secs[idx]!.bars)) {
        if (this.curLoop) {
          enter = idx;
          reinitLoop = false;
        } else enter = idx + 1 < secs.length ? idx + 1 : null;
      } else {
        this.curIndex = idx;
      }
    }

    if (enter === null) {
      const barLen = prev ? prev.end - prev.start : 4 * BEAT;
      const plan: BarPlan = {
        n: this.barCount++,
        start: t,
        end: t + barLen,
        sectionIndex: Math.max(0, secs.length - 1),
        sectionId: secs.length ? secs[secs.length - 1]!.id : null,
        barInSection: prev ? prev.barInSection : 0,
        sectionBars: prev ? prev.sectionBars : 0,
        sectionStart: prev ? prev.sectionStart : t,
        loop: false,
        final: true,
        silentEnd: secs.length === 0,
        brk: false,
        fill: null,
        hitAtStart: false,
        nextHit: false,
        via,
      };
      this._ended = t;
      this.queue = null;
      this.breakQ = null;
      this.record(plan);
      this.nextStart = t + barLen;
      return;
    }
    if (enter !== undefined) {
      const sec = secs[enter]!;
      this.entered = true;
      this.curId = sec.id;
      this.curIndex = enter;
      this.curBarInSection = 0;
      this.curSectionStart = t;
      if (reinitLoop) this.curLoop = sec.loop;
    }
    const idx = this.curIndex;
    const sec = secs[idx]!;
    const bars = Math.max(1, sec.bars);
    const barLen = this.barLenFor(cfg, sec);

    // 2. Break / transition fill / hit at start.
    let brk = false;
    if (this.breakQ && this.breakQ.applyTick <= t) {
      brk = true;
      this.breakQ = null;
    }
    const lastBar = this.curBarInSection >= bars - 1;
    let fill: BarPlan['fill'] = null;
    if (!brk && lastBar && !this.curLoop && sec.fill.enabled && !(this.overlay && this.overlay.end > t)) {
      const id = sec.fill.patternId ?? cfg.song.fillId;
      if (id !== null && cfg.getPattern(id)) fill = { patternId: id };
    }
    const ov = this.overlay;
    const hitAtStart = brk || (prev?.nextHit ?? false) || (!!ov && ov.crash && ov.end === t);
    const plan: BarPlan = {
      n: this.barCount++,
      start: t,
      end: t + barLen,
      sectionIndex: idx,
      sectionId: sec.id,
      barInSection: this.curBarInSection,
      sectionBars: bars,
      sectionStart: this.curSectionStart,
      loop: this.curLoop,
      final: false,
      silentEnd: false,
      brk,
      fill,
      hitAtStart,
      nextHit: brk || (fill !== null && cfg.crashAfterFill),
      via,
    };
    this.curBarInSection++;
    this.nextStart = t + barLen;
    this.record(plan);
  }

  private record(plan: BarPlan): void {
    this.plans.push(plan);
    if (this.plans.length > HISTORY) this.plans.splice(0, this.plans.length - HISTORY);
  }

  // ───────────────────────── live actions ─────────────────────────

  /** Section of the most recently planned bar (what the player is "in"), as an index into the live song. */
  private baseIndex(secs: Section[]): number {
    const last = this.plans[this.plans.length - 1];
    if (last && !last.final) {
      const i = secs.findIndex((s) => s.id === last.sectionId);
      return i >= 0 ? i : Math.min(last.sectionIndex, secs.length - 1);
    }
    return Math.min(this.entered ? this.curIndex : this.startSection, secs.length - 1);
  }

  private fillPatternFor(cfg: SongConfig, sec: Section): string | null {
    const id = sec.fill.patternId ?? cfg.song.fillId;
    return id !== null && cfg.getPattern(id) ? id : null;
  }

  /** A manual or transition fill is queued/playing at `sU` (nothing new may overlap it). */
  private fillBusy(sU: number): boolean {
    if (this.overlay && sU <= this.overlay.end) return true;
    const last = this.plans[this.plans.length - 1];
    return !!last && last.fill !== null && sU <= last.end;
  }

  private dropQueue(sU: number): void {
    this.queue = null;
    // A fill that came with the cancelled change is dropped if it has not started.
    if (this.overlay && this.overlay.origin === 'next' && this.overlay.start >= sU) this.overlay = null;
  }

  /**
   * Queue a live action; `scheduledUntil` is the scheduler's first unscheduled tick. NEXT/PREV/jump/BREAK
   * apply at the first bar boundary that has not been planned yet; FILL starts at the next beat boundary.
   */
  act(action: SongAction, scheduledUntil: number): void {
    if (this._ended !== null) return;
    this.planUpTo(scheduledUntil); // everything starting before sU is planned: nextStart >= sU
    if (this._ended !== null) return;
    const cfg = this.getConfig();
    const secs = cfg.song.sections;
    const B = this.nextStart;
    const sU = scheduledUntil;

    switch (action.type) {
      case 'toggleLoop': {
        if (secs.length === 0) return;
        if (!this.entered) {
          // Count-in: pre-enter the start section's flag lazily.
          const i = Math.min(this.startSection, secs.length - 1);
          this.curLoop = !secs[i]!.loop;
          this.entered = true;
          this.curId = secs[i]!.id;
          this.curIndex = i;
          this.curBarInSection = 0;
          this.curSectionStart = 0;
          return;
        }
        this.curLoop = !this.curLoop;
        return;
      }
      case 'break': {
        if (sU < 0) return;
        if (this.breakQ) {
          this.breakQ = null;
          return;
        }
        if (this.overlay && this.overlay.end > B) return;
        this.breakQ = { applyTick: B };
        return;
      }
      case 'fill': {
        if (sU < 0 || secs.length === 0 || this.breakQ || this.fillBusy(sU)) return;
        const last = this.plans[this.plans.length - 1];
        if (last && last.brk && sU <= last.end) return;
        const id = this.fillPatternFor(cfg, secs[this.baseIndex(secs)]!);
        if (!id) return;
        const start = Math.ceil(sU / BEAT) * BEAT;
        const end = start < B ? B : B + this.barLenFor(cfg, secs[this.baseIndex(secs)]);
        this.overlay = { start, end, patternId: id, crash: cfg.crashAfterFill, origin: 'manual' };
        return;
      }
      case 'next':
      case 'prev':
      case 'jump': {
        if (secs.length === 0) return;
        const kind = action.type;
        if (action.type === 'jump' && !Number.isFinite(action.sectionIndex)) return;
        if (this.queue && kind !== 'jump' && this.queue.kind === kind) {
          this.dropQueue(sU); // pressing the same button again cancels
          return;
        }
        if (this.queue) this.dropQueue(sU);
        const base = this.baseIndex(secs);
        let target: number | null;
        if (kind === 'next') target = base + 1 < secs.length ? base + 1 : null;
        else if (kind === 'prev') target = Math.max(0, base - 1);
        else target = Math.min(secs.length - 1, Math.max(0, Math.floor((action as { sectionIndex: number }).sectionIndex)));
        this.queue = {
          kind,
          applyTick: B,
          sectionIndex: target,
          targetId: target === null ? null : secs[target]!.id,
          targetIndex: target,
        };
        // Leaving a section with fills enabled: fill the rest of the current bar (>= 1 beat left).
        if (kind !== 'prev' && sU >= 0) {
          const cur = secs[base]!;
          if (cur.fill.enabled && !this.fillBusy(sU)) {
            const id = this.fillPatternFor(cfg, cur);
            const start = Math.ceil(sU / BEAT) * BEAT;
            if (id && start < B) {
              this.overlay = { start, end: B, patternId: id, crash: cfg.crashAfterFill, origin: 'next' };
            }
          }
        }
        return;
      }
    }
  }

  // ───────────────────────── emission ─────────────────────────

  collect(from: number, to: number, out: NoteOut[]): void {
    if (to <= from) return;
    const cfg = this.getConfig();
    const vol = cfg.click.volume;
    if (from < 0) collectCountIn(from, to, this.barLenFor(cfg, this.startSec(cfg)), vol, out);
    if (to <= 0) return;
    const lo = Math.max(from, 0);
    this.planUpTo(to);
    if (this.overlay && lo >= this.overlay.end + BEAT) this.overlay = null;

    for (const p of this.plans) {
      const a = Math.max(lo, p.start);
      const b = Math.min(to, p.end);
      if (b <= a) continue;
      if (p.final) {
        if (p.silentEnd) continue;
        if (a <= p.start && p.start < b) {
          const hits: NoteOut[] = [];
          addHit(hits, p.start, 'crash', CRASH_VEL);
          addHit(hits, p.start, 'kick', KICK_VEL);
          for (const h of hits) out.push(h);
          if (cfg.click.enabled) collectClicks(p.start, p.start + 1, (p.end - p.start), vol, out, p.start);
        }
        continue;
      }
      this.emitBar(cfg, p, a, b, out);
    }
  }

  private emitBar(cfg: SongConfig, p: BarPlan, a: number, b: number, out: NoteOut[]): void {
    const base = this.tmp;
    base.length = 0;
    const ov = this.overlay;
    const regions: Array<[number, number]> = [];
    if (p.fill) {
      const fp = cfg.getPattern(p.fill.patternId);
      if (fp) regions.push([Math.max(p.start, p.end - patternTicks(fp)), p.end]);
    }
    let ovPattern: Pattern | null = null;
    if (ov) {
      ovPattern = cfg.getPattern(ov.patternId);
      if (ovPattern) regions.push([Math.max(ov.start, ov.end - patternTicks(ovPattern)), ov.end]);
    }

    // Groove (silenced under breaks and fills).
    if (!p.brk) {
      const sec = cfg.song.sections.find((s) => s.id === p.sectionId);
      const pat = sec ? cfg.getPattern(sec.patternId) : null;
      if (pat) {
        const n0 = base.length;
        // One bar = one pass of the groove, so its phase is relative to the bar start.
        collectLoopNotes(pat, a - p.start, b - p.start, base);
        for (let i = n0; i < base.length; i++) base[i]!.tick += p.start;
        if (regions.length) {
          let w = n0;
          for (let i = n0; i < base.length; i++) {
            const n = base[i]!;
            if (!regions.some(([s, e]) => n.tick >= s && n.tick < e)) base[w++] = n;
          }
          base.length = w;
        }
      }
    }

    // Fill tails.
    if (p.fill) {
      const fp = cfg.getPattern(p.fill.patternId);
      if (fp) collectFillTail(fp, p.start, p.end, a, b, base);
    }
    if (ov && ovPattern) collectFillTail(ovPattern, ov.start, ov.end, a, b, base);

    // Crash + kick on the downbeat (break stab, after a fill, resumption after a break).
    if (p.hitAtStart && a <= p.start && p.start < b) {
      addHit(base, p.start, 'crash', CRASH_VEL);
      addHit(base, p.start, 'kick', KICK_VEL);
    }
    for (let i = 0; i < base.length; i++) out.push(base[i]!);
    base.length = 0;

    if (cfg.click.enabled) collectClicks(a, b, p.end - p.start, cfg.click.volume, out, p.start);
  }

  // ───────────────────────── UI info ─────────────────────────

  /** Arrangement state at an (audible) transport tick, or null if unknown (e.g. history already pruned). */
  infoAt(tick: number): SongInfo | null {
    const cfg = this.getConfig();
    const secs = cfg.song.sections;
    const queuedOf = (via: Via | null | undefined): SongInfo['queued'] => {
      if (via) return { kind: via.kind, sectionIndex: via.sectionIndex };
      const q = this.queue;
      return q ? { kind: q.kind, sectionIndex: q.targetIndex } : null;
    };

    if (tick < 0) {
      const si = secs.length ? Math.min(this.startSection, secs.length - 1) : 0;
      const sec = secs[si];
      const barLen = this.barLenFor(cfg, sec);
      const bpb = Math.max(1, Math.round(barLen / BEAT));
      const bar = Math.floor(tick / barLen);
      return {
        sectionIndex: si,
        barInSection: 0,
        sectionBars: sec ? Math.max(1, sec.bars) : 0,
        bar,
        beat: Math.min(bpb - 1, Math.floor((tick - bar * barLen) / BEAT)),
        beatsPerBar: bpb,
        countIn: Math.ceil(-tick / BEAT),
        nextSectionIndex: sec ? (sec.loop ? si : si + 1 < secs.length ? si + 1 : null) : null,
        queued: queuedOf(null),
        loop: sec ? (this.entered ? this.curLoop : sec.loop) : false,
        phase: 'normal',
        breakQueued: this.breakQ !== null,
        fillQueued: false,
      };
    }

    let i = this.plans.findIndex((p) => tick >= p.start && tick < p.end);
    if (i < 0 && this._ended !== null && tick >= this._ended) i = this.plans.length - 1;
    if (i < 0) return null;
    const p = this.plans[i]!;
    const nextPlan = this.plans[i + 1];

    const idx = p.sectionId === null ? -1 : secs.findIndex((s) => s.id === p.sectionId);
    const sectionIndex = idx >= 0 ? idx : p.sectionIndex;
    const isCurrentPass =
      !p.final && this.entered && this.curId === p.sectionId && this.curSectionStart === p.sectionStart;
    const loop = isCurrentPass ? this.curLoop : p.loop;
    const queued = p.final ? null : queuedOf(nextPlan?.via);
    let nextSectionIndex: number | null;
    if (p.final) nextSectionIndex = null;
    else if (queued) nextSectionIndex = queued.sectionIndex;
    else if (loop) nextSectionIndex = sectionIndex;
    else nextSectionIndex = sectionIndex + 1 < secs.length ? sectionIndex + 1 : null;

    let phase: SongInfo['phase'] = 'normal';
    if (p.final) phase = 'final';
    else if (p.brk) phase = 'break';
    else {
      const ov = this.overlay;
      const ovp = ov ? cfg.getPattern(ov.patternId) : null;
      if (ov && ovp && tick >= Math.max(ov.start, ov.end - patternTicks(ovp)) && tick < ov.end) phase = 'fill';
      else if (p.fill) {
        const fp = cfg.getPattern(p.fill.patternId);
        if (fp && tick >= Math.max(p.start, p.end - patternTicks(fp))) phase = 'fill';
      }
    }

    return {
      sectionIndex,
      barInSection: Math.min(p.barInSection, Math.max(0, p.sectionBars - 1)),
      sectionBars: p.sectionBars,
      bar: p.n,
      beat: Math.min(Math.max(1, Math.round((p.end - p.start) / BEAT)) - 1, Math.floor((tick - p.start) / BEAT)),
      beatsPerBar: Math.max(1, Math.round((p.end - p.start) / BEAT)),
      countIn: null,
      nextSectionIndex,
      queued,
      loop,
      phase,
      breakQueued: !p.final && (this.breakQ !== null || (nextPlan?.brk ?? false)),
      fillQueued: !p.final && this.overlay !== null && tick < this.overlay.start,
    };
  }
}
