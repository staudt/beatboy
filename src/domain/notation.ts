import {
  PATTERN_LIMITS,
  SOUND_IDS,
  VELOCITY,
  type NoteEvent,
  type Pattern,
  type SoundId,
} from './types';
import { LETTER_TO_SOUND, SOUNDS } from './sounds';
import { patternSteps, stepTicks } from './time';
import { maxStepsFor, setSteps, velocityLevel } from './patternOps';

export interface NotationError {
  line: number;
  col: number;
  message: string;
}

export type ParseResult =
  | {
      ok: true;
      notes: Partial<Record<SoundId, NoteEvent[]>>;
      /** Tokens read (rests included) = the loop length in steps: each token is exactly one grid square. 0 for empty text. */
      steps: number;
      /** `steps / stepsPerBeat`, fractional for partial beats (display only). */
      beats: number;
      warnings: string[];
    }
  | { ok: false; errors: NotationError[] };

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

/** Reads beat text: every token is one grid square (a 16th when `stepsPerBeat` is 4, a triplet step when 3) and the loop is exactly as long as the tokens. */
export function parseBeatText(text: string, opts: { stepsPerBeat: number }): ParseResult {
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

  // `|` is cosmetic. One token = one square at its index.
  const spb = opts.stepsPerBeat;
  const tokens = top;
  const T = tokens.length;
  const st = stepTicks({ num: 1, den: 4 }, spb);
  const maxSteps = maxStepsFor(spb);
  if (T > maxSteps) err(tokens[maxSteps]!, `Too many steps: maximum is ${maxSteps} (${PATTERN_LIMITS.maxBeats} beats)`);
  const notes: Partial<Record<SoundId, NoteEvent[]>> = {};
  tokens.forEach((item, idx) => {
    for (const [sound, vel] of item.hits) (notes[sound] ??= []).push({ tick: idx * st, vel });
  });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, notes, steps: T, beats: T / spb, warnings: [] };
}

/**
 * Writes a pattern as text at full resolution: one token per grid square (rests are `.`), a space between tokens,
 * two between beats (the last beat may be partial). Notes that are off the grid cannot be written and are counted in
 * `droppedOffGrid`. By default a line per 4 beats, each ending in ` |`; `lineBreaks: false` gives one bar-line-free line.
 */
/**
 * Grid → text. `lineBreaks: false` gives one line; otherwise a line every `beatsPerLine` beats (default 4;
 * phones use 2 so lines break on beat boundaries instead of wrapping mid-beat).
 */
export function formatBeatText(
  p: Pattern,
  opts: { lineBreaks?: boolean; beatsPerLine?: number } = {},
): { text: string; droppedOffGrid: number } {
  const st = stepTicks(p.timeSig, p.stepsPerBeat);
  const spb = p.stepsPerBeat;
  const totalSteps = patternSteps(p);
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
  const beatTexts: string[] = [];
  for (let b0 = 0; b0 < totalSteps; b0 += spb) {
    const tokens: string[] = [];
    for (let s = b0; s < Math.min(totalSteps, b0 + spb); s++) {
      const m = grid.get(s);
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
  const lines: string[] = [];
  if (opts.lineBreaks === false) lines.push(beatTexts.join('  '));
  else {
    const per = Math.max(1, Math.floor(opts.beatsPerLine ?? 4));
    for (let k = 0; k < beatTexts.length; k += per) lines.push(`${beatTexts.slice(k, k + per).join('  ')} |`);
  }
  return { text: lines.join('\n'), droppedOffGrid: dropped };
}

/** Applies text to a pattern: the loop becomes exactly as long as the typed steps (empty text clears the notes and keeps the length). */
export function applyBeatText(
  p: Pattern,
  text: string,
  now: number = Date.now(),
): { ok: true; pattern: Pattern; warnings: string[] } | { ok: false; errors: NotationError[] } {
  const r = parseBeatText(text, { stepsPerBeat: p.stepsPerBeat });
  if (!r.ok) return r;
  const sized = r.steps === 0 ? p : setSteps(p, r.steps, now);
  return { ok: true, pattern: { ...sized, notes: r.notes, updatedAt: now }, warnings: r.warnings };
}

/** Status text for a loop of `steps` squares: "4 steps · 1 beat", "3 steps", "12 steps · 4 beats (triplets)". */
export function stepsCaption(steps: number, spb: number): string {
  const tail = spb === 3 ? ' (triplets)' : '';
  const n = `${steps} step${steps === 1 ? '' : 's'}`;
  if (steps % spb !== 0) return n + tail;
  const b = steps / spb;
  return `${n} · ${b} beat${b === 1 ? '' : 's'}${tail}`;
}
