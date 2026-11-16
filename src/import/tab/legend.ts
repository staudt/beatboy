import type { InstKind } from './types';

/** What a legend entry says about a hit character. */
export type CharMode = 'closed' | 'open' | 'ghost' | 'accent' | 'ornament' | 'normal' | 'rim' | 'bell';
export interface CharRule {
  ch: string;
  scope: 'hat' | 'snare' | 'all';
  mode: CharMode;
}

export interface Legend {
  /** Normalised label (see `normLabel`) -> instrument. */
  labels: Map<string, InstKind>;
  chars: CharRule[];
}

export const emptyLegend = (): Legend => ({ labels: new Map(), chars: [] });

export const normLabel = (s: string): string => s.toLowerCase().replace(/[\s\-_.]/g, '');

/** Instrument named in words ("hi-hat foot", "floor tom"), or null. */
export function instrumentFromWords(words: string): InstKind | null {
  const w = words.toLowerCase();
  if (/(hi[\s-]*hat|\bhat\b|\bhh\b)/.test(w) && /(foot|pedal|\bhf\b)/.test(w)) return 'hatPedal';
  if (/(foot|pedal)/.test(w) && /(hat|hh)/.test(w)) return 'hatPedal';
  if (/(hi[\s-]*hat|\bhat\b)/.test(w)) return /\bopen\b/.test(w) ? 'hatOpenLine' : 'hat';
  if (/floor/.test(w)) return 'tomFloor';
  if (/(high|hi)\s*tom/.test(w) || /\btom\s*1\b/.test(w)) return 'tomHigh';
  if (/(low|lo)\s*tom/.test(w) || /\btom\s*3\b/.test(w)) return 'tomFloor';
  if (/(mid|middle)\s*tom/.test(w) || /\btom\s*2\b/.test(w)) return 'tomMid';
  if (/\btoms?\b/.test(w)) return 'tomMid';
  if (/snare/.test(w)) return 'snare';
  if (/(kick|bass)/.test(w)) return 'kick';
  if (/(china|splash)/.test(w)) return 'crash2';
  if (/crash/.test(w)) return /(2|two)/.test(w) ? 'crash2' : 'crash';
  if (/bell/.test(w) && /ride/.test(w)) return 'rideBell';
  if (/ride/.test(w)) return 'ride';
  if (/cowbell/.test(w)) return 'cowbell';
  if (/tamb/.test(w)) return 'tambourine';
  if (/clap/.test(w)) return 'clap';
  if (/(side[\s-]*stick|rim)/.test(w)) return 'sidestick';
  return null;
}

function modeFromWords(words: string): CharMode | null {
  const w = words.toLowerCase();
  if (/\bopen\b|\bloose\b|\bhalf[\s-]*open\b/.test(w)) return 'open';
  if (/\bclosed?\b/.test(w)) return 'closed';
  if (/ghost/.test(w)) return 'ghost';
  if (/accent|loud|\bhard\b/.test(w)) return 'accent';
  if (/(flam|drag|roll|ruff|buzz|double|diddle|press)/.test(w)) return 'ornament';
  if (/(choke|normal|hit)/.test(w)) return 'normal';
  if (/(rim|side)/.test(w)) return 'rim';
  if (/bell/.test(w)) return 'bell';
  return null;
}

export interface LegendResult {
  /** The line contained at least one legend entry. */
  matched: boolean;
  /** Human-readable facts for warnings (only those that differ from the defaults). */
  surprising: string[];
}

const KEY = /(?:^|[\s,;(])([^\s=,;()]{1,4})\s*=\s*/g;

/**
 * Reads a legend line ("x = closed hi-hat   o = open hi-hat", "Hf = hi-hat foot") into `legend`.
 * Entries are `LHS = words`; the LHS is a hit character (the words describe how it is played) or a row label
 * (the words are an instrument).
 */
export function parseLegendLine(line: string, legend: Legend): LegendResult {
  const res: LegendResult = { matched: false, surprising: [] };
  const keys: { lhs: string; start: number; end: number }[] = [];
  KEY.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = KEY.exec(line))) {
    keys.push({ lhs: m[1]!, start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) KEY.lastIndex++;
  }
  // "x - closed hat" / "F: floor tom" style (one entry, short LHS at the line start).
  if (keys.length === 0) {
    const alt = /^\s*([^\s=,;()]{1,3})\s*(?:->|:|-)\s*(\S.*)$/.exec(line);
    if (alt && (instrumentFromWords(alt[2]!) || modeFromWords(alt[2]!)) && !/\d/.test(alt[1]!)) {
      keys.push({ lhs: alt[1]!, start: 0, end: line.length - alt[2]!.length });
    }
  }
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!;
    const stop = keys[i + 1] ? keys[i + 1]!.start : line.length;
    const rhs = line.slice(k.end, stop).replace(/[,;]\s*$/, '').trim();
    if (!rhs || !/[a-z]/i.test(rhs)) continue;
    const kind = instrumentFromWords(rhs);
    const mode = modeFromWords(rhs);
    if (!kind && !mode) continue;
    res.matched = true;
    const isChar = k.lhs.length === 1 && (mode !== null || !/[A-Za-z]/.test(k.lhs));
    if (isChar && mode) {
      const scope: CharRule['scope'] = kind === 'hat' || kind === 'hatOpenLine' || kind === 'hatPedal' ? 'hat' : kind === 'snare' ? 'snare' : 'all';
      legend.chars.push({ ch: k.lhs, scope, mode });
      const c = k.lhs.toLowerCase();
      if ((mode === 'open' && 'x+'.includes(c)) || (mode === 'closed' && c === 'o')) {
        res.surprising.push(`${k.lhs} is ${mode} hi-hat`);
      }
    } else if (kind) {
      legend.labels.set(normLabel(k.lhs), kind);
      res.surprising.push(`${k.lhs} is ${rhs.toLowerCase()}`);
    }
  }
  return res;
}
