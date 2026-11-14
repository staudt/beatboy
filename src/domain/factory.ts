import { applyBeatText } from './notation';
import { createPattern } from './patternOps';
import type { Pattern, PatternKind, TimeSignature } from './types';

/**
 * Built-in starter patterns, written in beat text (see docs/NOTATION.md).
 * Whitespace is cosmetic; here each group of steps is one beat.
 * IDs are stable ("f-…") so songs can reference factory patterns forever.
 */
interface FactorySpec {
  id: string;
  name: string;
  category: string;
  kind?: PatternKind;
  timeSig?: TimeSignature;
  stepsPerBeat: number;
  swing?: number;
  bpm: number;
  text: string;
}

const T44: TimeSignature = { num: 4, den: 4 };

const SPECS: FactorySpec[] = [
  // ── Rock & pop ────────────────────────────────────────────
  { id: 'f-rock-8ths', name: 'Rock 8ths', category: 'Rock', stepsPerBeat: 2, bpm: 110,
    text: 'k+x x  s+x x  k+x k+x  s+x x |' },
  { id: 'f-rock-16ths', name: 'Rock 16ths', category: 'Rock', stepsPerBeat: 4, bpm: 96,
    text: 'k+x x x x  s+x x x x  k+x x k+x x  s+x x x x |' },
  { id: 'f-half-time', name: 'Half-time Rock', category: 'Rock', stepsPerBeat: 2, bpm: 140,
    text: 'k+x x  x x  S+x x  x k+x |' },
  { id: 'f-punk', name: 'Punk', category: 'Rock', stepsPerBeat: 2, bpm: 180,
    text: 'k+x s+x  k+x s+x  k+x s+x  k+x s+x |' },
  { id: 'f-ride-rock', name: 'Ride Rock', category: 'Rock', stepsPerBeat: 2, bpm: 120,
    text: 'k+r r  s+r r  k+r k+r  s+r r |' },
  { id: 'f-ballad', name: 'Sidestick Ballad', category: 'Pop', stepsPerBeat: 2, bpm: 72,
    text: 'k+x x  j+x x  k+x k+x  j+x x |' },
  { id: 'f-four-floor', name: 'Four on the Floor', category: 'Pop', stepsPerBeat: 2, bpm: 120,
    text: 'k o  k+s o  k o  k+s o |' },
  { id: 'f-motown', name: 'Motown', category: 'Pop', stepsPerBeat: 2, bpm: 120,
    text: 'k+s+z -  s+z -  k+s+z k  s+z - |' },
  // ── Blues, country, swing ─────────────────────────────────
  { id: 'f-shuffle', name: 'Blues Shuffle', category: 'Blues', stepsPerBeat: 2, swing: 0.67, bpm: 96,
    text: 'k+x x  s+x x  k+x x  s+x x |' },
  { id: 'f-slow-blues', name: 'Slow Blues 12/8', category: 'Blues', timeSig: { num: 12, den: 8 }, stepsPerBeat: 1, bpm: 52,
    text: 'k+x x x  s+x x x  k+x x k+x  s+x x x |' },
  { id: 'f-train', name: 'Country Train', category: 'Blues', stepsPerBeat: 4, bpm: 110,
    text: 'k+(s) (s) S (s)  k+(s) (s) S (s)  k+(s) (s) S (s)  k+(s) (s) S (s) |' },
  { id: 'f-jazz-ride', name: 'Jazz Ride', category: 'Jazz', stepsPerBeat: 2, swing: 0.67, bpm: 140,
    text: 'r -  r+d r  r -  r+d r |' },
  // ── Funk, hip-hop, world ──────────────────────────────────
  { id: 'f-funk-16', name: 'Funk 16', category: 'Funk', stepsPerBeat: 4, bpm: 96,
    text: 'k+x - x (s)  S+x - x (s)  x k k+x (s)  S+x - x k |' },
  { id: 'f-hip-hop', name: 'Hip-hop', category: 'Funk', stepsPerBeat: 4, swing: 0.58, bpm: 90,
    text: 'k+x - x -  s+x - x k  k+x k x -  s+x - x - |' },
  { id: 'f-one-drop', name: 'Reggae One Drop', category: 'World', stepsPerBeat: 2, swing: 0.6, bpm: 75,
    text: 'x x  x x  k+j+x x  x x |' },
  { id: 'f-bossa', name: 'Bossa Nova', category: 'World', stepsPerBeat: 4, bpm: 130,
    text: 'k+x+j - x k+j  k+x - x+j k  k+x - x+j k  k+x j x k |' },
  // ── Other meters ──────────────────────────────────────────
  { id: 'f-waltz', name: 'Waltz 3/4', category: 'Odd', timeSig: { num: 3, den: 4 }, stepsPerBeat: 2, bpm: 100,
    text: 'k+x x  s+x x  s+x x |' },
  { id: 'f-six-eight', name: '6/8 Ballad', category: 'Odd', timeSig: { num: 6, den: 8 }, stepsPerBeat: 1, bpm: 56,
    text: 'k+x x x  s+x x x |' },
  { id: 'f-five-four', name: 'Five 5/4', category: 'Odd', timeSig: { num: 5, den: 4 }, stepsPerBeat: 2, bpm: 120,
    text: 'k+x x  s+x x  k+x x  k+x x  s+x x |' },
  { id: 'f-seven-eight', name: 'Seven 7/8', category: 'Odd', timeSig: { num: 7, den: 8 }, stepsPerBeat: 1, bpm: 220,
    text: 'k+x x  s+x x  k+x k+x s+x |' },
  { id: 'f-metal', name: 'Double Kick', category: 'Metal', stepsPerBeat: 4, bpm: 140,
    text: 'k+x k k k  k+s+x k k k  k+x k k k  k+s+x k k k |' },
  // ── Fills (1 bar) ─────────────────────────────────────────
  { id: 'f-fill-toms', name: 'Tom Roll', category: 'Fills', kind: 'fill', stepsPerBeat: 4, bpm: 110,
    text: 'k+x x s+x x  S s t t  m m f f  S t m f |' },
  { id: 'f-fill-snare', name: 'Snare Build', category: 'Fills', kind: 'fill', stepsPerBeat: 4, bpm: 110,
    text: '(s) (s) s s  s s s s  S s S s  S S S S |' },
  { id: 'f-fill-8ths', name: 'Around the Kit', category: 'Fills', kind: 'fill', stepsPerBeat: 2, bpm: 110,
    text: 'k+x x  s+x x  s t  m f |' },
  { id: 'f-fill-triplet', name: 'Triplet Fill', category: 'Fills', kind: 'fill', stepsPerBeat: 3, bpm: 100,
    text: 'k+x x x  s+x x x  S t t  m f f |' },
];

function build(spec: FactorySpec): Pattern {
  const base = createPattern(
    {
      id: spec.id,
      name: spec.name,
      category: spec.category,
      kind: spec.kind ?? 'groove',
      timeSig: spec.timeSig ?? T44,
      stepsPerBeat: spec.stepsPerBeat,
      swing: spec.swing ?? 0.5,
      bpm: spec.bpm,
      builtIn: true,
    },
    0,
  );
  const res = applyBeatText(base, spec.text, 0);
  if (!res.ok) {
    throw new Error(`Factory pattern ${spec.id}: ${res.errors.map((e) => e.message).join('; ')}`);
  }
  return { ...res.pattern, builtIn: true, createdAt: 0, updatedAt: 0 };
}

let cache: Pattern[] | null = null;

/** All built-in patterns (frozen, built once). */
export function factoryPatterns(): readonly Pattern[] {
  cache ??= SPECS.map(build).map((p) => Object.freeze(p));
  return cache;
}

export const FACTORY_SPECS: readonly FactorySpec[] = SPECS;
