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
import { stepTicks, stepsPerBar } from './time';
import { velocityLevel } from './patternOps';

export interface NotationError {
  line: number;
  col: number;
  message: string;
}

export type ParseResult =
  | { ok: true; notes: Partial<Record<SoundId, NoteEvent[]>>; bars: number; steps: number; warnings: string[] }
  | { ok: false; errors: NotationError[] };

interface Tok {
  ch: string;
  line: number;
  col: number;
}

interface StepItem {
  kind: 'step';
  hits: Map<SoundId, number>;
  line: number;
  col: number;
}
interface BarItem {
  kind: 'bar';
  line: number;
  col: number;
}
type Item = StepItem | BarItem;

const MAX_ERRORS = 20;
const MAX_REPEAT = 64;

function tokenize(text: string): Tok[] {
  const toks: Tok[] = [];
  let line = 1;
  let col = 0;
  let inComment = false;
  for (const ch of text) {
    if (ch === '\n') {
      line++;
      col = 0;
      inComment = false;
      continue;
    }
    col++;
    if (ch === '\r') continue;
    if (inComment) continue;
    if (ch === '#') {
      inComment = true;
      continue;
    }
    if (/\s/.test(ch)) continue;
    toks.push({ ch, line, col });
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
    if (t.ch === '-' || t.ch === '.') {
      target().push({ kind: 'step', hits: new Map(), line: t.line, col: t.col });
      i++;
    } else if (t.ch === '|') {
      target().push({ kind: 'bar', line: t.line, col: t.col });
      i++;
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
      // hit group
      const hits = new Map<SoundId, number>();
      parseHit(hits);
      while (toks[i]?.ch === '+') {
        const plus = toks[i]!;
        i++;
        const nxt = toks[i];
        if (!nxt || !(nxt.ch === '(' || /^[A-Za-z]$/.test(nxt.ch))) {
          err(nxt ?? plus, "Expected a sound after '+'");
          break;
        }
        parseHit(hits);
      }
      target().push({ kind: 'step', hits, line: t.line, col: t.col });
    }
  }
  if (bracket && bracketStart) err(bracketStart, "Missing ']*N' to close this repeat");

  // Expand stream into steps, checking bar lines.
  const spb = stepsPerBar(opts.timeSig, opts.stepsPerBeat);
  const st = stepTicks(opts.timeSig, opts.stepsPerBeat);
  const notes: Partial<Record<SoundId, NoteEvent[]>> = {};
  let total = 0;
  let sinceBar = 0;
  let closedBars = 0;
  let overflowReported = false;
  for (const item of top) {
    if (item.kind === 'step') {
      if (!overflowReported && Math.floor(total / spb) >= PATTERN_LIMITS.maxBars) {
        err(item, `Too many bars: maximum is ${PATTERN_LIMITS.maxBars}`);
        overflowReported = true;
      }
      for (const [sound, vel] of item.hits) (notes[sound] ??= []).push({ tick: total * st, vel });
      total++;
      sinceBar++;
    } else {
      if (sinceBar > 0) {
        if (sinceBar !== spb) err(item, `Bar ${closedBars + 1} has ${sinceBar} steps, expected ${spb}`);
        closedBars++;
        sinceBar = 0;
      }
    }
  }

  const warnings: string[] = [];
  const bars = Math.max(1, Math.ceil(total / spb));
  if (total % spb !== 0) {
    const pad = bars * spb - total;
    warnings.push(`Padded ${pad} rest${pad === 1 ? '' : 's'} to complete bar ${bars}`);
  }
  if (errors.length > 0) return { ok: false, errors };
  if (bars > PATTERN_LIMITS.maxBars) {
    return { ok: false, errors: [{ line: 1, col: 1, message: `Too many bars: maximum is ${PATTERN_LIMITS.maxBars}` }] };
  }
  return { ok: true, notes, bars, steps: total, warnings };
}

export function formatBeatText(p: Pattern): { text: string; droppedOffGrid: number } {
  const st = stepTicks(p.timeSig, p.stepsPerBeat);
  const spbeat = p.stepsPerBeat;
  const perBar = stepsPerBar(p.timeSig, p.stepsPerBeat);
  const totalSteps = perBar * p.bars;
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
  const lines: string[] = [];
  for (let b = 0; b < p.bars; b++) {
    const beats: string[] = [];
    for (let beat = 0; beat < p.timeSig.num; beat++) {
      const steps: string[] = [];
      for (let j = 0; j < spbeat; j++) {
        const m = grid.get(b * perBar + beat * spbeat + j);
        if (!m || m.size === 0) {
          steps.push('-');
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
        steps.push(parts.join('+'));
      }
      beats.push(steps.join(' '));
    }
    // One space between steps, two between beats (one when each beat is a single step).
    lines.push(`${beats.join(spbeat > 1 ? '  ' : ' ')} |`);
  }
  return { text: lines.join('\n'), droppedOffGrid: dropped };
}

export function applyBeatText(
  p: Pattern,
  text: string,
  now: number = Date.now(),
): { ok: true; pattern: Pattern; warnings: string[] } | { ok: false; errors: NotationError[] } {
  const r = parseBeatText(text, { timeSig: p.timeSig, stepsPerBeat: p.stepsPerBeat });
  if (!r.ok) return r;
  return { ok: true, pattern: { ...p, notes: r.notes, bars: r.bars, updatedAt: now }, warnings: r.warnings };
}
