/**
 * Drum-tab importer: pasted text -> a song's worth of sections (docs/tab-formats.md section 7).
 *
 * Pipeline: normalise -> classify lines -> blocks of rows (+ repeat/count lines) -> join wrapped systems ->
 * systems (labels, bar alignment, grid, hit mapping) -> sections (repeats, phrases, names) -> beat text.
 * Pure TypeScript, never throws.
 */
import { classifyLine, findTempo, looksLikeTitle, type BarMark, type Classified } from './classify';
import { Notes } from './confidence';
import { emptyLegend, type Legend } from './legend';
import { normalise } from './normalise';
import type { RowLine } from './rows';
import { buildSections, type Item } from './sections';
import { buildSystem, type Block, type System } from './systems';
import type { TabImport } from './types';

export type { TabImport, TabSection } from './types';

const DEFAULT_NAME = 'Imported tab';

const rejected = (message: string, confidence = 0.1): TabImport => ({
  reject: true,
  confidence,
  song: { name: DEFAULT_NAME, bpm: null },
  sections: [],
  warnings: [message],
});

type Entry = { t: 'header'; h: Extract<Classified, { kind: 'header' }>['header'] } | { t: 'block'; block: Block };

/** A system hard-wrapped mid-bar continues in the next block (same labels, short last bars): join them row by row. */
function joinWrapped(entries: Entry[], notes: Notes): void {
  for (let i = entries.length - 1; i > 0; i--) {
    const a = entries[i - 1]!;
    const b = entries[i]!;
    if (a.t !== 'block' || b.t !== 'block') continue;
    const ra = a.block.rows;
    const rb = b.block.rows;
    if (ra.length < 2 || ra.length !== rb.length) continue;
    const same = ra.every((r, k) => r.label !== null && rb[k]!.label !== null && r.label.toLowerCase() === rb[k]!.label!.toLowerCase());
    if (!same || ra.some((r) => r.terminated || r.noBars)) continue;
    const full = ra.flatMap((r) => r.cells.slice(0, -1).map((c) => c.text.length)).concat(rb.flatMap((r) => r.cells.slice(1).map((c) => c.text.length)));
    const tails = ra.map((r) => r.cells[r.cells.length - 1]!.text.length);
    const heads = rb.map((r) => r.cells[0]!.text.length);
    const L = full.length > 0 ? mode(full) : tails[0]! + heads[0]!;
    if (!tails.every((t, k) => t < L && Math.abs(t + heads[k]! - L) <= 1)) continue;
    const merged: RowLine[] = ra.map((r, k) => {
      const next = rb[k]!;
      const last = r.cells[r.cells.length - 1]!;
      const first = next.cells[0]!;
      return {
        ...r,
        cells: [...r.cells.slice(0, -1), { text: last.text + first.text, repStart: last.repStart, repEnd: first.repEnd }, ...next.cells.slice(1)],
        terminated: next.terminated,
        comment: r.comment || next.comment,
      };
    });
    a.block = { ...a.block, rows: merged, repeat: a.block.repeat ?? b.block.repeat };
    entries.splice(i, 1);
    notes.add('A system wrapped across two text blocks was joined into one', 0.1, 'wrapped');
  }
}

function mode(xs: number[]): number {
  const count = new Map<number, number>();
  let best = xs[0] ?? 0;
  let bc = 0;
  for (const x of xs) {
    const c = (count.get(x) ?? 0) + 1;
    count.set(x, c);
    if (c > bc || (c === bc && x > best)) [best, bc] = [x, c];
  }
  return best;
}

function parse(text: string): TabImport {
  const notes = new Notes();
  const norm = normalise(text);
  if (norm.quoted) notes.add('Removed ">" quote marks from the paste', 0.05, 'quote');
  if (norm.numbered) notes.add('Removed a column of line numbers from the paste', 0.05, 'numbers');

  const legend: Legend = emptyLegend();
  const entries: Entry[] = [];
  let cur: { rows: RowLine[]; cpb: number | null; repeat: number | null; endings: BarMark[] | null } | null = null;
  let pendingCpb: number | null = null;
  let pendingRepeat: number | null = null;
  let pendingEndings: BarMark[] | null = null;
  let seenRows = false;
  let guitarRows = 0;
  let drumRows = 0;
  let commentRows = 0;
  let title: string | null = null;
  let tempo: number | null = null;
  let secondTabTempo: number | null | undefined;
  const firstLine = norm.lines.findIndex((l) => l.trim() !== '');

  const flush = (): Block | null => {
    if (!cur) return null;
    const block: Block = { rows: cur.rows, cpb: cur.cpb, repeat: cur.repeat ?? cur.rows.find((r) => r.repeat)?.repeat ?? null, endings: cur.endings };
    entries.push({ t: 'block', block });
    cur = null;
    return block;
  };
  const clearPending = () => {
    pendingCpb = null;
    pendingRepeat = null;
    pendingEndings = null;
  };
  let prevKind: Classified['kind'] | null = null;

  norm.lines.forEach((line, i) => {
    const c = classifyLine(line);
    switch (c.kind) {
      case 'row': {
        if (c.row.guitar) {
          guitarRows++;
          break;
        }
        drumRows++;
        seenRows = true;
        if (c.row.comment) commentRows++;
        if (!cur) {
          cur = { rows: [], cpb: pendingCpb, repeat: pendingRepeat, endings: pendingEndings };
          clearPending();
        }
        cur.rows.push(c.row);
        break;
      }
      case 'count':
        if (cur) cur.cpb = c.cpb ?? cur.cpb;
        else pendingCpb = c.cpb;
        break;
      case 'bracket':
        flush();
        pendingRepeat = c.n;
        break;
      case 'endings':
        flush();
        pendingEndings = c.marks;
        break;
      case 'repeat': {
        const adjacent = cur !== null && (prevKind === 'row' || prevKind === 'count');
        const b = flush();
        if (adjacent && b) b.repeat = (b.repeat ?? 1) > 1 ? b.repeat : c.n;
        else pendingRepeat = c.n;
        break;
      }
      case 'header':
        flush();
        clearPending();
        entries.push({ t: 'header', h: c.header });
        break;
      case 'legend': {
        flush();
        clearPending();
        for (const [k, v] of c.legend.labels) legend.labels.set(k, v);
        legend.chars.push(...c.legend.chars);
        if (c.surprising.length > 0) notes.add(`Legend: ${c.surprising.join(', ')}`, 0.02, 'legend');
        break;
      }
      case 'blank':
      case 'sep':
        flush();
        clearPending();
        break;
      case 'meta':
      case 'text': {
        flush();
        clearPending();
        const t = findTempo(line);
        const keyTitle = c.kind === 'meta' ? c.title : null;
        if (seenRows && (t !== null || keyTitle) && (title !== null || tempo !== null)) secondTabTempo = t;
        else {
          if (t !== null && tempo === null) tempo = t;
          if (keyTitle && title === null) title = keyTitle;
        }
        if (c.kind === 'text' && i === firstLine && title === null) {
          // A quoted name on the first line ("Drum part for … - \"Night Drive\"") is the title.
          const quoted = /["“”]([^"“”]{2,60})["“”]/.exec(c.text)?.[1]?.trim();
          if (quoted) title = quoted;
          else if (looksLikeTitle(c.text)) title = c.text;
        }
        break;
      }
    }
    prevKind = c.kind;
  });
  flush();

  if (drumRows === 0 || (guitarRows >= 3 && guitarRows > drumRows)) {
    return rejected(
      guitarRows > 0
        ? 'Not a drum tab: the lines look like a guitar tab (fret numbers on string rows)'
        : 'Not a drum tab: no drum rows (like HH| SD| BD|) were found in this text',
      guitarRows > 0 ? 0.1 : 0,
    );
  }

  joinWrapped(entries, notes);
  if (commentRows > 0) notes.add('Ignored comments written after the bar lines of some rows', 0.05, 'comment');

  // systems
  const strays = new Set<string>();
  const items: Item[] = [];
  let prev: System | null = null;
  const srcLens = new Set<number>();
  for (const e of entries) {
    if (e.t === 'header') {
      items.push({ t: 'header', h: e.h });
      continue;
    }
    const sys = buildSystem(e.block, prev, { legend, notes, strays });
    if (!sys) continue;
    prev = sys;
    if (sys.bars.length === 0) continue;
    for (const b of sys.bars) srcLens.add(b.src);
    items.push({ t: 'system', sys, repeat: e.block.repeat ?? 1 });
  }
  if (strays.size > 0) notes.add(`Stray characters in the grid (${[...strays].join(' ')}): read as rests, accents or hits`, 0.1, 'stray');
  if (srcLens.size > 1) {
    notes.add('Mixed bar lengths / resolutions in this tab: each bar keeps its own grid', 0.15, 'mixed');
  }
  if (secondTabTempo !== undefined) {
    notes.add(
      `A second tab seems to follow in this paste${secondTabTempo ? ` (its tempo ${secondTabTempo} was ignored)` : ' (its tempo and title were ignored)'}: its sections were appended after the first tab's`,
      0.15,
      'second-tab',
    );
  }

  const sections = buildSections(items, notes);
  if (sections.length === 0) return rejected('Not a drum tab: no readable drum bars were found', 0.1);
  if (tempo === null) notes.penalise('no-tempo', 0.02);
  const name = (title ?? DEFAULT_NAME).trim().slice(0, 48) || DEFAULT_NAME;
  return { reject: false, confidence: notes.confidence(), song: { name, bpm: tempo }, sections, warnings: notes.warnings };
}

/** Pasted text -> sections (see `TabImport`). Never throws: the worst case is `reject: true`. */
export function parseDrumTab(text: string): TabImport {
  try {
    return parse(text);
  } catch (e) {
    return rejected(`Not a drum tab: the text could not be read (${e instanceof Error ? e.message : 'error'})`, 0);
  }
}
