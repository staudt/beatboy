import { describe, it, expect } from 'vitest';
import { applyBeatText, formatBeatText, parseBeatText, stepsCaption } from '../../src/domain/notation';
import { createPattern, setSteps } from '../../src/domain/patternOps';
import { SOUND_IDS, VELOCITY, type NoteEvent, type Pattern, type SoundId } from '../../src/domain/types';
import { patternSteps, patternTicks, stepTicks } from '../../src/domain/time';

/** Every token is one square: a 16th (spb 4) or a triplet step (spb 3). */
const p4 = (text: string) => parseBeatText(text, { stepsPerBeat: 4 });
const p2 = p4;
const p3 = (text: string) => parseBeatText(text, { stepsPerBeat: 3 });

function ok(r: ReturnType<typeof parseBeatText>) {
  if (!r.ok) throw new Error('expected ok: ' + JSON.stringify(r.errors));
  return r;
}
function fail(r: ReturnType<typeof parseBeatText>) {
  if (r.ok) throw new Error('expected failure');
  return r.errors;
}
const ticks = (notes: Partial<Record<SoundId, NoteEvent[]>>, s: SoundId) => notes[s]?.map((n) => n.tick);

describe('tokens', () => {
  it('spaces separate steps; letters together sound together', () => {
    const r = ok(p4('kh . sh .'));
    expect(r.steps).toBe(4);
    expect(ticks(r.notes, 'kick')).toEqual([0]);
    expect(ticks(r.notes, 'snare')).toEqual([240]);
    expect(ticks(r.notes, 'hatClosed')).toEqual([0, 240]);
  });
  it('three sounds in one step', () => {
    const r = ok(p4('ksh . . .'));
    expect(ticks(r.notes, 'kick')).toEqual([0]);
    expect(ticks(r.notes, 'snare')).toEqual([0]);
    expect(ticks(r.notes, 'hatClosed')).toEqual([0]);
  });
  it('. and - are rests; multiple spaces equal one', () => {
    const a = ok(p4('k - k .'));
    const b = ok(p4('k   -\t\tk    .'));
    expect(a.notes).toEqual(b.notes);
    expect(a.steps).toBe(4);
  });
  it('letters: h and x closed hat, o open hat, b kick, case-insensitive lookup', () => {
    const r = ok(p4('h x o b'));
    expect(ticks(r.notes, 'hatClosed')).toEqual([0, 120]);
    expect(ticks(r.notes, 'hatOpen')).toEqual([240]);
    expect(ticks(r.notes, 'kick')).toEqual([360]);
    expect(ok(p4('B . . .')).notes.kick).toEqual([{ tick: 0, vel: VELOCITY.accent }]);
  });
  it('accents and ghosts inside a token', () => {
    const r = ok(p4('Kh . k(s) (s)'));
    expect(r.notes.kick).toEqual([{ tick: 0, vel: VELOCITY.accent }, { tick: 240, vel: VELOCITY.normal }]);
    expect(r.notes.hatClosed).toEqual([{ tick: 0, vel: VELOCITY.normal }]);
    expect(r.notes.snare).toEqual([{ tick: 240, vel: VELOCITY.ghost }, { tick: 360, vel: VELOCITY.ghost }]);
  });
  it('same sound twice in a token keeps max', () => {
    expect(ok(p4('kK(k) . . .')).notes.kick).toEqual([{ tick: 0, vel: VELOCITY.accent }]);
    expect(ok(p4('(k)k . . .')).notes.kick![0]!.vel).toBe(VELOCITY.normal);
  });
  it('| is cosmetic: standalone or touching tokens', () => {
    const plain = ok(p4('kh h sh h'));
    expect(ok(p4('| kh h | sh h |')).notes).toEqual(plain.notes);
    expect(ok(p4('kh|h sh|h|')).notes).toEqual(plain.notes);
    expect(ok(p4('|kh h||sh h||')).notes).toEqual(plain.notes);
  });
  it('comments and newlines', () => {
    const r = ok(p4('# my beat\nkh h  # first\nsh\th # trailing [ ( ?'));
    expect(r.steps).toBe(4);
    expect(r.notes.snare).toHaveLength(1);
    const e = ok(p4('  # nothing \n'));
    expect(e).toMatchObject({ beats: 0, steps: 0, notes: {} });
    expect(ok(p4('k . k .\r\ns . s .\r\n')).steps).toBe(8);
  });
});

describe('every step is one square; the loop is as long as the text', () => {
  it('kh h hs h = 4 steps (one beat), 16ths', () => {
    const r = ok(p4('kh h hs h'));
    expect(r).toMatchObject({ steps: 4, beats: 1, warnings: [] });
    expect(ticks(r.notes, 'hatClosed')).toEqual([0, 120, 240, 360]);
    expect(ticks(r.notes, 'snare')).toEqual([240]);
  });
  it('s k s = 3 steps (no padding, no warning)', () => {
    const r = ok(p4('s k s'));
    expect(r).toMatchObject({ steps: 3, beats: 0.75, warnings: [] });
    expect(ticks(r.notes, 'snare')).toEqual([0, 240]);
    expect(ticks(r.notes, 'kick')).toEqual([120]);
  });
  it('an 8th groove is written with dots: 8 steps = 2 beats', () => {
    const r = ok(p4('kh . h .  sh . h .'));
    expect(r.steps).toBe(8);
    expect(ticks(r.notes, 'kick')).toEqual([0]);
    expect(ticks(r.notes, 'snare')).toEqual([480]);
  });
  it('bar lines and double spaces do not change the result', () => {
    const plain = ok(p4('kh . sh . kh . sh .'));
    expect(ok(p4('| kh . sh . kh . sh . |')).notes).toEqual(plain.notes);
    expect(ok(p4('kh .  sh .  kh .  sh . |')).steps).toBe(8);
  });
  it('triplet feel: each step is a triplet square (160 ticks)', () => {
    const r = ok(p3('k . . s . . k . . s . . |'));
    expect(r).toMatchObject({ steps: 12, beats: 4 });
    expect(ticks(r.notes, 'snare')).toEqual([3 * 160, 9 * 160]);
    expect(ok(p3('k s')).steps).toBe(2);
    expect(ok(p3('k . h h . s')).beats).toBe(2);
  });
  it('a long pattern of up to 32 beats', () => {
    expect(ok(p4(Array(128).fill('k').join(' '))).steps).toBe(128);
    expect(ok(p3(Array(96).fill('k').join(' '))).beats).toBe(32);
  });
});

describe('repeats', () => {
  it('[..]*2', () => {
    const r = ok(p2('[kh h sh h]*2'));
    expect(r.beats).toBe(2);
    expect(r.steps).toBe(8);
    expect(ticks(r.notes, 'kick')).toEqual([0, 480]);
    expect(ticks(r.notes, 'snare')).toEqual([240, 720]);
  });
  it('[kh .]*4 |', () => {
    const r = ok(p2('[kh .]*4 |'));
    expect(r.steps).toBe(8);
    expect(r.beats).toBe(2);
    expect(r.notes.kick).toHaveLength(4);
  });
  it('whitespace around *', () => {
    expect(ok(p2('[ k h ] * 4')).steps).toBe(8);
  });
  it('bar lines inside and across repeats are ignored', () => {
    expect(ok(p2('[k . . .]*2 | [h . . .]*2 |')).steps).toBe(16);
    expect(ok(p2('[k . h . k . h . |]*2')).beats).toBe(4);
  });
  it('brackets may touch tokens', () => {
    const r = ok(p2('[kh . sh .]*2'));
    expect(r).toMatchObject({ steps: 8, beats: 2 });
    expect(r.notes).toEqual(ok(p2('[ kh . sh . ]*2')).notes);
    expect(ok(p2('[kh|.|sh|.|]*2')).notes).toEqual(r.notes);
  });
  it('missing *N', () => {
    const e = fail(p2('[kh] k'));
    expect(e[0]!.message).toMatch(/\*N/);
    expect(e[0]).toMatchObject({ line: 1, col: 4 });
  });
  it('missing count after *', () => {
    expect(fail(p2('[kh]* k'))[0]!.message).toMatch(/count/);
  });
  it('nested', () => {
    const e = fail(p2('[k[h]*2]*2'));
    expect(e.some((x) => /[Nn]ested/.test(x.message))).toBe(true);
  });
  it('N=0, N=65, N=64', () => {
    expect(fail(p2('[k]*0'))[0]!.message).toMatch(/between 1 and 64/);
    expect(fail(p2('[k]*65'))[0]!.message).toMatch(/between 1 and 64/);
    expect(ok(p2('[k]*64')).steps).toBe(64);
  });
  it('unmatched brackets', () => {
    expect(fail(p2('k ] x'))[0]).toMatchObject({ line: 1, col: 3 });
    expect(fail(p2('k [ x'))[0]).toMatchObject({ line: 1, col: 3 });
  });
});

describe('errors', () => {
  it('unknown letter with line/col, also inside a token', () => {
    expect(fail(p4('# c\nk . k .\n  k q . .'))).toEqual([{ line: 3, col: 5, message: "Unknown sound 'q'" }]);
    expect(fail(p4('kqh . . .'))).toEqual([{ line: 1, col: 2, message: "Unknown sound 'q'" }]);
  });
  it('collects multiple errors', () => {
    const e = fail(p4('k q . . |\nk y . ?'));
    expect(e.map((x) => [x.line, x.col])).toEqual([[1, 3], [2, 3], [2, 7]]);
    expect(e[2]!.message).toMatch(/Unexpected character '\?'/);
  });
  it('limits errors to 20', () => {
    expect(fail(p4(Array(100).fill('q').join(' '))).length).toBeLessThanOrEqual(20);
  });
  it('+ is not supported', () => {
    const e = fail(p2('k+h . . .'));
    expect(e[0]).toMatchObject({ line: 1, col: 2 });
    expect(e[0]!.message).toBe('Use letters together for hits at the same time, e.g. kh (no +)');
    expect(fail(p2('k + h'))[0]!.message).toMatch(/no \+/);
  });
  it('a step is a rest or hits, not both', () => {
    const e = fail(p4('k . k.'));
    expect(e).toEqual([{ line: 1, col: 5, message: 'A step is either a rest (.) or hits' }]);
    expect(fail(p4('.k . . .'))[0]!.message).toMatch(/either a rest/);
    expect(fail(p4('k . .. k'))[0]!.message).toMatch(/Separate rests/);
  });
  it('ghost syntax errors', () => {
    expect(fail(p2('(k h'))[0]!.message).toMatch(/\)/);
    expect(fail(p2('( ) h'))[0]!.message).toMatch(/\(/);
  });
  it('bad repeat reports line/col', () => {
    expect(fail(p2('k [h .] s'))[0]).toMatchObject({ line: 1, col: 7 });
  });
  it('too many steps', () => {
    const e = fail(p4(Array(129).fill('k').join(' ')));
    expect(e[0]!.message).toBe('Too many steps: maximum is 128 (32 beats)');
    expect(fail(p3(Array(97).fill('k').join(' ')))[0]!.message).toBe('Too many steps: maximum is 96 (32 beats)');
    expect(ok(p4(Array(128).fill('k').join(' '))).beats).toBe(32);
  });
});

describe('formatBeatText', () => {
  const rock = (): Pattern => {
    const notes: Pattern['notes'] = { kick: [], snare: [], hatClosed: [] };
    for (let i = 0; i < 8; i++) notes.hatClosed!.push({ tick: i * 240, vel: 96 });
    for (const i of [0, 4, 5]) notes.kick!.push({ tick: i * 240, vel: 96 });
    for (const i of [2, 6]) notes.snare!.push({ tick: i * 240, vel: 96 });
    return createPattern({ stepsPerBeat: 4, notes }, 0);
  };
  it('always prints one token per square (8th rock gets dots)', () => {
    expect(formatBeatText(rock())).toEqual({ text: 'kh . h .  sh . h .  kh . kh .  sh . h . |', droppedOffGrid: 0 });
  });
  it('16ths', () => {
    const p = createPattern({
      notes: {
        kick: [{ tick: 0, vel: 96 }],
        hatClosed: [0, 2, 4, 6, 7].map((i) => ({ tick: i * 120, vel: 96 })),
        snare: [{ tick: 480, vel: 96 }],
      },
    });
    expect(formatBeatText(p).text).toBe('kh . h .  sh . h h  . . . .  . . . . |');
    expect(ok(p4(formatBeatText(p).text)).notes).toEqual(p.notes);
  });
  it('hits of a step come in sound order with canonical letters', () => {
    const p = createPattern({ notes: { hatClosed: [{ tick: 0, vel: 96 }], kick: [{ tick: 0, vel: 96 }], sidestick: [{ tick: 0, vel: 96 }] } });
    expect(formatBeatText(p).text).toBe('kjh . . .  . . . .  . . . .  . . . . |');
  });
  it('accent / ghost / lines of four beats / empty', () => {
    const p = createPattern({
      timeSig: { num: 8, den: 4 },
      notes: {
        snare: [{ tick: 0, vel: 40 }],
        kick: [{ tick: 0, vel: 127 }, { tick: 1920, vel: 96 }],
        crash: [{ tick: 1920 + 480, vel: 120 }],
      },
    });
    const dots = '. . . .  . . . .  . . . .';
    expect(formatBeatText(p).text).toBe(`K(s) . . .  ${dots} |\nk . . .  C . . .  . . . .  . . . . |`);
    expect(formatBeatText(createPattern()).text).toBe('. . . .  . . . .  . . . .  . . . . |');
  });
  it('a partial last beat prints only its squares', () => {
    const p = setSteps(createPattern({ notes: { snare: [{ tick: 0, vel: 96 }, { tick: 240, vel: 96 }], kick: [{ tick: 120, vel: 96 }] } }, 0), 3, 0);
    expect(formatBeatText(p).text).toBe('s k s |');
    expect(formatBeatText(p, { lineBreaks: false }).text).toBe('s k s');
    const seven = setSteps(p, 7, 0);
    expect(formatBeatText(seven, { lineBreaks: false }).text).toBe('s k s .  . . .');
  });
  it('drops off-grid notes', () => {
    const p = createPattern({ notes: { kick: [{ tick: 0, vel: 96 }, { tick: 50, vel: 96 }] } });
    const f = formatBeatText(p);
    expect(f.droppedOffGrid).toBe(1);
    expect(f.text.startsWith('k . . .')).toBe(true);
  });
});

describe('applyBeatText', () => {
  it('replaces notes, keeps the rest', () => {
    const p = createPattern({ name: 'Keep', mix: { kick: { gain: 0.5, muted: true } }, notes: { ride: [{ tick: 0, vel: 96 }] } }, 1);
    const before = structuredClone(p);
    const r = applyBeatText(p, 'kh . h .  sh . h .  kh . kh .  sh . h .', 99);
    if (!r.ok) throw new Error('fail');
    expect(r.pattern.timeSig).toEqual({ num: 4, den: 4 });
    expect(r.pattern.bars).toBe(1);
    expect(r.pattern.notes.ride).toBeUndefined();
    expect(r.pattern.mix).toEqual(p.mix);
    expect(r.pattern.name).toBe('Keep');
    expect(r.pattern.updatedAt).toBe(99);
    expect(r.warnings).toEqual([]);
    expect(p).toEqual(before);
  });
  it('the loop becomes exactly as long as the text', () => {
    const p = createPattern();
    const r = applyBeatText(p, 'k . . . '.repeat(12), 99); // 48 steps
    if (!r.ok) throw new Error('fail');
    expect(r.pattern.timeSig.num).toBe(12);
    expect(r.pattern.steps).toBeUndefined();
    const three = applyBeatText(p, 's k s', 99);
    if (!three.ok) throw new Error('fail');
    expect(three.pattern).toMatchObject({ steps: 3, timeSig: { num: 1, den: 4 }, bars: 1 });
    expect(patternSteps(three.pattern)).toBe(3);
    expect(patternTicks(three.pattern)).toBe(360);
    const eight = applyBeatText(p, 'k . s . k . s .', 99);
    if (!eight.ok) throw new Error('fail');
    expect(eight.pattern.timeSig.num).toBe(2); // 8 steps = 2 beats, not 4
    expect(patternTicks(eight.pattern)).toBe(960);
  });
  it('empty text clears the notes and keeps the length', () => {
    const p = createPattern({ timeSig: { num: 3, den: 4 }, notes: { kick: [{ tick: 0, vel: 96 }] } });
    const r = applyBeatText(p, '  # nothing\n', 5);
    if (!r.ok) throw new Error('fail');
    expect(r.pattern.notes).toEqual({});
    expect(r.pattern.timeSig.num).toBe(3);
  });
  it('reports errors', () => {
    const r = applyBeatText(createPattern(), 'q');
    expect(r.ok).toBe(false);
  });
});

describe('round trip', () => {
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  it('parse(format(p)) reproduces notes and steps (300 random patterns, 1..128 straight / 1..96 triplet steps)', () => {
    const rand = rng(12345);
    const pick = <T,>(a: readonly T[]): T => a[Math.floor(rand() * a.length)]!;
    const vels = [VELOCITY.ghost, VELOCITY.normal, VELOCITY.accent];
    for (let n = 0; n < 300; n++) {
      const stepsPerBeat = pick([3, 4] as const);
      const steps = 1 + Math.floor(rand() * (stepsPerBeat === 4 ? 128 : 96));
      const p = setSteps(createPattern({ stepsPerBeat }, 0), steps, 0);
      expect(patternSteps(p)).toBe(steps);
      const st = stepTicks(p.timeSig, stepsPerBeat);
      const density = rand();
      const notes: Pattern['notes'] = {};
      for (const id of SOUND_IDS) {
        if (rand() < 0.5) continue;
        const arr: NoteEvent[] = [];
        for (let s = 0; s < steps; s++) if (rand() < density * 0.5) arr.push({ tick: s * st, vel: pick(vels) });
        if (arr.length) notes[id] = arr;
      }
      p.notes = notes;
      for (const lineBreaks of [true, false]) {
        const f = formatBeatText(p, { lineBreaks });
        expect(f.droppedOffGrid).toBe(0);
        const r = parseBeatText(f.text, { stepsPerBeat });
        if (!r.ok) throw new Error(`case ${n}: ${f.text}\n${JSON.stringify(r.errors)}`);
        expect(r.notes).toEqual(notes);
        expect(r.steps).toBe(steps);
        const back = applyBeatText(p, f.text, 0);
        if (!back.ok) throw new Error('apply');
        expect(patternSteps(back.pattern)).toBe(steps);
        expect(back.pattern.notes).toEqual(notes);
      }
    }
  });
  it('puts four beats on a line', () => {
    const p = createPattern({ timeSig: { num: 6, den: 4 }, notes: { kick: [{ tick: 0, vel: 96 }, { tick: 2400, vel: 96 }] } }, 0);
    const lines = formatBeatText(p).text.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('k . . .  . . . .  . . . .  . . . . |');
    expect(lines[1]).toBe('. . . .  k . . . |'); // tick 2400 = step 20 = beat 6, square 1
  });
  it('stepsCaption', () => {
    expect(stepsCaption(4, 4)).toBe('4 steps · 1 beat');
    expect(stepsCaption(3, 4)).toBe('3 steps');
    expect(stepsCaption(16, 4)).toBe('16 steps · 4 beats');
    expect(stepsCaption(12, 3)).toBe('12 steps · 4 beats (triplets)');
    expect(stepsCaption(2, 3)).toBe('2 steps (triplets)');
  });
});

describe('formatBeatText beatsPerLine', () => {
  it('breaks lines on beat boundaries every N beats and still round-trips', async () => {
    const { createPattern } = await import('../../src/domain/patternOps');
    const base = createPattern({ timeSig: { num: 6, den: 4 }, stepsPerBeat: 4 }, 0);
    const res = applyBeatText(base, 'kh . h .  sh . h .  kh . kh .  sh . h .  k . . .  s . . .', 0);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const two = formatBeatText(res.pattern, { beatsPerLine: 2 }).text;
    expect(two.split('\n')).toEqual(['kh . h .  sh . h . |', 'kh . kh .  sh . h . |', 'k . . .  s . . . |']);
    const back = applyBeatText(res.pattern, two, 0);
    expect(back.ok && back.pattern.notes).toEqual(res.pattern.notes);
  });
});
