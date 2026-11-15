import {
  PATTERN_LIMITS,
  SOUND_IDS,
  VELOCITY,
  type NoteEvent,
  type Pattern,
  type SoundId,
  type TimeSignature,
} from './types';
import { LETTER_TO_SOUND, SOUNDS } from './sounds';
import { stepTicks } from './time';
import { velocityLevel } from './patternOps';

export interface NotationError {
  line: number;
  col: number;
  message: string;
}

/** How coarsely a text was written: one token per quarter, 8th, 16th or triplet. */
export type Resolution = 'quarters' | '8ths' | '16ths' | 'triplets';

export type ParseResult =
  | {
      ok: true;
      notes: Partial<Record<SoundId, NoteEvent[]>>;
      /** Length of the loop in beats (1..32); can differ from the pattern's current length. */
      beats: number;
      /** Tokens read (rests included), at the chosen resolution. */
      steps: number;
      resolution: Resolution;
      warnings: string[];
    }
  | { ok: false; errors: NotationError[] };

/** Tokens per beat that can be written for a grid of `spb` steps per beat, finest first (4 → 4, 2, 1; 3 → 3, 1). */
function densities(spb: number): number[] {
  const out: number[] = [];
  for (let d = spb; d >= 1; d--) if (spb % d === 0) out.push(d);
  return out;
}

/** Name of writing `d` tokens per beat on a grid of `spb` steps per beat. */
export function resolutionOf(d: number, spb: number): Resolution {
  if (d === 1) return 'quarters';
  if (spb % 3 === 0) return 'triplets';
  return d === 2 ? '8ths' : '16ths';
}

interface Tok {
  ch: string;
  /** True when whitespace (or a line break / comment) separates this character from the previous one. */
  brk: boolean;
  line: number;
  col: number;
}

interface StepItem {
  kind: 'step';
  hits: Map<SoundId, number>;
  line: number;
  col: number;
}
type Item = StepItem;

const MAX_ERRORS = 20;
const MAX_REPEAT = 64;

function tokenize(text: string): Tok[] {
  const toks: Tok[] = [];
  let line = 1;
  let col = 0;
  let inComment = false;
  let brk = true;
  for (const ch of text) {
    if (ch === '\n') {
      line++;
      col = 0;
      inComment = false;
      brk = true;
      continue;
    }
    col++;
    if (ch === '\r') continue;
    if (inComment) continue;
    if (ch === '#') {
      inComment = true;
      brk = true;
      continue;
    }
    if (/\s/.test(ch)) {
      brk = true;
      continue;
    }
    toks.push({ ch, brk, line, col });
    brk = false;
  }
  return toks;
}

export function parseBeatText(text: string, opts: { timeSig: TimeSignature; stepsPerBeat: number }): ParseResult {
  const toks = tokenize(text);
  const errors: NotationError[] = [];
  const err = (t: { line: number; col: number }, message: string) => {
    if (errors.length < MAX_ERRORS) errors.push({ line: t.line, col: t.col, message });
  };

  const top: Item[] = [];
  let bracket: Item[] | null = null;
  let bracketStart: Tok | null = null;
  const target = () => bracket ?? top;

  let i = 0;

  /** Parse one hit at toks[i]. Returns false if invalid (error already recorded). */
  const parseHit = (hits: Map<SoundId, number>): boolean => {
    const t = toks[i];
    if (!t) return false;
    let letterTok = t;
    let ghost = false;
    if (t.ch === '(') {
      const l = toks[i + 1];
      if (!l || !/^[A-Za-z]$/.test(l.ch)) {
        err(t, "Expected a sound letter after '('");
        i++;
        return false;
      }
      const close = toks[i + 2];
      letterTok = l;
      ghost = true;
      if (!close || close.ch !== ')') {
        err(close ?? l, "Missing ')' after ghost note");
        i += 2;
        return false;
      }
      i += 3;
    } else {
      i++;
    }
    const sound = LETTER_TO_SOUND[letterTok.ch.toLowerCase()];
    if (!sound) {
      err(
        letterTok,
        /^[A-Za-z]$/.test(letterTok.ch)
          ? `Unknown sound '${letterTok.ch}'`
          : `Unexpected character '${letterTok.ch}'`,
      );
      return false;
    }
    const vel = ghost ? VELOCITY.ghost : letterTok.ch === letterTok.ch.toUpperCase() ? VELOCITY.accent : VELOCITY.normal;
    hits.set(sound, Math.max(hits.get(sound) ?? 0, vel));
    return true;
  };

  while (i < toks.length) {
    const t = toks[i]!;
    const start = i;
    if (t.ch === '|') {
      i++; // bar lines are cosmetic
    } else if (t.ch === '[') {
      if (bracket) {
        err(t, 'Nested repeats are not supported');
      } else {
        bracket = [];
        bracketStart = t;
      }
      i++;
    } else if (t.ch === ']') {
      i++;
      if (!bracket) {
        err(t, "Unexpected ']' without matching '['");
        continue;
      }
      const star = toks[i];
      let n = NaN;
      if (!star || star.ch !== '*') {
        err(t, "Repeat needs '*N' after ']', e.g. ]*2");
      } else {
        i++;
        let digits = '';
        while (toks[i] && /^[0-9]$/.test(toks[i]!.ch)) digits += toks[i++]!.ch;
        if (digits === '') err(star, "Expected a repeat count after '*'");
        else {
          n = parseInt(digits, 10);
          if (n < 1 || n > MAX_REPEAT) {
            err(star, `Repeat count must be between 1 and ${MAX_REPEAT}`);
            n = NaN;
          }
        }
      }
      const content = bracket;
      bracket = null;
      bracketStart = null;
      if (!Number.isNaN(n)) for (let r = 0; r < n; r++) top.push(...content);
    } else {
      // One step: a rest, or hits written together (until whitespace, `|`, `[` or `]`).
      const hits = new Map<SoundId, number>();
      let rests = 0;
      let plusReported = false;
      while (i < toks.length) {
        const c = toks[i]!;
        if (i > start && (c.brk || c.ch === '|' || c.ch === '[' || c.ch === ']')) break;
        if (c.ch === '-' || c.ch === '.') {
          rests++;
          i++;
        } else if (c.ch === '+') {
          if (!plusReported) err(c, 'Use letters together for hits at the same time, e.g. kh (no +)');
          plusReported = true;
          i++;
        } else parseHit(hits);
      }
      if (rests > 0 && hits.size > 0) err(t, 'A step is either a rest (.) or hits');
      else if (rests > 1) err(t, 'Separate rests with spaces, e.g. . . .');
      target().push({ kind: 'step', hits, line: t.line, col: t.col });
    }
  }
  if (bracket && bracketStart) err(bracketStart, "Missing ']*N' to close this repeat");

  // `|` is cosmetic. Work out how coarsely the text is written: d tokens per beat, d dividing steps/beat.
  const spb = opts.stepsPerBeat;
  const ds = densities(spb);
  const tokens = top;
  const T = tokens.length;
  const current = opts.timeSig.num;
  // The text matches the current length at some resolution; otherwise it is full resolution and the length follows it.
  let d = ds.find((x) => T === current * x) ?? spb;
  if (T === 0) d = spb;
  const beats = T === 0 ? current : Math.ceil(T / d);
  const tokenTicks = stepTicks(opts.timeSig, spb) * (spb / d);
  const notes: Partial<Record<SoundId, NoteEvent[]>> = {};
  let overflowReported = false;
  tokens.forEach((item, idx) => {
    if (!overflowReported && Math.floor(idx / d) >= PATTERN_LIMITS.maxBeats) {
      err(item, `Too many beats: maximum is ${PATTERN_LIMITS.maxBeats}`);
      overflowReported = true;
    }
    for (const [sound, vel] of item.hits) (notes[sound] ??= []).push({ tick: Math.round(idx * tokenTicks), vel });
  });

  const warnings: string[] = [];
  if (T % d !== 0) {
    const pad = beats * d - T;
    warnings.push(`Padded ${pad} rest${pad === 1 ? '' : 's'} to complete beat ${beats}`);
  }
  if (errors.length > 0) return { ok: false, errors };
  if (beats > PATTERN_LIMITS.maxBeats) {
    return { ok: false, errors: [{ line: 1, col: 1, message: `Too many beats: maximum is ${PATTERN_LIMITS.maxBeats}` }] };
  }
  return { ok: true, notes, beats, steps: T, resolution: resolutionOf(d, spb), warnings };
}

/**
 * Writes a pattern as text at the COARSEST resolution that represents every note exactly: an 8th-note
 * groove prints 2 tokens per beat, a 16th-note one 4, a triplet one 3; one line per 4 beats. Notes that are off
 * the grid cannot be written and are counted in `droppedOffGrid`.
 */
export function formatBeatText(p: Pattern): { text: string; droppedOffGrid: number; resolution: Resolution } {
  const st = stepTicks(p.timeSig, p.stepsPerBeat);
  const spb = p.stepsPerBeat;
  const totalSteps = p.timeSig.num * p.bars * spb;
  const grid = new Map<number, Map<SoundId, number>>();
  let dropped = 0;
  for (const id of SOUND_IDS) {
    for (const n of p.notes[id] ?? []) {
      if (n.tick % st !== 0) {
        dropped++;
        continue;
      }
      const s = n.tick / st;
      if (s >= totalSteps) continue;
      let m = grid.get(s);
      if (!m) grid.set(s, (m = new Map()));
      m.set(id, n.vel);
    }
  }
  // Coarsest d (tokens per beat) such that every note sits on a multiple of spb/d steps.
  const ds = densities(spb).reverse();
  const d = ds.find((x) => [...grid.keys()].every((s) => s % (spb / x) === 0)) ?? spb;
  const unit = spb / d;
  const lines: string[] = [];
  const total = p.timeSig.num * p.bars;
  const beatTexts: string[] = [];
  for (let beat = 0; beat < total; beat++) {
    const tokens: string[] = [];
    for (let j = 0; j < d; j++) {
      const m = grid.get(beat * spb + j * unit);
      if (!m || m.size === 0) {
        tokens.push('.');
        continue;
      }
      const parts: string[] = [];
      for (const id of SOUND_IDS) {
        const vel = m.get(id);
        if (vel === undefined) continue;
        const letter = SOUNDS[id].letter;
        const lvl = velocityLevel(vel);
        parts.push(lvl === 'accent' ? letter.toUpperCase() : lvl === 'ghost' ? `(${letter})` : letter);
      }
      tokens.push(parts.join(''));
    }
    beatTexts.push(tokens.join(' '));
  }
  // One space between tokens, two between beats (one when each beat is a single token); a line per 4 beats.
  for (let k = 0; k < beatTexts.length; k += 4) lines.push(`${beatTexts.slice(k, k + 4).join(d > 1 ? '  ' : ' ')} |`);
  return { text: lines.join('\n'), droppedOffGrid: dropped, resolution: resolutionOf(d, spb) };
}

export function applyBeatText(
  p: Pattern,
  text: string,
  now: number = Date.now(),
): { ok: true; pattern: Pattern; warnings: string[] } | { ok: false; errors: NotationError[] } {
  const r = parseBeatText(text, { timeSig: p.timeSig, stepsPerBeat: p.stepsPerBeat });
  if (!r.ok) return r;
  return { ok: true, pattern: { ...p, timeSig: { num: r.beats, den: 4 }, bars: 1, notes: r.notes, updatedAt: now }, warnings: r.warnings };
}
