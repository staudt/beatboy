/** Sections: headers, repeat expansion, phrase detection, naming (docs/tab-formats.md 7.7 to 7.9). */
import type { Feel } from '../../domain/types';
import { beatText, maxStepsFor } from './beat';
import type { HeaderInfo } from './classify';
import type { Notes } from './confidence';
import { expandRepeats } from './repeats';
import type { System } from './systems';
import type { Bar, TabSection } from './types';

export type Item =
  | { t: 'header'; h: HeaderInfo }
  | { t: 'system'; sys: System; repeat: number };

const MAX_PLAYS = 32;
const MAX_BARS = 256;
const MAX_TIMES = 64;
const MAX_SECTIONS = 32;

/** One section before naming. */
interface Draft {
  /** Header name; null = unnamed ("Part N"). */
  name: string | null;
  feel: Feel;
  times: number;
  bars: Bar[];
}

interface Group {
  header: HeaderInfo | null;
  systems: { sys: System; repeat: number }[];
}

const repeatBars = (bars: Bar[], n: number): Bar[] => {
  const out: Bar[] = [];
  for (let i = 0; i < n; i++) out.push(...bars);
  return out;
};

/** Smallest period (1..4 bars) the sequence repeats with at least twice; otherwise the whole length. */
export function period(bars: readonly Bar[]): number {
  const n = bars.length;
  for (let p = 1; p <= Math.min(4, Math.floor(n / 2)); p++) {
    if (n % p !== 0) continue;
    let ok = true;
    for (let i = p; i < n && ok; i++) ok = bars[i]!.sig === bars[i - p]!.sig;
    if (ok) return p;
  }
  return n;
}

function feelRuns(bars: Bar[]): Bar[][] {
  const runs: Bar[][] = [];
  for (const b of bars) {
    const last = runs[runs.length - 1];
    if (last && last[0]!.feel === b.feel) last.push(b);
    else runs.push([b]);
  }
  return runs;
}

function identicalRuns(bars: Bar[]): Bar[][] {
  const runs: Bar[][] = [];
  for (const b of bars) {
    const last = runs[runs.length - 1];
    if (last && last[0]!.sig === b.sig) last.push(b);
    else runs.push([b]);
  }
  return runs;
}

function groupBars(g: Group, notes: Notes): Bar[] {
  let bars: Bar[] = [];
  for (const { sys, repeat } of g.systems) {
    const n = Math.min(Math.max(1, repeat), MAX_PLAYS);
    if (repeat > MAX_PLAYS) notes.add(`A repeat of ${repeat} was capped at ${MAX_PLAYS}`, 0.02, 'cap');
    bars.push(...repeatBars(expandRepeats(sys.bars), n));
    if (bars.length > MAX_BARS) break;
  }
  if (g.header?.repeat && g.header.repeat > 1) {
    const n = Math.min(g.header.repeat, MAX_PLAYS);
    bars = repeatBars(bars, n);
  }
  if (bars.length > MAX_BARS) {
    notes.add(`Only the first ${MAX_BARS} bars were read`, 0.05, 'cap');
    bars = bars.slice(0, MAX_BARS);
  }
  return bars;
}

/** A phrase and its repeat count -> drafts (more than one when the phrase is longer than a beat can be). */
function emit(name: string | null, bars: Bar[], times: number, notes: Notes): Draft[] {
  if (bars.length === 0) return [];
  const feel = bars[0]!.feel;
  const max = maxStepsFor(feel);
  const total = bars.reduce((a, b) => a + b.n, 0);
  if (times > MAX_TIMES) {
    notes.add(`Plays of ${times} were capped at ${MAX_TIMES}`, 0.02, 'cap');
    times = MAX_TIMES;
  }
  if (total <= max && !bars.some((b) => b.n > max)) return [{ name, feel, times, bars }];
  // too long for one beat: play it out in several sections
  notes.add('A long section was split into several sections (a beat holds at most 32 beats)', 0.05, 'split');
  const full = repeatBars(bars, times);
  const out: Draft[] = [];
  let cur: Bar[] = [];
  let len = 0;
  for (const b0 of full) {
    const b = b0.n > max ? { ...b0, n: max, steps: b0.steps.slice(0, max) } : b0;
    if (len + b.n > max) {
      out.push({ name, feel, times: 1, bars: cur });
      cur = [];
      len = 0;
    }
    cur.push(b);
    len += b.n;
  }
  if (cur.length > 0) out.push({ name, feel, times: 1, bars: cur });
  return out;
}

/** Under a header: all bars are one section; its shortest repeating phrase (up to 4 bars) is the beat. */
function headed(name: string, bars: Bar[], notes: Notes): Draft[] {
  const drafts: Draft[] = [];
  for (const run of feelRuns(bars)) {
    const p = period(run);
    drafts.push(...emit(name, run.slice(0, p), run.length / p, notes));
  }
  if (drafts.length > 1 && feelRuns(bars).length > 1) {
    notes.add('A section mixes triplet and straight bars: it was split into one section per feel', 0.1, 'mixed-feel');
  }
  return drafts;
}

/** Without a header: runs of identical consecutive bars (or one repeating phrase) become "Part N". */
function headerless(bars: Bar[], notes: Notes): Draft[] {
  const drafts: Draft[] = [];
  for (const run of feelRuns(bars)) {
    const p = period(run);
    if (p < run.length) {
      drafts.push(...emit(null, run.slice(0, p), run.length / p, notes));
      continue;
    }
    for (const same of identicalRuns(run)) drafts.push(...emit(null, same.slice(0, 1), same.length, notes));
  }
  return drafts;
}

const baseName = (n: string): string => n.replace(/\s+\d+$/, '');

/** Items (headers and systems in paste order) -> named sections. */
export function buildSections(items: Item[], notes: Notes): TabSection[] {
  const groups: Group[] = [];
  let cur: Group = { header: null, systems: [] };
  for (const it of items) {
    if (it.t === 'header') {
      if (cur.header || cur.systems.length > 0) groups.push(cur);
      cur = { header: it.h, systems: [] };
    } else cur.systems.push({ sys: it.sys, repeat: it.repeat });
  }
  if (cur.header || cur.systems.length > 0) groups.push(cur);

  const result: { header: HeaderInfo | null; drafts: Draft[] }[] = [];
  for (const g of groups) {
    let drafts: Draft[] = [];
    const bars = g.header && g.systems.length > 0 ? groupBars(g, notes) : [];
    if (g.header && bars.length > 0) drafts = headed(g.header.name, bars, notes);
    else if (!g.header) {
      // chunks: a system with its own repeat count stands alone
      let chunk: Group = { header: null, systems: [] };
      const flush = () => {
        if (chunk.systems.length > 0) drafts.push(...headerless(groupBars(chunk, notes), notes));
        chunk = { header: null, systems: [] };
      };
      for (const s of g.systems) {
        if (s.repeat > 1) {
          flush();
          chunk.systems.push(s);
          flush();
        } else chunk.systems.push(s);
      }
      flush();
    } else if (g.header.sameAs !== null) {
      const want = g.header.sameAs;
      let src: Draft[] | undefined;
      for (let i = result.length - 1; i >= 0; i--) {
        const r = result[i]!;
        if (r.drafts.length === 0) continue;
        if (want === '' || (r.header?.name.toLowerCase().startsWith(want) ?? false)) {
          src = r.drafts;
          break;
        }
      }
      if (src) {
        const mult = Math.max(1, g.header.repeat ?? 1);
        drafts = src.map((d) => ({ ...d, name: g.header!.name, times: Math.min(MAX_TIMES, d.times * mult) }));
        notes.add(`Section "${g.header.name}" says "same as ${want || 'above'}": the earlier section was copied`, 0.1, 'same-as');
      } else {
        notes.add(`Section "${g.header.name}" says "same as ${want || 'above'}" but nothing earlier matched: skipped`, 0.1, 'same-as');
      }
    } else {
      notes.add(`Header "${g.header.name}" has no tab under it: skipped`, 0.05, 'empty-header');
    }
    result.push({ header: g.header, drafts });
  }

  // naming
  const used = new Set<string>();
  const unique = (name: string): string => {
    if (!used.has(name.toLowerCase())) {
      used.add(name.toLowerCase());
      return name;
    }
    const base = baseName(name);
    for (let n = 2; ; n++) {
      const cand = `${base} ${n}`;
      if (!used.has(cand.toLowerCase())) {
        used.add(cand.toLowerCase());
        return cand;
      }
    }
  };
  let part = 0;
  const out: TabSection[] = [];
  for (const r of result) {
    for (const d of r.drafts) {
      const name = unique(d.name ?? `Part ${++part}`);
      out.push({ name, feel: d.feel, times: d.times, beat: beatText(d.bars, d.feel) });
    }
  }
  if (out.length > MAX_SECTIONS) {
    notes.add(`Only the first ${MAX_SECTIONS} sections were kept`, 0.05, 'cap-sections');
    out.length = MAX_SECTIONS;
  }
  return out;
}
