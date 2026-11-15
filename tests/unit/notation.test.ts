import { describe, it, expect } from 'vitest';
import { applyBeatText, formatBeatText, parseBeatText } from '../../src/domain/notation';
import { createPattern } from '../../src/domain/patternOps';
import { SOUND_IDS, VELOCITY, type NoteEvent, type Pattern, type SoundId, type TimeSignature } from '../../src/domain/types';
import { patternSteps, stepTicks } from '../../src/domain/time';

const T44 = { num: 4, den: 4 } as const;
const p4 = (text: string) => parseBeatText(text, { timeSig: T44, stepsPerBeat: 4 });
/** 8 tokens per bar are inferred as 8ths on the 16th grid. */
const p2 = (text: string) => parseBeatText(text, { timeSig: T44, stepsPerBeat: 4 });
const p3 = (text: string) => parseBeatText(text, { timeSig: T44, stepsPerBeat: 3 });

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
    expect(r.resolution).toBe('quarters');
    expect(ticks(r.notes, 'kick')).toEqual([0]);
    expect(ticks(r.notes, 'snare')).toEqual([960]);
    expect(ticks(r.notes, 'hatClosed')).toEqual([0, 960]);
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
    expect(ticks(r.notes, 'hatClosed')).toEqual([0, 480]);
    expect(ticks(r.notes, 'hatOpen')).toEqual([960]);
    expect(ticks(r.notes, 'kick')).toEqual([1440]);
    expect(ok(p4('B . . .')).notes.kick).toEqual([{ tick: 0, vel: VELOCITY.accent }]);
  });
  it('accents and ghosts inside a token', () => {
    const r = ok(p4('Kh . k(s) (s)'));
    expect(r.notes.kick).toEqual([{ tick: 0, vel: VELOCITY.accent }, { tick: 960, vel: VELOCITY.normal }]);
    expect(r.notes.hatClosed).toEqual([{ tick: 0, vel: VELOCITY.normal }]);
    expect(r.notes.snare).toEqual([{ tick: 960, vel: VELOCITY.ghost }, { tick: 1440, vel: VELOCITY.ghost }]);
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
    expect(e).toMatchObject({ beats: 4, steps: 0, notes: {} });
    expect(ok(p4('k . k .\r\ns . s .\r\n')).steps).toBe(8);
  });
});

describe('8th-note rock', () => {
  const rock = 'kh h sh h kh kh sh h';
  it('parses as 8ths on the 16th grid', () => {
    const r = ok(p2(rock));
    expect(r).toMatchObject({ beats: 4, steps: 8, resolution: '8ths' });
    expect(ticks(r.notes, 'kick')).toEqual([0, 960, 1200]);
    expect(ticks(r.notes, 'snare')).toEqual([480, 1440]);
    expect(ticks(r.notes, 'hatClosed')).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => i * 240));
  });
  it('bar lines and double spaces do not change the result', () => {
    expect(ok(p2('| ' + rock + ' |'))).toMatchObject({ beats: 4, resolution: '8ths' });
    expect(ok(p2('kh h  sh h  kh kh  sh h |')).notes).toEqual(ok(p2(rock)).notes);
    expect(ok(p2(`${rock} |\n${rock} |`))).toMatchObject({ beats: 4, resolution: '16ths' });
    const eight = parseBeatText(`${rock} |\n${rock} |`, { timeSig: { num: 8, den: 4 }, stepsPerBeat: 4 });
    expect(ok(eight)).toMatchObject({ beats: 8, resolution: '8ths' });
  });
});

describe('repeats', () => {
  it('[..]*2', () => {
    const r = ok(p2('[kh h sh h]*2'));
    expect(r.beats).toBe(4);
    expect(r.steps).toBe(8);
    expect(ticks(r.notes, 'kick')).toEqual([0, 960]);
    expect(ticks(r.notes, 'snare')).toEqual([480, 1440]);
  });
  it('[kh .]*4 |', () => {
    const r = ok(p2('[kh .]*4 |'));
    expect(r.steps).toBe(8);
    expect(r.beats).toBe(4);
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
    expect(r).toMatchObject({ steps: 8, beats: 4 });
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
    expect(ok(p2('[k]*64')).beats).toBe(16); // 64 tokens at 16ths
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
  it('too many beats', () => {
    const e = fail(p4(Array(33 * 4).fill('k').join(' ')));
    expect(e[0]!.message).toBe('Too many beats: maximum is 32');
    expect(ok(p4(Array(32 * 4).fill('k').join(' '))).beats).toBe(32);
  });
});

describe('beat count and resolution inference', () => {
  const at = (text: string, beats: number, spb: number) => parseBeatText(text, { timeSig: { num: beats, den: 4 }, stepsPerBeat: spb });
  it('tokens = beats x d for an allowed d: that d is used (4 beats, straight)', () => {
    expect(ok(at('k s k s', 4, 4))).toMatchObject({ resolution: 'quarters', beats: 4 });
    const e = ok(at('kh h  sh h  kh kh  sh h |', 4, 4));
    expect(e).toMatchObject({ resolution: '8ths', beats: 4 });
    expect(ticks(e.notes, 'kick')).toEqual([0, 960, 1200]);
    expect(ok(at('k . . . k . . . k . . . k . . .', 4, 4))).toMatchObject({ resolution: '16ths', beats: 4 });
  });
  it('the current beat count decides between readings of the same text', () => {
    const text = 'k . s . k . s . k . s . k . s .'; // 16 tokens
    expect(ok(at(text, 4, 4))).toMatchObject({ resolution: '16ths', beats: 4 });
    expect(ok(at(text, 8, 4))).toMatchObject({ resolution: '8ths', beats: 8 });
    expect(ok(at(text, 16, 4))).toMatchObject({ resolution: 'quarters', beats: 16 });
  });
  it('otherwise full resolution; the beat count follows the text', () => {
    const r = ok(at('k . . . k . . . k . . . k . . . k . . . k . . .', 4, 4)); // 24 tokens, not 4 * d
    expect(r).toMatchObject({ resolution: '16ths', beats: 6, warnings: [] });
    const pad = ok(at('k . s . k', 4, 4));
    expect(pad).toMatchObject({ resolution: '16ths', beats: 2 });
    expect(pad.warnings).toEqual(['Padded 3 rests to complete beat 2']);
    expect(ok(at('k', 4, 4)).warnings).toEqual(['Padded 3 rests to complete beat 1']);
  });
  it('triplet feel: 12 tokens = triplets, 4 = quarters (4 beats)', () => {
    const t = ok(at('k . . s . . k . . s . . |', 4, 3));
    expect(t.resolution).toBe('triplets');
    expect(ticks(t.notes, 'snare')).toEqual([3 * 160, 9 * 160]);
    const q = ok(at('k s k s |', 4, 3));
    expect(q.resolution).toBe('quarters');
    expect(ticks(q.notes, 'snare')).toEqual([480, 1440]);
    expect(ok(at('k . s . k . s .', 4, 3))).toMatchObject({ resolution: 'triplets', beats: 3 }); // 8 tokens: 3 beats, padded
  });
  it('2 beats x 3 (6/8 feel)', () => {
    const r = ok(at('k . h h . s', 2, 3));
    expect(r).toMatchObject({ resolution: 'triplets', beats: 2 });
    expect(ticks(r.notes, 'snare')).toEqual([5 * 160]);
  });
  it('3 beats, straight: 6 tokens = 8ths, 3 = quarters', () => {
    const r = ok(at('k . s . k . |', 3, 4));
    expect(r.resolution).toBe('8ths');
    expect(ticks(r.notes, 'snare')).toEqual([480]);
    expect(ok(at('k s k', 3, 4)).resolution).toBe('quarters');
  });
  it('a long pattern of up to 32 beats', () => {
    expect(ok(at('k . '.repeat(32), 32, 4))).toMatchObject({ resolution: '8ths', beats: 32 });
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
  it('8th rock', () => {
    expect(formatBeatText(rock())).toEqual({ text: 'kh h  sh h  kh kh  sh h |', droppedOffGrid: 0, resolution: '8ths' });
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
    expect(formatBeatText(p).resolution).toBe('16ths');
    const r = ok(p4(formatBeatText(p).text));
    expect(r.notes).toEqual(p.notes);
  });
  it('hits of a step come in sound order with canonical letters', () => {
    const p = createPattern({ notes: { hatClosed: [{ tick: 0, vel: 96 }], kick: [{ tick: 0, vel: 96 }], sidestick: [{ tick: 0, vel: 96 }] } });
    expect(formatBeatText(p).text).toBe('kjh . . . |');
  });
  it('accent / ghost / order / multi-bar / empty', () => {
    const p = createPattern({
      timeSig: { num: 8, den: 4 },
      notes: {
        snare: [{ tick: 0, vel: 40 }],
        kick: [{ tick: 0, vel: 127 }, { tick: 1920, vel: 96 }],
        crash: [{ tick: 1920 + 480, vel: 120 }],
      },
    });
    expect(formatBeatText(p).text).toBe('K(s) . . . |\nk C . . |');
    expect(formatBeatText(createPattern()).text).toBe('. . . . |');
  });
  it('drops off-grid notes', () => {
    const p = createPattern({ notes: { kick: [{ tick: 0, vel: 96 }, { tick: 50, vel: 96 }] } });
    const f = formatBeatText(p);
    expect(f.droppedOffGrid).toBe(1);
    expect(f.text).toBe('k . . . |'); // the one note on the grid is a quarter
  });
});

describe('applyBeatText', () => {
  it('replaces notes, keeps the rest', () => {
    const p = createPattern({ name: 'Keep', mix: { kick: { gain: 0.5, muted: true } }, notes: { ride: [{ tick: 0, vel: 96 }] } }, 1);
    const before = structuredClone(p);
    const r = applyBeatText(p, 'kh h sh h kh kh sh h', 99);
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
  it('changes the beat count when the text does not fit the current one', () => {
    const p = createPattern();
    const r = applyBeatText(p, 'k . . . '.repeat(12), 99); // 48 tokens
    if (!r.ok) throw new Error('fail');
    expect(r.pattern.timeSig.num).toBe(12);
    expect(r.pattern.bars).toBe(1);
    expect(r.pattern.stepsPerBeat).toBe(4);
    const e = applyBeatText(createPattern({ timeSig: { num: 8, den: 4 } }), 'k . s . k . s . k . s . k . s .', 99);
    if (!e.ok) throw new Error('fail');
    expect(e.pattern.timeSig.num).toBe(8); // 16 tokens at 8 beats: 8ths
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
  it('parse(format(p)) reproduces notes and beats (200 random patterns)', () => {
    const rand = rng(12345);
    const pick = <T,>(a: readonly T[]): T => a[Math.floor(rand() * a.length)]!;
    const vels = [VELOCITY.ghost, VELOCITY.normal, VELOCITY.accent];
    for (let n = 0; n < 200; n++) {
      const timeSig: TimeSignature = { num: 1 + Math.floor(rand() * 32), den: 4 };
      const stepsPerBeat = pick([3, 4] as const);
      const p = createPattern({ timeSig, stepsPerBeat }, 0);
      const st = stepTicks(timeSig, stepsPerBeat);
      const total = patternSteps(p);
      const density = rand();
      const unit = pick(stepsPerBeat === 4 ? [1, 2, 4] : [1, 3]); // exercises every coarseness
      const notes: Pattern['notes'] = {};
      for (const id of SOUND_IDS) {
        if (rand() < 0.5) continue;
        const arr: NoteEvent[] = [];
        for (let s = 0; s < total; s += unit) if (rand() < density * 0.5) arr.push({ tick: s * st, vel: pick(vels) });
        if (arr.length) notes[id] = arr;
      }
      p.notes = notes;
      const f = formatBeatText(p);
      expect(f.droppedOffGrid).toBe(0);
      const r = parseBeatText(f.text, { timeSig, stepsPerBeat });
      if (!r.ok) throw new Error(`case ${n}: ${f.text}\n${JSON.stringify(r.errors)}`);
      expect(r.notes).toEqual(notes);
      expect(r.beats).toBe(timeSig.num);
      expect(r.warnings).toEqual([]);
      expect(r.resolution).toBe(f.resolution);
    }
  });
  it('puts four beats on a line', () => {
    const p = createPattern({ timeSig: { num: 6, den: 4 }, notes: { kick: [{ tick: 0, vel: 96 }, { tick: 2400, vel: 96 }] } }, 0);
    expect(formatBeatText(p).text).toBe('k . . . |\n. k |');
  });
  it('prints each pattern at its coarsest resolution', () => {
    const at = (ticks: number[], spb: number) =>
      formatBeatText(createPattern({ stepsPerBeat: spb, notes: { kick: ticks.map((tick) => ({ tick, vel: 96 })) } }, 0));
    expect(at([0, 480], 4).resolution).toBe('quarters');
    expect(at([0, 240], 4).resolution).toBe('8ths');
    expect(at([0, 120], 4).resolution).toBe('16ths');
    expect(at([0, 480], 3).resolution).toBe('quarters');
    expect(at([0, 160], 3).resolution).toBe('triplets');
    expect(at([], 4).text).toBe('. . . . |');
  });
});
