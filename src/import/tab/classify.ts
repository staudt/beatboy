/** Line classification (docs/tab-formats.md 7.2): row, count, repeat, header, legend, metadata or prose. */
import { emptyLegend, parseLegendLine, type Legend } from './legend';
import { parseRow, type RowLine } from './rows';

export interface HeaderInfo {
  name: string;
  /** Repeat count written on the header ("Chorus x2"), total plays. */
  repeat: number | null;
  /** "same as verse": target word ("verse"), "" = the section before, null = not a same-as header. */
  sameAs: string | null;
}

export interface BarMark {
  repStart: boolean;
  repEnd: boolean;
  /** 1 or 2: first / second ending, 0 none. */
  ending: number;
}

export type Classified =
  | { kind: 'blank' }
  | { kind: 'sep' }
  | { kind: 'row'; row: RowLine }
  | { kind: 'count'; cpb: number | null }
  | { kind: 'bracket'; n: number }
  | { kind: 'endings'; marks: BarMark[] }
  | { kind: 'repeat'; n: number }
  | { kind: 'header'; header: HeaderInfo }
  | { kind: 'legend'; legend: Legend; surprising: string[] }
  | { kind: 'meta'; title: string | null }
  | { kind: 'text'; text: string };

// ── repeat lines ─────────────────────────────────────────────────
const REPEAT_LINE =
  /^\s*[([]?\s*(?:repeat(?:ed)?|play|loop)?\s*(?:x\s*(\d{1,2})|(\d{1,2})\s*(?:x|times?))\s*(?:times?)?\s*[)\]]?\s*$|^\s*(?:repeat|play)\s+(\d{1,2})\s*$/i;
const BRACKET = /^[\s|\-=_~]*(?:x\s*(\d{1,2})|(\d{1,2})\s*x)[\s|\-=_~]*$/i;

export function repeatCount(line: string): number | null {
  const m = REPEAT_LINE.exec(line);
  return m ? Number(m[1] ?? m[2] ?? m[3]) : null;
}

/** `|:   |1.   :|2.   |` above a staff: one mark per bar. */
function endingMarks(line: string): BarMark[] {
  const segs = line.trim().split('|');
  if (segs[0] === '') segs.shift();
  if (segs.length > 0 && segs[segs.length - 1]!.trim() === '') segs.pop();
  return segs.map((s) => {
    let t = s.trim();
    const repStart = t.startsWith(':');
    if (repStart) t = t.slice(1).trim();
    const e = /^(\d)\./.exec(t);
    return { repStart, repEnd: t.endsWith(':'), ending: e ? Number(e[1]) : 0 };
  });
}

// ── count lines ──────────────────────────────────────────────────
const COUNT_CHARS = /^[\s0-9e&a+ndtrilp()|]*$/i;

/** Characters per beat from "1 e & a 2 e & a", "1+2+3+4+", "1 trip let 2 ..." (null when unclear). */
function countLine(line: string): { cpb: number | null } | null {
  if (!COUNT_CHARS.test(line)) return null;
  const toks = line.toLowerCase().match(/\d+|trip|let|tl|and|[e&a+nd]/g) ?? [];
  const numbers = toks.filter((t) => /^\d+$/.test(t)).length;
  const marks = toks.length - numbers;
  if (numbers < 2 || marks < 2 || toks.length < 4) return null;
  const first = toks.findIndex((t) => /^\d+$/.test(t));
  const second = toks.findIndex((t, i) => i > first && /^\d+$/.test(t));
  const cpb = second > first ? second - first : null;
  return { cpb: cpb !== null && cpb >= 2 && cpb <= 6 ? cpb : null };
}

// ── headers ──────────────────────────────────────────────────────
const KEYWORD =
  /^((?:guitar\s+|bass\s+|drum\s+)?(?:pre[\s-]?(?:chorus|verse)|post[\s-]?chorus|intro|verse|chorus|refrain|bridge|solo|outro|ending|fill|breakdown|interlude|groove|main\s*(?:riff|beat|groove)?|riff|part|break|hook|coda|instrumental|turnaround|build[\s-]?up|middle\s*8|transition)\b)(\s*(?:\d{1,2}\b|[A-D]\b|one\b|two\b|three\b|four\b))?(.*)$/i;

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

export function parseHeader(line: string): HeaderInfo | null {
  const s = line.trim().replace(/^[\s[\]\-=*#~_:.>]+/, '').replace(/[\s[\]\-=*#~_:]+$/, '');
  if (s === '' || s.length > 70) return null;
  const m = KEYWORD.exec(s);
  if (!m) return null;
  let rest = m[3] ?? '';
  let sameAs = null as string | null;
  let repeat = null as number | null;
  rest = rest.replace(/(?:^|[\s([])(?:x\s*(\d{1,2})|(\d{1,2})\s*x)\b/i, (_a, a: string | undefined, b: string | undefined) => {
    repeat = Number(a ?? b);
    return ' ';
  });
  rest = rest.replace(/[([]([^)\]]*)[)\]]/g, (_all, inner: string) => {
    if (/\b(same|repeat|ditto|as above|as before)\b/i.test(inner)) {
      const t = /\bsame\s+as\s+(\w+)|\b(?:as|like|repeat(?:\s+of)?)\s+(\w+)/i.exec(inner);
      sameAs = (t?.[1] ?? t?.[2] ?? '').toLowerCase();
    }
    return ' ';
  });
  const bareSame = /\bsame\s+as\s+(\w+)|\b(same|ditto)\b/i.exec(rest);
  if (bareSame) {
    sameAs = (bareSame[1] ?? '').toLowerCase();
    rest = rest.replace(bareSame[0], ' ');
  }
  rest = rest.replace(/\(?\b\d{1,2}:\d{2}\b\)?/g, ' ');
  if (/[A-Za-z0-9]/.test(rest.replace(/\b(?:x|times?|bars?|only)\b/gi, ''))) return null;
  if (sameAs === 'above' || sameAs === 'before' || sameAs === 'previous' || sameAs === 'last' || sameAs === 'it') sameAs = '';
  let name = ((m[1] ?? '') + (m[2] ?? '')).replace(/\s+/g, ' ').trim();
  name = name === name.toUpperCase() ? titleCase(name) : name.charAt(0).toUpperCase() + name.slice(1);
  return { name, repeat, sameAs };
}

// ── metadata ─────────────────────────────────────────────────────
const KV =
  /^\s*(title|song|song name|name|track|band|artist|album|tempo|bpm|speed|time|time sig(?:nature)?|tabbed by|tab by|tabber|transcribed by|drummer|difficulty|tuning|capo|source)\s*[:=]\s*(.*)$/i;

export function findTempo(line: string): number | null {
  const m =
    /\b(?:tempo|bpm|speed)\s*[:=]?\s*~?\s*(?:approx\.?\s*|about\s*)?(\d{2,3})\b/i.exec(line) ??
    /\b(\d{2,3})\s*bpm\b/i.exec(line) ??
    /(?:^|[\s([])[q\u2669\u266A]\s*=\s*~?(\d{2,3})\b/i.exec(line);
  if (!m) return null;
  const v = Number(m[1]);
  return v >= 30 && v <= 300 ? v : null;
}

const SMALL = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'but', 'with', 'by', 'from', 'no', 'is']);

/** "Slow Blues in 12/8", "Road Trip": two or more words, each capitalised (or a small word). */
export function looksLikeTitle(line: string): boolean {
  const s = line.trim();
  if (s.length < 3 || s.length > 50 || /[:=|()[\]]/.test(s)) return false;
  const words = s.split(/\s+/);
  if (words.length < 2 || words.length > 8) return false;
  return words.every((w, i) => /^[A-Z0-9]/.test(w) || (i > 0 && SMALL.has(w.toLowerCase())));
}

// ── main entry ───────────────────────────────────────────────────
export function classifyLine(line: string): Classified {
  const t = line.trim();
  if (t === '') return { kind: 'blank' };
  if (/^[=\-_*~#+.]{6,}$/.test(t)) return { kind: 'sep' };
  const br = BRACKET.exec(line);
  if (br && /[|-]/.test(line)) return { kind: 'bracket', n: Number(br[1] ?? br[2]) };
  if (/^[\s|:.\d-]*$/.test(line) && line.includes('|') && (line.includes(':') || /\d\./.test(line))) {
    return { kind: 'endings', marks: endingMarks(line) };
  }
  const row = parseRow(line);
  if (row) return { kind: 'row', row };
  const cl = countLine(line);
  if (cl) return { kind: 'count', cpb: cl.cpb };
  const rep = repeatCount(line);
  if (rep !== null) return { kind: 'repeat', n: rep };
  const kv = KV.exec(line);
  if (kv) {
    const key = kv[1]!.toLowerCase();
    const value = kv[2]!.replace(/^["']|["']$/g, '').trim();
    return { kind: 'meta', title: /^(title|song|song name|name|track)$/.test(key) && value ? value : null };
  }
  const lg = emptyLegend();
  const lr = parseLegendLine(line, lg);
  if (lr.matched) return { kind: 'legend', legend: lg, surprising: lr.surprising };
  const header = parseHeader(line);
  if (header) return { kind: 'header', header };
  return { kind: 'text', text: t };
}
