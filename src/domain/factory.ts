import { applyBeatText } from './notation';
import { createPattern } from './patternOps';
import type { Pattern, PatternKind, TimeSignature } from './types';

/**
 * Built-in starter patterns, written in beat text (see docs/NOTATION.md).
 * Spaces separate steps (letters together sound together); here each group of steps is one beat.
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
  { id: 'f-rock-8ths', name: 'Rock 8ths', category: 'Rock', stepsPerBeat: 4, bpm: 110,
    text: 'kh h  sh h  kh kh  sh h |' },
  { id: 'f-rock-16ths', name: 'Rock 16ths', category: 'Rock', stepsPerBeat: 4, bpm: 96,
    text: 'kh h h h  sh h h h  kh h kh h  sh h h h |' },
  { id: 'f-half-time', name: 'Half-time Rock', category: 'Rock', stepsPerBeat: 4, bpm: 140,
    text: 'kh h  h h  Sh h  h kh |' },
  { id: 'f-punk', name: 'Punk', category: 'Rock', stepsPerBeat: 4, bpm: 180,
    text: 'kh sh  kh sh  kh sh  kh sh |' },
  { id: 'f-ride-rock', name: 'Ride Rock', category: 'Rock', stepsPerBeat: 4, bpm: 120,
    text: 'kr r  sr r  kr kr  sr r |' },
  { id: 'f-ballad', name: 'Sidestick Ballad', category: 'Pop', stepsPerBeat: 4, bpm: 72,
    text: 'kh h  jh h  kh kh  jh h |' },
  { id: 'f-four-floor', name: 'Four on the Floor', category: 'Pop', stepsPerBeat: 4, bpm: 120,
    text: 'k o  ks o  k o  ks o |' },
  { id: 'f-motown', name: 'Motown', category: 'Pop', stepsPerBeat: 4, bpm: 120,
    text: 'ksz .  sz .  ksz k  sz . |' },
  // ── Blues, country, swing ─────────────────────────────────
  { id: 'f-shuffle', name: 'Blues Shuffle', category: 'Blues', stepsPerBeat: 4, swing: 0.67, bpm: 96,
    text: 'kh h  sh h  kh h  sh h |' },
  { id: 'f-slow-blues', name: 'Slow Blues 12/8', category: 'Blues', timeSig: { num: 4, den: 4 }, stepsPerBeat: 3, bpm: 52,
    text: 'kh h h  sh h h  kh h kh  sh h h |' },
  { id: 'f-train', name: 'Country Train', category: 'Blues', stepsPerBeat: 4, bpm: 110,
    text: 'k(s) (s) S (s)  k(s) (s) S (s)  k(s) (s) S (s)  k(s) (s) S (s) |' },
  { id: 'f-jazz-ride', name: 'Jazz Ride', category: 'Jazz', stepsPerBeat: 4, swing: 0.67, bpm: 140,
    text: 'r .  rd r  r .  rd r |' },
  // ── Funk, hip-hop, world ──────────────────────────────────
  { id: 'f-funk-16', name: 'Funk 16', category: 'Funk', stepsPerBeat: 4, bpm: 96,
    text: 'kh . h (s)  Sh . h (s)  h k kh (s)  Sh . h k |' },
  { id: 'f-hip-hop', name: 'Hip-hop', category: 'Funk', stepsPerBeat: 4, swing: 0.58, bpm: 90,
    text: 'kh . h .  sh . h k  kh k h .  sh . h . |' },
  { id: 'f-one-drop', name: 'Reggae One Drop', category: 'World', stepsPerBeat: 4, swing: 0.6, bpm: 75,
    text: 'h h  h h  kjh h  h h |' },
  { id: 'f-bossa', name: 'Bossa Nova', category: 'World', stepsPerBeat: 4, bpm: 130,
    text: 'khj . h kj  kh . hj k  kh . hj k  kh j h k |' },
  // ── Other meters ──────────────────────────────────────────
  { id: 'f-waltz', name: 'Waltz 3/4', category: 'Odd', timeSig: { num: 3, den: 4 }, stepsPerBeat: 4, bpm: 100,
    text: 'kh h  sh h  sh h |' },
  { id: 'f-six-eight', name: '6/8 Ballad', category: 'Odd', timeSig: { num: 2, den: 4 }, stepsPerBeat: 3, bpm: 56,
    text: 'kh h h  sh h h |' },
  { id: 'f-five-four', name: 'Five 5/4', category: 'Odd', timeSig: { num: 5, den: 4 }, stepsPerBeat: 4, bpm: 120,
    text: 'kh h  sh h  kh h  kh h  sh h |' },
  { id: 'f-metal', name: 'Double Kick', category: 'Metal', stepsPerBeat: 4, bpm: 140,
    text: 'kh k k k  ksh k k k  kh k k k  ksh k k k |' },
  // ── Basics ────────────────────────────────────────────────
  { id: 'f-click-only', name: 'No drums (click only)', category: 'Basics', stepsPerBeat: 4, bpm: 100,
    text: '. .  . .  . .  . . |' },
  // ── Fills (1 bar) ─────────────────────────────────────────
  { id: 'f-fill-toms', name: 'Tom Roll', category: 'Fills', kind: 'fill', stepsPerBeat: 4, bpm: 110,
    text: 'kh h sh h  S s t t  m m f f  S t m f |' },
  { id: 'f-fill-snare', name: 'Snare Build', category: 'Fills', kind: 'fill', stepsPerBeat: 4, bpm: 110,
    text: '(s) (s) s s  s s s s  S s S s  S S S S |' },
  { id: 'f-fill-8ths', name: 'Around the Kit', category: 'Fills', kind: 'fill', stepsPerBeat: 4, bpm: 110,
    text: 'kh h  sh h  s t  m f |' },
  { id: 'f-fill-triplet', name: 'Triplet Fill', category: 'Fills', kind: 'fill', stepsPerBeat: 3, bpm: 100,
    text: 'kh h h  sh h h  S t t  m f f |' },
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
