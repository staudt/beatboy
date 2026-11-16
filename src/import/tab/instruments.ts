import { VELOCITY, type SoundId } from '../../domain/types';
import type { Notes } from './confidence';
import { normLabel, type Legend } from './legend';
import type { InstKind } from './types';

/** A resolved row label. */
export interface Inst {
  kind: InstKind;
  /** First letter of the written label, lowercase: a hit written with it is a plain hit ("S" on the S row). */
  letter: string;
}

const T = (kind: InstKind, ...names: string[]): [string, InstKind][] => names.map((n) => [n, kind]);

const LABELS = new Map<string, InstKind>([
  ...T('kick', 'b', 'bd', 'bd1', 'bd2', 'b1', 'b2', 'k', 'kd', 'kick', 'kickdrum', 'bass', 'bassdrum', 'bdr', 'bassdrum1', 'bassdrum2', 'kik'),
  ...T('snare', 's', 'sd', 'sn', 'snr', 'snare', 'sna', 'snaredrum', 'sd1', 'sn1', 'snr1'),
  ...T('sidestick', 'rs', 'ss', 'rim', 'rimshot', 'stick', 'stk', 'sidestick', 'xs', 'rimclick'),
  ...T('clap', 'cl', 'clap', 'handclap', 'clp'),
  ...T('hat', 'h', 'hh', 'hihat', 'hat', 'hc', 'hhc', 'hhclosed', 'hihats', 'hhat', 'hhcl', 'hat1', 'hihatclosed', 'closedhat', 'closedhihat'),
  ...T('hatOpenLine', 'ho', 'oh', 'hho', 'hhopen', 'openhat', 'hatopen', 'hihatopen', 'openhihat'),
  ...T('hatPedal', 'hf', 'hp', 'fh', 'ph', 'pedal', 'hhp', 'hhf', 'hatfoot', 'hihatpedal', 'hihatfoot', 'hhpedal', 'footpedal', 'hatpedal', 'foot', 'hhfoot'),
  ...T('crash', 'c', 'cc', 'cr', 'cy', 'c1', 'crash', 'cym', 'cymbal', 'crashcymbal', 'cr1', 'cy1', 'crash1'),
  ...T('crash2', 'c2', 'c3', 'ch', 'chi', 'china', 'chn', 'sp', 'spl', 'splash', 'cr2', 'cy2', 'crash2', 'crash3'),
  ...T('ride', 'r', 'rd', 'ri', 'rc', 'rid', 'ride', 'ridecymbal', 'rcy', 'rd1', 'r1'),
  ...T('rideBell', 'rb', 'bell', 'ridebell', 'rdb'),
  ...T('tomHigh', 'ht', 'hitom', 'hightom', 'tom1', 't1', 'htom', 'tomh'),
  ...T('tomMid', 'mt', 'midtom', 'tom2', 't2', 'tm', 'mtom', 'tomm', 't', 'tt', 'tom', 'toms'),
  ...T('tomFloor', 'lt', 'lowtom', 'tom3', 't3', 'ft', 'floor', 'floortom', 'f1', 'f2', 'fl', 'flt', 'tfl', 'ft1', 'ft2', 't4', 'tom4', 'ltom', 'tomf', 'tomfloor'),
  ...T('cowbell', 'cb', 'cow', 'cowbell'),
  ...T('tambourine', 'ta', 'tamb', 'tmb', 'tambourine', 'tam', 'tmbn'),
]);

/** True when the label could be a drum label at all (used to tell drum rows from guitar rows and prose). */
export const isKnownLabel = (label: string): boolean => {
  const n = normLabel(label);
  return LABELS.has(n) || n === 'f' || n === 'p';
};

export interface LabelContext {
  /** Normalised labels of all rows of the system. */
  labels: ReadonlySet<string>;
  legend: Legend;
  notes: Notes;
}

const CHINA = new Set(['ch', 'chi', 'china', 'chn']);
const SPLASH = new Set(['sp', 'spl', 'splash']);

/** Row label -> instrument, or null when it is not an instrument Beatboy has. */
export function resolveLabel(raw: string, ctx: LabelContext): Inst | null {
  const n = normLabel(raw);
  if (n === '') return null;
  const letter = n[0]!;
  const fromLegend = ctx.legend.labels.get(n);
  if (fromLegend) return { kind: fromLegend, letter };
  if (n === 'f') {
    // Floor tom, unless the system also has an FT row: then it is the hi-hat foot (docs/tab-formats.md 1.2).
    const foot = ctx.labels.has('ft') || ctx.labels.has('flt') || ctx.labels.has('floortom');
    ctx.notes.add(
      foot
        ? `Row F is ambiguous: read as the hi-hat foot because the system also has an FT row (add a legend line to say otherwise)`
        : `Row F is ambiguous: read as the floor tom (add a legend line to say otherwise)`,
      0.1,
      'ambiguous-F',
    );
    return { kind: foot ? 'hatPedal' : 'tomFloor', letter };
  }
  if (n === 'p') {
    const hasHat = [...ctx.labels].some((l) => LABELS.get(l) === 'hat');
    return hasHat ? { kind: 'hatPedal', letter } : null;
  }
  const kind = LABELS.get(n);
  if (!kind) return null;
  if (CHINA.has(n)) ctx.notes.add('China cymbal mapped to Crash 2', 0);
  if (SPLASH.has(n)) ctx.notes.add('Splash cymbal mapped to Crash 2', 0);
  return { kind, letter };
}

// ── hit characters ───────────────────────────────────────────────

const SOUND_OF: Record<InstKind, SoundId> = {
  kick: 'kick',
  snare: 'snare',
  sidestick: 'sidestick',
  clap: 'clap',
  hat: 'hatClosed',
  hatOpenLine: 'hatOpen',
  hatPedal: 'hatPedal',
  crash: 'crash',
  crash2: 'crash2',
  ride: 'ride',
  rideBell: 'rideBell',
  tomHigh: 'tomHigh',
  tomMid: 'tomMid',
  tomFloor: 'tomFloor',
  tambourine: 'tambourine',
  cowbell: 'cowbell',
};

export interface Hit {
  sound: SoundId;
  vel: number;
}

export interface RowContext {
  inst: Inst;
  /** Distinct characters of the row (lowercase). */
  chars: ReadonlySet<string>;
  legend: Legend;
  notes: Notes;
  /** Unusual characters met in grids (reported once per tab). */
  strays: Set<string>;
}

const RESTS = new Set(['-', '.', '_', ' ']);
const STRAY_RESTS = new Set(['?', '~', ';', ',', "'", '`', ':', '!', '"', '/', '\\', '(', ')', '[', ']', '{', '}', '<']);
const ACCENT_MARKS = new Set(['X', 'O', '*', '^', '>']);
const ORNAMENTS = new Set(['f', 'd', 'b', 'r', 'z']);
const TOMS = new Set<InstKind>(['tomHigh', 'tomMid', 'tomFloor']);

/** One written character on a row -> the hit it stands for (null = rest). */
export function mapHit(ch: string, rc: RowContext): Hit | null {
  if (RESTS.has(ch)) return null;
  if (STRAY_RESTS.has(ch)) {
    rc.strays.add(ch);
    return null;
  }
  const { inst } = rc;
  const lower = ch.toLowerCase();
  const isLetter = /[A-Za-z]/.test(ch);
  const own = isLetter && lower === inst.letter;
  const accent = !own && ACCENT_MARKS.has(ch);
  const vel = accent ? VELOCITY.accent : VELOCITY.normal;
  const family = inst.kind;
  const isHat = family === 'hat';
  const isSnareish = family === 'snare' || TOMS.has(family);

  // Legend rules win over the defaults (for their own family of rows).
  for (const r of rc.legend.chars) {
    const same = r.ch === ch || (r.ch === lower && r.ch !== r.ch.toUpperCase());
    if (!same) continue;
    if (r.scope === 'hat' && !isHat && family !== 'hatOpenLine') continue;
    if (r.scope === 'snare' && family !== 'snare') continue;
    switch (r.mode) {
      case 'closed':
        if (isHat) return { sound: 'hatClosed', vel };
        break;
      case 'open':
        if (isHat) return { sound: 'hatOpen', vel };
        break;
      case 'ghost':
        return { sound: SOUND_OF[family], vel: VELOCITY.ghost };
      case 'accent':
        return { sound: SOUND_OF[family], vel: VELOCITY.accent };
      case 'ornament':
        if (isSnareish) {
          rc.notes.add('Flams, drags and rolls simplified to a single hit', 0);
          return { sound: SOUND_OF[family], vel: VELOCITY.normal };
        }
        break;
      case 'rim':
        if (family === 'snare') return { sound: 'sidestick', vel };
        break;
      case 'bell':
        if (family === 'ride') return { sound: 'rideBell', vel };
        break;
      case 'normal':
        return { sound: SOUND_OF[family], vel: VELOCITY.normal };
    }
  }

  if (/[0-9]/.test(ch)) {
    rc.strays.add(ch);
    return { sound: SOUND_OF[family], vel: VELOCITY.normal };
  }

  if (lower === 'g' && !own) return { sound: SOUND_OF[family], vel: VELOCITY.ghost };

  switch (family) {
    case 'hat': {
      const closedMarks = rc.chars.has('x') || rc.chars.has('+');
      if (lower === 'o' && !own) {
        if (closedMarks) return { sound: 'hatOpen', vel };
        rc.notes.add("Hi-hat line uses 'o' for every hit: treated as closed hi-hat", 0);
        return { sound: 'hatClosed', vel };
      }
      return { sound: 'hatClosed', vel };
    }
    case 'ride':
      if (lower === 'b' && !own) return { sound: 'rideBell', vel };
      return { sound: 'ride', vel };
    case 'snare':
    case 'tomHigh':
    case 'tomMid':
    case 'tomFloor':
      if (!own && ORNAMENTS.has(lower)) {
        rc.notes.add('Flams, drags and rolls simplified to a single hit', 0);
        return { sound: SOUND_OF[family], vel: VELOCITY.normal };
      }
      if (family === 'snare' && ch === '@') return { sound: 'sidestick', vel: VELOCITY.normal };
      return { sound: SOUND_OF[family], vel };
    default:
      return { sound: SOUND_OF[family], vel };
  }
}
