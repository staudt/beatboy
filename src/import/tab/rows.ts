/** Tab row lines: label, bar cells, repeat signs, trailing comments (docs/tab-formats.md 7.2, 7.4). */

export interface Cell {
  /** Grid characters only (no spaces, parentheses collapsed to `g`). */
  text: string;
  repStart: boolean;
  repEnd: boolean;
}

export interface RowLine {
  /** Label as written; null when the row has none. */
  label: string | null;
  cells: Cell[];
  /** The row ends with a bar line. */
  terminated: boolean;
  /** The row has no bar lines at all (one long cell). */
  noBars: boolean;
  /** Text after the last bar line was dropped as a comment. */
  comment: boolean;
  /** Trailing "x4" after the last bar. */
  repeat: number | null;
  /** Fret numbers: a guitar tab row. */
  guitar: boolean;
}

const LABEL_SEP = /^\s*([A-Za-z][A-Za-z0-9\- ]{0,11}?)\s*([|:])(.*)$/;
const LABEL_SPACE = /^\s*([A-Za-z][A-Za-z0-9]{0,3})\s+(\S.*)$/;
const GRID_TOKEN = /^[-.xXoOgGfFdDbBrRcCsS#*+()@^>_~?0-9:]+$/;
const TRAIL_REPEAT = /^\s*(?:x\s*(\d{1,2})|(\d{1,2})\s*x)\s*$/i;

const distinct = (s: string): number => new Set(s.toLowerCase()).size;

/** Letters that spell a word: 3+ letters with 3+ different ones ("hat", "floor"), not a run like "xoxo". */
export function hasWord(s: string): boolean {
  for (const t of s.split(/[^A-Za-z]+/)) if (t.length >= 3 && distinct(t) >= 3) return true;
  return false;
}

/** `x x x x` / `x - x -`: every grid character separated by exactly one space (spaces are separators, not rests). */
const SPACED_GRID = /^\s*[^\s|]( [^\s|])+\s*$/;
/** A run of plain hit/rest characters only (e.g. `xxxxxxxx`), safe to accept on a labelled row without bar lines. */
const HITS_ONLY = /^[xXoOgG@#*.\-]+$/;

function isGridBody(body: string, labelled: boolean): boolean {
  if (body.includes('=')) return false;
  const squeezed = body.replace(/\s/g, '');
  if (hasWord(body)) return false;
  if (body.includes('|')) return squeezed.replace(/[|:]/g, '').length >= 3;
  // Labelled rows without bar lines whose grid has no rests (e.g. `HH x x x x x x x x`, `HH xxxxxxxx`).
  if (labelled && squeezed.length >= 4 && HITS_ONLY.test(squeezed) && (SPACED_GRID.test(body) || !/\s/.test(body.trim()))) {
    return true;
  }
  const rests = (squeezed.match(/[-.]/g) ?? []).length;
  return squeezed.length >= 8 && rests >= squeezed.length * 0.25;
}

function cleanCell(seg: string): Cell {
  let t = seg.trim();
  let repStart = false;
  let repEnd = false;
  if (t.startsWith(':')) {
    repStart = true;
    t = t.replace(/^:+/, '');
  }
  if (t.endsWith(':')) {
    repEnd = true;
    t = t.replace(/:+$/, '');
  }
  t = t.replace(/\(([^()\s])\)/g, 'g').trim();
  // Spaces are separators when every character is separated by exactly one space (`x x x x`), or when the cell
  // also uses rest characters; otherwise (e.g. `x   x   x`) a space is a rest.
  t = SPACED_GRID.test(t) || /[-._]/.test(t) ? t.replace(/\s+/g, '') : t.replace(/\s/g, '-');
  return { text: t, repStart, repEnd };
}

/** Cuts a trailing comment off the text after the last bar line. Returns the kept tail, whether something was cut, and an "xN". */
function cutTail(tail: string): { keep: string; cut: boolean; repeat: number | null } {
  if (tail.trim() === '') return { keep: '', cut: false, repeat: null };
  const rep = TRAIL_REPEAT.exec(tail);
  if (rep) return { keep: '', cut: false, repeat: Number(rep[1] ?? rep[2]) };
  const parts = tail.split(/(\s+)/);
  let keep = '';
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (/^\s*$/.test(part)) {
      keep += part;
      continue;
    }
    if (!GRID_TOKEN.test(part) || hasWord(part)) {
      const rep2 = TRAIL_REPEAT.exec(parts.slice(i).join(''));
      return { keep: keep.trimEnd(), cut: !rep2, repeat: rep2 ? Number(rep2[1] ?? rep2[2]) : null };
    }
    keep += part;
  }
  return { keep, cut: false, repeat: null };
}

/** Splits a row body into bar cells. Beat groups ("x-x-|x-x-|") are joined into bars. */
function splitCells(body: string): { cells: Cell[]; terminated: boolean } {
  let b = body.trim();
  const terminated = /\|\s*$/.test(b);
  b = b.replace(/^\|+/, '').replace(/\|+\s*$/, '');
  const parts = b.split(/(\|+)/);
  const segs: string[] = [];
  const delims: string[] = [];
  parts.forEach((p, i) => (i % 2 === 0 ? segs.push(p) : delims.push(p)));
  const double = delims.some((d) => d.length >= 2);
  const single = delims.some((d) => d.length === 1);
  let cells: Cell[] = [];
  if (double && single) {
    // `||` is the true bar line, `|` only groups beats.
    let buf: Cell | null = null;
    segs.forEach((s, i) => {
      const c = cleanCell(s);
      buf = buf ? { text: buf.text + c.text, repStart: buf.repStart, repEnd: c.repEnd } : c;
      if (i === segs.length - 1 || (delims[i] ?? '').length >= 2) {
        cells.push(buf);
        buf = null;
      }
    });
  } else {
    cells = segs.map(cleanCell).filter((c) => c.text !== '' || c.repStart || c.repEnd);
    const w = cells[0]?.text.length ?? 0;
    if (!double && cells.length >= 4 && cells.length % 4 === 0 && w >= 2 && w <= 4 && cells.every((c) => c.text.length === w)) {
      const grouped: Cell[] = [];
      for (let i = 0; i < cells.length; i += 4) {
        const g = cells.slice(i, i + 4);
        grouped.push({ text: g.map((c) => c.text).join(''), repStart: g[0]!.repStart, repEnd: g[3]!.repEnd });
      }
      cells = grouped;
    }
  }
  return { cells: cells.filter((c) => c.text !== ''), terminated };
}

/** Parses a line as a tab row, or returns null when it is not one. */
export function parseRow(line: string): RowLine | null {
  let label: string | null = null;
  let body: string | null = null;
  const m = LABEL_SEP.exec(line);
  if (m && !/^[xXoO\-]+$/.test(m[1]!.trim())) {
    label = m[1]!.trim();
    body = m[3]!;
  } else {
    const t = line.trimStart();
    if (t.startsWith('|')) {
      body = t;
    } else {
      const sp = LABEL_SPACE.exec(line);
      if (sp) {
        label = sp[1]!;
        body = sp[2]!;
      } else if (/^[-xXoO.#*gGfF(][-xXoO.#*gGfF() :]*\|/.test(t)) {
        body = t; // unlabelled grid starting with a hit or rest
      }
    }
  }
  if (body === null) return null;
  // trailing comment / repeat after the last bar line
  let comment = false;
  let repeat: number | null = null;
  const last = body.lastIndexOf('|');
  if (last >= 0) {
    const t = cutTail(body.slice(last + 1));
    comment = t.cut;
    repeat = t.repeat;
    body = body.slice(0, last + 1) + t.keep;
  }
  if (!isGridBody(body, label !== null)) return null;
  const nonRest = body.replace(/[\s|:\-._~]/g, '');
  const digits = (nonRest.match(/[0-9]/g) ?? []).length;
  const guitar = digits >= 1 && digits >= nonRest.length * 0.5;
  const hasBars = body.includes('|');
  if (!hasBars && label === null) return null;
  const { cells, terminated } = hasBars ? splitCells(body) : { cells: [cleanCell(body)], terminated: false };
  if (cells.length === 0) return null;
  return { label, cells, terminated, noBars: !hasBars, comment, repeat, guitar };
}
