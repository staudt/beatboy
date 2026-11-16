/**
 * Systems: a block of tab rows -> bars. Resolves labels, aligns the rows on their bar lines (tolerating ragged rows),
 * infers the grid of every bar and maps hit characters to sounds (docs/tab-formats.md 7.3 to 7.6).
 */
import type { SoundId } from '../../domain/types';
import type { BarMark } from './classify';
import type { Notes } from './confidence';
import { mapHit, resolveLabel, type RowContext } from './instruments';
import { normLabel, type Legend } from './legend';
import type { Cell, RowLine } from './rows';
import type { Bar } from './types';

export interface Block {
  rows: RowLine[];
  /** Characters per beat from a count line, when it said so. */
  cpb: number | null;
  /** "x4" bracket / "(x2)" / "repeat 3 times" attached to this system. */
  repeat: number | null;
  endings: BarMark[] | null;
}

export interface System {
  bars: Bar[];
  /** Row labels in row order (as written or inferred): the next system may inherit them. */
  labels: (string | null)[];
}

export interface Env {
  legend: Legend;
  notes: Notes;
  strays: Set<string>;
}

const mode = (xs: number[]): number => {
  const count = new Map<number, number>();
  for (const x of xs) count.set(x, (count.get(x) ?? 0) + 1);
  let best = xs[0] ?? 0;
  let bc = 0;
  for (const [v, c] of count) if (c > bc || (c === bc && v > best)) [best, bc] = [v, c];
  return best;
};

interface Grid {
  feel: 'straight' | 'triplet';
  steps: number;
  at: (j: number) => number;
  merged: boolean;
  odd: boolean;
}

/** Character count of a bar -> grid (docs/tab-formats.md 7.5). */
function gridFor(n: number): Grid {
  const id = (j: number) => j;
  switch (n) {
    case 4:
      return { feel: 'straight', steps: 16, at: (j) => j * 4, merged: false, odd: false };
    case 8:
      return { feel: 'straight', steps: 16, at: (j) => j * 2, merged: false, odd: false };
    case 16:
      return { feel: 'straight', steps: 16, at: id, merged: false, odd: false };
    case 32:
      return { feel: 'straight', steps: 16, at: (j) => Math.floor(j / 2), merged: true, odd: false };
    case 64:
      return { feel: 'straight', steps: 16, at: (j) => Math.floor(j / 4), merged: true, odd: false };
    case 24:
      return { feel: 'triplet', steps: 12, at: (j) => Math.floor(j / 2), merged: true, odd: false };
    case 6:
    case 9:
    case 12:
    case 15:
    case 18:
      return { feel: 'triplet', steps: n, at: id, merged: false, odd: false };
    default:
      return { feel: 'straight', steps: n, at: id, merged: false, odd: true };
  }
}

export function barSig(feel: string, n: number, steps: Map<SoundId, number>[]): string {
  const parts: string[] = [`${feel[0]}${n}`];
  steps.forEach((m, i) => {
    if (m.size === 0) return;
    parts.push(`${i}:${[...m].sort(([a], [b]) => (a < b ? -1 : 1)).map(([s, v]) => `${s}${v}`).join(',')}`);
  });
  return parts.join('|');
}

interface UsableRow {
  line: RowLine;
  rc: RowContext;
  cells: Cell[];
}

/** Without bar lines: the bar size from the count line, else the first of 16, 12, 8 that divides the length. */
function barSizeFor(len: number, cpb: number | null): number {
  if (cpb && len % (cpb * 4) === 0) return cpb * 4;
  for (const s of [16, 12, 8]) if (len % s === 0) return s;
  return len;
}

export function buildSystem(block: Block, prev: System | null, env: Env): System | null {
  const { notes, legend } = env;
  // 1. labels: written, or matched by position to the previous system, or the usual HH/SD/BD for three rows
  const unlabelled = block.rows.filter((r) => r.label === null).length;
  const labels: (string | null)[] = block.rows.map((r, i) => {
    if (r.label !== null) return r.label;
    const inherited = prev?.labels[i] ?? null;
    if (inherited) return inherited;
    if (block.rows.length === 3 && unlabelled === 3) return ['HH', 'SD', 'BD'][i]!;
    return null;
  });
  if (unlabelled > 0) {
    if (labels.some((l, i) => l !== null && block.rows[i]!.label === null)) {
      notes.add('Rows without a label were matched by position to the previous system', 0.1, 'label');
    }
    if (labels.some((l, i) => l === null && block.rows[i]!.label === null)) {
      notes.add('A row without a label could not be matched and was skipped', 0.1, 'label');
    }
  }
  const sysLabels = new Set(labels.filter((l): l is string => l !== null).map(normLabel));
  const usable: UsableRow[] = [];
  block.rows.forEach((line, i) => {
    const label = labels[i];
    if (!label) return;
    const inst = resolveLabel(label, { labels: sysLabels, legend, notes });
    if (!inst) {
      notes.add(`Unknown instrument "${label}" skipped (Beatboy has no such sound)`, 0.1, 'unknown-instrument');
      return;
    }
    const chars = new Set<string>();
    for (const c of line.cells) for (const ch of c.text) chars.add(ch.toLowerCase());
    usable.push({ line, rc: { inst, chars, legend, notes, strays: env.strays }, cells: line.cells });
  });
  if (usable.length === 0) return { bars: [], labels };

  // 2. no bar lines anywhere: cut the long rows into bars
  if (usable.every((u) => u.line.noBars)) {
    const len = mode(usable.map((u) => u.cells[0]!.text.length));
    const size = barSizeFor(len, block.cpb);
    notes.add(`No bar lines found: the rows were cut into bars of ${size} characters`, 0.1, 'no-bar-lines');
    for (const u of usable) {
      const text = u.cells[0]!.text;
      const cells: Cell[] = [];
      for (let p = 0; p < text.length; p += size) cells.push({ text: text.slice(p, p + size), repStart: false, repEnd: false });
      u.cells = cells;
    }
  }

  // 3. align rows on bar index
  const barCount = mode(usable.map((u) => u.cells.length));
  for (const u of usable) {
    if (u.cells.length < barCount) {
      notes.add(`Row ${u.line.label ?? ''} has fewer bars than the others: padded with rests`.replace('  ', ' '), 0.1, 'padded');
      while (u.cells.length < barCount) u.cells.push({ text: '', repStart: false, repEnd: false });
    } else if (u.cells.length > barCount) {
      notes.add(`Row ${u.line.label ?? ''} has more bars than the others: extra bars truncated`.replace('  ', ' '), 0.1, 'truncated');
      u.cells = u.cells.slice(0, barCount);
    }
  }

  const bars: Bar[] = [];
  for (let b = 0; b < barCount; b++) {
    const lens = usable.map((u) => u.cells[b]!.text.length).filter((l) => l > 0);
    const n = lens.length > 0 ? mode(lens) : 0;
    if (n === 0) {
      // every row is empty here: a bar of rests would be invented length, skip it
      continue;
    }
    const grid = gridFor(n);
    if (grid.odd) notes.add(`Odd bar length (${n} characters): kept as ${n} steps of one 16th each`, 0.1, 'odd');
    if (grid.merged) {
      notes.add(`Bars of ${n} characters were merged to ${grid.steps} steps (finer notes snapped to the grid)`, 0.15, 'merged');
    }
    const steps: Map<SoundId, number>[] = Array.from({ length: grid.steps }, () => new Map());
    let repStart = false;
    let repEnd = false;
    for (const u of usable) {
      const cell = u.cells[b]!;
      repStart ||= cell.repStart;
      repEnd ||= cell.repEnd;
      let text = cell.text;
      if (text.length < n) {
        if (text.length > 0) notes.add(`A row was one or more characters short in a bar: padded with rests`, 0.1, 'padded');
        text = text.padEnd(n, '-');
      } else if (text.length > n) {
        notes.add(`A row was longer than the others in a bar: extra characters truncated`, 0.1, 'truncated');
        text = text.slice(0, n);
      }
      for (let j = 0; j < n; j++) {
        const hit = mapHit(text[j]!, u.rc);
        if (!hit) continue;
        const idx = grid.at(j);
        if (idx >= steps.length) continue;
        const cur = steps[idx]!;
        cur.set(hit.sound, Math.max(cur.get(hit.sound) ?? 0, hit.vel));
      }
    }
    const bar: Bar = { feel: grid.feel, n: grid.steps, src: n, steps, sig: barSig(grid.feel, grid.steps, steps) };
    if (repStart) bar.repStart = true;
    if (repEnd) bar.repEnd = true;
    bars.push(bar);
  }

  // 4. repeat signs / endings written above the staff
  if (block.endings) {
    block.endings.forEach((m, i) => {
      const bar = bars[i];
      if (!bar) return;
      if (m.repStart) bar.repStart = true;
      if (m.repEnd) bar.repEnd = true;
      if (m.ending) bar.ending = m.ending;
    });
  }
  return { bars, labels };
}
