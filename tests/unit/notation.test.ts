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

describe('typeabeat compatibility', () => {
  it('parses skxkskxkskxks-k-', () => {
    const r = ok(p4('skxkskxkskxks-k-'));
    expect(r.beats).toBe(4);
    expect(r.steps).toBe(16);
    expect(r.resolution).toBe('16ths');
    expect(r.warnings).toEqual([]);
    expect(ticks(r.notes, 'snare')).toEqual([0, 480, 960, 1440]);
    expect(ticks(r.notes, 'kick')).toEqual([1, 3, 5, 7, 9, 11, 14].map((i) => i * 120));
    expect(ticks(r.notes, 'hatClosed')).toEqual([2, 6, 10].map((i) => i * 120));
    for (const arr of Object.values(r.notes)) for (const n of arr!) expect(n.vel).toBe(VELOCITY.normal);
  });
  it('k+x combos', () => {
    const r = ok(p4('k+x---------------'));
    expect(ticks(r.notes, 'kick')).toEqual([0]);
    expect(ticks(r.notes, 'hatClosed')).toEqual([0]);
    expect(r.steps).toBe(16);
  });
  it('aliases b and h', () => {
    const r = ok(p4('b---h-----------'));
    expect(ticks(r.notes, 'kick')).toEqual([0]);
    expect(ticks(r.notes, 'hatOpen')).toEqual([480]);
  });
  it('is case-insensitive for lookup', () => {
    const r = ok(p4('B---------------'));
    expect(r.notes.kick).toEqual([{ tick: 0, vel: VELOCITY.accent }]);
  });
  it('dot is a rest', () => {
    const r = ok(p4('k...k...k...k...'));
    expect(ticks(r.notes, 'kick')).toEqual([0, 480, 960, 1440]);
  });
});

describe('8th-note rock', () => {
  const rock = 'k+x x s+x x k+x k+x s+x x';
  it('parses as 8ths on the 16th grid', () => {
    const r = ok(p2(rock));
    expect(r.beats).toBe(4);
    expect(r.steps).toBe(8);
    expect(r.resolution).toBe('8ths');
    expect(ticks(r.notes, 'kick')).toEqual([0, 960, 1200]);
    expect(ticks(r.notes, 'snare')).toEqual([480, 1440]);
    expect(ticks(r.notes, 'hatClosed')).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => i * 240));
  });
  it('bar lines are cosmetic', () => {
    expect(ok(p2('| ' + rock + ' |'))).toMatchObject({ beats: 4, resolution: '8ths' });
    expect(ok(p2(rock)).notes).toEqual(ok(p2(`${rock.slice(0, 11)} | ${rock.slice(11)} |`)).notes);
    // Two such lines are 16 tokens: with 4 beats that reads as 16ths, with 8 beats as 8ths.
    expect(ok(p2(`${rock} |\n${rock} |`))).toMatchObject({ beats: 4, resolution: '16ths' });
    const eight = parseBeatText(`${rock} |\n${rock} |`, { timeSig: { num: 8, den: 4 }, stepsPerBeat: 4 });
    expect(ok(eight)).toMatchObject({ beats: 8, resolution: '8ths' });
  });
  it('allows || and whitespace around +', () => {
    const r = ok(p2(`|| k + x x s+ x x k +x k+x s+x x ||`));
    expect(r.steps).toBe(8);
    expect(r.notes.kick).toHaveLength(3);
  });
});

describe('velocities', () => {
  it('uppercase accent, parens ghost', () => {
    const r = ok(p2('K+x x (s) x'));
    expect(r.resolution).toBe('quarters');
    expect(r.notes.kick).toEqual([{ tick: 0, vel: VELOCITY.accent }]);
    expect(r.notes.hatClosed!.map((n) => n.vel)).toEqual([96, 96, 96]);
    expect(r.notes.snare).toEqual([{ tick: 960, vel: VELOCITY.ghost }]);
    expect(r.steps).toBe(4);
  });
  it('ghost case ignored, ghost combined', () => {
    const r = ok(p2('(K)+(X) -'));
    expect(r.notes.kick![0]!.vel).toBe(VELOCITY.ghost);
    expect(r.notes.hatClosed![0]!.vel).toBe(VELOCITY.ghost);
    expect(r.steps).toBe(2);
  });
  it('same sound twice in a step keeps max', () => {
    const r = ok(p2('k+K+(k)'));
    expect(r.notes.kick).toEqual([{ tick: 0, vel: VELOCITY.accent }]);
    const r2 = ok(p2('(k)+k'));
    expect(r2.notes.kick![0]!.vel).toBe(VELOCITY.normal);
  });
});

describe('whitespace and comments', () => {
  it('ignores them', () => {
    const text = `# my beat
      k - x -   # first beat
      s\t-\tx -
      k x s x # trailing`;
    const r = ok(p2(text));
    expect(r.steps).toBe(12); // not 4 * d for the current 4 beats: full resolution, 3 beats
    expect(r.resolution).toBe('16ths');
    expect(r.beats).toBe(3);
    expect(r.warnings).toEqual([]);
  });
  it('comment may contain syntax', () => {
    const r = ok(p4('k---k---k---k--- # [ ( ? q'));
    expect(r.steps).toBe(16);
  });
  it('handles CRLF and empty text', () => {
    const r = ok(p4('k---k---\r\nk---k---\r\n'));
    expect(r.steps).toBe(16);
    const e = ok(p4('  # nothing \n'));
    expect(e.beats).toBe(4); // empty text keeps the current length
    expect(e.steps).toBe(0);
    expect(e.notes).toEqual({});
  });
});

describe('repeats', () => {
  it('[..]*2', () => {
    const r = ok(p2('[k+x x s+x x]*2'));
    expect(r.beats).toBe(4);
    expect(r.steps).toBe(8);
    expect(ticks(r.notes, 'kick')).toEqual([0, 960]);
    expect(ticks(r.notes, 'snare')).toEqual([480, 1440]);
  });
  it('[kx]*4 |', () => {
    const r = ok(p2('[kx]*4 |'));
    expect(r.steps).toBe(8);
    expect(r.beats).toBe(4);
    expect(r.notes.kick).toHaveLength(4);
  });
  it('whitespace around *', () => {
    expect(ok(p2('[ k x ] * 4')).steps).toBe(8);
  });
  it('bar lines inside and across repeats are ignored', () => {
    expect(ok(p2('[k---]*2 | [x---]*2 |')).steps).toBe(16);
    expect(ok(p2('[k-x-k-x- |]*2')).beats).toBe(4);
  });
  it('missing *N', () => {
    const e = fail(p2('[kx] k'));
    expect(e[0]!.message).toMatch(/\*N/);
    expect(e[0]).toMatchObject({ line: 1, col: 4 });
  });
  it('missing count after *', () => {
    expect(fail(p2('[kx]* k'))[0]!.message).toMatch(/count/);
  });
  it('nested', () => {
    const e = fail(p2('[k[x]*2]*2'));
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
  it('unknown letter on multi-line input', () => {
    const e = fail(p4('# c\nk---k---\n  k--q----k---k---'));
    expect(e).toEqual([{ line: 3, col: 6, message: "Unknown sound 'q'" }]);
  });
  it('collects multiple errors', () => {
    const e = fail(p4('k-q-k---k---k--- |\nk-y-k---k---k-?- |'));
    expect(e.map((x) => [x.line, x.col])).toEqual([[1, 3], [2, 3], [2, 15]]);
    expect(e[0]!.message).toBe("Unknown sound 'q'");
    expect(e[2]!.message).toMatch(/Unexpected character '\?'/);
  });
  it('limits errors to 20', () => {
    expect(fail(p4('q'.repeat(100))).length).toBeLessThanOrEqual(20);
  });
  it('ghost and plus syntax errors', () => {
    expect(fail(p2('k+ -'))[0]!.message).toMatch(/after '\+'/);
    expect(fail(p2('(k x'))[0]!.message).toMatch(/\)/);
    expect(fail(p2('( ) x'))[0]!.message).toMatch(/\(/);
  });
  it('too many beats', () => {
    const e = fail(p4('k---'.repeat(33)));
    expect(e[0]!.message).toBe('Too many beats: maximum is 32');
    expect(ok(p4('k---'.repeat(32))).beats).toBe(32);
  });
});

describe('beat count and resolution inference', () => {
  const at = (text: string, beats: number, spb: number) => parseBeatText(text, { timeSig: { num: beats, den: 4 }, stepsPerBeat: spb });
  it('tokens = beats x d for an allowed d: that d is used (4 beats, straight)', () => {
    expect(ok(at('k s k s', 4, 4))).toMatchObject({ resolution: 'quarters', beats: 4 });
    const e = ok(at('k+x x  s+x x  k+x k+x  s+x x |', 4, 4));
    expect(e).toMatchObject({ resolution: '8ths', beats: 4 });
    expect(ticks(e.notes, 'kick')).toEqual([0, 960, 1200]);
    expect(ok(at('k---k---k---k---', 4, 4))).toMatchObject({ resolution: '16ths', beats: 4 });
  });
  it('the current beat count decides between readings of the same text', () => {
    const text = 'k-s-k-s-k-s-k-s-'; // 16 tokens
    expect(ok(at(text, 4, 4))).toMatchObject({ resolution: '16ths', beats: 4 });
    expect(ok(at(text, 8, 4))).toMatchObject({ resolution: '8ths', beats: 8 });
    expect(ok(at(text, 16, 4))).toMatchObject({ resolution: 'quarters', beats: 16 });
  });
  it('otherwise full resolution; the beat count follows the text', () => {
    const r = ok(at('k---k---k---k---k---k---', 4, 4)); // 24 tokens, not 4 * d
    expect(r).toMatchObject({ resolution: '16ths', beats: 6, warnings: [] });
    const pad = ok(at('k-s-k', 4, 4));
    expect(pad).toMatchObject({ resolution: '16ths', beats: 2 });
    expect(pad.warnings).toEqual(['Padded 3 rests to complete beat 2']);
    expect(ok(at('k', 4, 4)).warnings).toEqual(['Padded 3 rests to complete beat 1']);
  });
  it('triplet feel: 12 tokens = triplets, 4 = quarters (4 beats)', () => {
    const t = ok(at('k-- s-- k-- s-- |', 4, 3));
    expect(t.resolution).toBe('triplets');
    expect(ticks(t.notes, 'snare')).toEqual([3 * 160, 9 * 160]);
    const q = ok(at('k s k s |', 4, 3));
    expect(q.resolution).toBe('quarters');
    expect(ticks(q.notes, 'snare')).toEqual([480, 1440]);
    expect(ok(at('k-s-k-s-', 4, 3))).toMatchObject({ resolution: 'triplets', beats: 3 }); // 8 tokens: 3 beats, padded
  });
  it('2 beats x 3 (6/8 feel)', () => {
    const r = ok(at('k-x x-s', 2, 3));
    expect(r).toMatchObject({ resolution: 'triplets', beats: 2 });
    expect(ticks(r.notes, 'snare')).toEqual([5 * 160]);
  });
  it('3 beats, straight: 6 tokens = 8ths, 3 = quarters', () => {
    const r = ok(at('k-s-k- |', 3, 4));
    expect(r.resolution).toBe('8ths');
    expect(ticks(r.notes, 'snare')).toEqual([480]);
    expect(ok(at('k s k', 3, 4)).resolution).toBe('quarters');
  });
  it('a long pattern of up to 32 beats', () => {
    expect(ok(at('k-'.repeat(32), 32, 4))).toMatchObject({ resolution: '8ths', beats: 32 });
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
    expect(formatBeatText(rock())).toEqual({ text: 'k+x x  s+x x  k+x k+x  s+x x |', droppedOffGrid: 0, resolution: '8ths' });
  });
  it('16ths', () => {
    const p = createPattern({
      notes: {
        kick: [{ tick: 0, vel: 96 }],
        hatClosed: [0, 2, 4, 6, 7].map((i) => ({ tick: i * 120, vel: 96 })),
        snare: [{ tick: 480, vel: 96 }],
      },
    });
    expect(formatBeatText(p).text).toBe('k+x - x -  s+x - x x  - - - -  - - - - |');
    expect(formatBeatText(p).resolution).toBe('16ths');
    const r = ok(p4(formatBeatText(p).text));
    expect(r.notes).toEqual(p.notes);
  });
  it('k+x-x- parses to [k+x][-][x][-]', () => {
    const r = ok(parseBeatText('k+x-x-', { timeSig: { num: 3, den: 4 }, stepsPerBeat: 2 }));
    expect(ticks(r.notes, 'kick')).toEqual([0]);
    expect(ticks(r.notes, 'hatClosed')).toEqual([0, 2 * 240]);
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
    expect(formatBeatText(p).text).toBe('K+(s) - - - |\nk C - - |');
    expect(formatBeatText(createPattern()).text).toBe('- - - - |');
  });
  it('drops off-grid notes', () => {
    const p = createPattern({ notes: { kick: [{ tick: 0, vel: 96 }, { tick: 50, vel: 96 }] } });
    const f = formatBeatText(p);
    expect(f.droppedOffGrid).toBe(1);
    expect(f.text).toBe('k - - - |'); // the one note on the grid is a quarter
  });
});

describe('applyBeatText', () => {
  it('replaces notes, keeps the rest', () => {
    const p = createPattern({ name: 'Keep', mix: { kick: { gain: 0.5, muted: true } }, notes: { ride: [{ tick: 0, vel: 96 }] } }, 1);
    const before = structuredClone(p);
    const r = applyBeatText(p, 'k+x x s+x x k+x k+x s+x x', 99);
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
    const r = applyBeatText(p, 'k---k---k---k---k---k---k---k---k---k---k---k---', 99); // 48 tokens
    if (!r.ok) throw new Error('fail');
    expect(r.pattern.timeSig.num).toBe(12);
    expect(r.pattern.bars).toBe(1);
    expect(r.pattern.stepsPerBeat).toBe(4);
    const e = applyBeatText(createPattern({ timeSig: { num: 8, den: 4 } }), 'k-s-k-s-k-s-k-s-', 99);
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
    expect(formatBeatText(p).text).toBe('k - - - |\n- k |');
  });
  it('prints each pattern at its coarsest resolution', () => {
    const at = (ticks: number[], spb: number) =>
      formatBeatText(createPattern({ stepsPerBeat: spb, notes: { kick: ticks.map((tick) => ({ tick, vel: 96 })) } }, 0));
    expect(at([0, 480], 4).resolution).toBe('quarters');
    expect(at([0, 240], 4).resolution).toBe('8ths');
    expect(at([0, 120], 4).resolution).toBe('16ths');
    expect(at([0, 480], 3).resolution).toBe('quarters');
    expect(at([0, 160], 3).resolution).toBe('triplets');
    expect(at([], 4).text).toBe('- - - - |');
  });
});
