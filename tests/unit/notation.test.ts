import { describe, it, expect } from 'vitest';
import { applyBeatText, formatBeatText, parseBeatText } from '../../src/domain/notation';
import { createPattern } from '../../src/domain/patternOps';
import { SOUND_IDS, VELOCITY, type NoteEvent, type Pattern, type SoundId, type TimeSignature } from '../../src/domain/types';
import { patternSteps, stepTicks } from '../../src/domain/time';

const T44 = { num: 4, den: 4 } as const;
const p4 = (text: string) => parseBeatText(text, { timeSig: T44, stepsPerBeat: 4 });
const p2 = (text: string) => parseBeatText(text, { timeSig: T44, stepsPerBeat: 2 });

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
    expect(r.bars).toBe(1);
    expect(r.steps).toBe(16);
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
  it('parses', () => {
    const r = ok(p2(rock));
    expect(r.bars).toBe(1);
    expect(r.steps).toBe(8);
    expect(ticks(r.notes, 'kick')).toEqual([0, 960, 1200]);
    expect(ticks(r.notes, 'snare')).toEqual([480, 1440]);
    expect(ticks(r.notes, 'hatClosed')).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => i * 240));
  });
  it('with bar lines', () => {
    const r = ok(p2('| ' + rock + ' |'));
    expect(r.bars).toBe(1);
    const r2 = ok(p2(`${rock} |\n${rock} |`));
    expect(r2.bars).toBe(2);
    expect(r2.steps).toBe(16);
    expect(ticks(r2.notes, 'kick')).toEqual([0, 960, 1200, 1920, 2880, 3120]);
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
    expect(r.notes.kick).toEqual([{ tick: 0, vel: VELOCITY.accent }]);
    expect(r.notes.hatClosed!.map((n) => n.vel)).toEqual([96, 96, 96]);
    expect(r.notes.snare).toEqual([{ tick: 480, vel: VELOCITY.ghost }]);
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
    const r = ok(parseBeatText(text, { timeSig: T44, stepsPerBeat: 2 }));
    expect(r.steps).toBe(12);
    expect(r.bars).toBe(2);
    expect(r.warnings).toHaveLength(1);
  });
  it('comment may contain syntax', () => {
    const r = ok(p4('k---k---k---k--- # [ ( ? q'));
    expect(r.steps).toBe(16);
  });
  it('handles CRLF and empty text', () => {
    const r = ok(p4('k---k---\r\nk---k---\r\n'));
    expect(r.steps).toBe(16);
    const e = ok(p4('  # nothing \n'));
    expect(e.bars).toBe(1);
    expect(e.steps).toBe(0);
    expect(e.notes).toEqual({});
  });
});

describe('repeats', () => {
  it('[..]*2', () => {
    const r = ok(p2('[k+x x s+x x]*2'));
    expect(r.bars).toBe(1);
    expect(r.steps).toBe(8);
    expect(ticks(r.notes, 'kick')).toEqual([0, 960]);
    expect(ticks(r.notes, 'snare')).toEqual([480, 1440]);
  });
  it('[kx]*4 |', () => {
    const r = ok(p2('[kx]*4 |'));
    expect(r.steps).toBe(8);
    expect(r.bars).toBe(1);
    expect(r.notes.kick).toHaveLength(4);
  });
  it('whitespace around *', () => {
    const r = ok(p2('[ k x ] * 4'));
    expect(r.steps).toBe(8);
  });
  it('bar lines across expanded stream', () => {
    const r = ok(p2('[k---]*2 | [x---]*2 |'));
    expect(r.bars).toBe(2);
    const e = fail(p2('[k-]*3 | k'));
    expect(e[0]!.message).toBe('Bar 1 has 6 steps, expected 8');
  });
  it('bar line inside a repeat', () => {
    const r = ok(p2('[k-x-k-x- |]*2'));
    expect(r.bars).toBe(2);
    expect(r.steps).toBe(16);
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
    expect(ok(p2('[k]*64')).bars).toBe(8);
  });
  it('unmatched brackets', () => {
    expect(fail(p2('k ] x'))[0]).toMatchObject({ line: 1, col: 3 });
    expect(fail(p2('k [ x'))[0]).toMatchObject({ line: 1, col: 3 });
  });
});

describe('errors', () => {
  it('bar length with line/col', () => {
    const e = fail(p4('k---k---k---k--- |\nk---k---k---k-- |'));
    expect(e).toEqual([{ line: 2, col: 17, message: 'Bar 2 has 15 steps, expected 16' }]);
  });
  it('unknown letter on multi-line input', () => {
    const e = fail(p4('# c\nk---k---\n  k--q----k---k---'));
    expect(e).toEqual([{ line: 3, col: 6, message: "Unknown sound 'q'" }]);
  });
  it('collects multiple errors without cascading bar errors', () => {
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
  it('too many bars', () => {
    const e = fail(p2('k-------'.repeat(9)));
    expect(e[0]!.message).toMatch(/Too many bars/);
    expect(ok(p2('k-------'.repeat(8))).bars).toBe(8);
  });
});

describe('padding', () => {
  it('warns when incomplete', () => {
    const r = ok(p4('k---k---k---k--- | k---k---k---k--- | k---k-'));
    expect(r.bars).toBe(3);
    expect(r.steps).toBe(38);
    expect(r.warnings).toEqual(['Padded 10 rests to complete bar 3']);
  });
  it('singular rest', () => {
    const r = ok(p4('k--------------'));
    expect(r.warnings).toEqual(['Padded 1 rest to complete bar 1']);
  });
});

describe('other meters and grids', () => {
  it('3/4 @4', () => {
    const r = ok(parseBeatText('k---x---s---', { timeSig: { num: 3, den: 4 }, stepsPerBeat: 4 }));
    expect(r.bars).toBe(1);
    expect(ticks(r.notes, 'snare')).toEqual([960]);
  });
  it('6/8 @2 = 12 steps per bar', () => {
    const ts: TimeSignature = { num: 6, den: 8 };
    const r = ok(parseBeatText('k-x-x-s-x-x- | k-x-x-s-x-x-', { timeSig: ts, stepsPerBeat: 2 }));
    expect(r.bars).toBe(2);
    expect(r.steps).toBe(24);
    expect(ticks(r.notes, 'snare')).toEqual([6 * 120, 18 * 120]);
    const e = fail(parseBeatText('k-x-x-s-x-x-x- |', { timeSig: ts, stepsPerBeat: 2 }));
    expect(e[0]!.message).toBe('Bar 1 has 14 steps, expected 12');
  });
  it('triplet grid 4/4 @3', () => {
    const r = parseBeatText('kxx sxx kxx sxx |', { timeSig: T44, stepsPerBeat: 3 });
    const o = ok(r);
    expect(o.steps).toBe(12);
    expect(ticks(o.notes, 'kick')).toEqual([0, 6 * 160]);
    expect(ticks(o.notes, 'snare')).toEqual([3 * 160, 9 * 160]);
  });
});

describe('formatBeatText', () => {
  const rock = (): Pattern => {
    const notes: Pattern['notes'] = { kick: [], snare: [], hatClosed: [] };
    for (let i = 0; i < 8; i++) notes.hatClosed!.push({ tick: i * 240, vel: 96 });
    for (const i of [0, 4, 5]) notes.kick!.push({ tick: i * 240, vel: 96 });
    for (const i of [2, 6]) notes.snare!.push({ tick: i * 240, vel: 96 });
    return createPattern({ stepsPerBeat: 2, notes }, 0);
  };
  it('8th rock', () => {
    expect(formatBeatText(rock())).toEqual({ text: 'k+x x  s+x x  k+x k+x  s+x x |', droppedOffGrid: 0 });
  });
  it('16ths', () => {
    const p = createPattern({
      notes: {
        kick: [{ tick: 0, vel: 96 }],
        hatClosed: [0, 2, 4, 6].map((i) => ({ tick: i * 120, vel: 96 })),
        snare: [{ tick: 480, vel: 96 }],
      },
    });
    expect(formatBeatText(p).text).toBe('k+x - x -  s+x - x -  - - - -  - - - - |');
    const r = ok(p4(formatBeatText(p).text));
    expect(r.notes).toEqual(p.notes);
  });
  it('k+x-x- parses to [k+x][-][x][-]', () => {
    const r = ok(parseBeatText('k+x-x-', { timeSig: { num: 3, den: 8 }, stepsPerBeat: 2 }));
    expect(ticks(r.notes, 'kick')).toEqual([0]);
    expect(ticks(r.notes, 'hatClosed')).toEqual([0, 2 * 120]);
  });
  it('accent / ghost / order / multi-bar / empty', () => {
    const p = createPattern({
      bars: 2,
      stepsPerBeat: 1,
      notes: {
        snare: [{ tick: 0, vel: 40 }],
        kick: [{ tick: 0, vel: 127 }, { tick: 1920, vel: 96 }],
        crash: [{ tick: 1920 + 480, vel: 120 }],
      },
    });
    expect(formatBeatText(p).text).toBe('K+(s) - - - |\nk C - - |');
    expect(formatBeatText(createPattern({ stepsPerBeat: 1 })).text).toBe('- - - - |');
  });
  it('drops off-grid notes', () => {
    const p = createPattern({ notes: { kick: [{ tick: 0, vel: 96 }, { tick: 50, vel: 96 }] } });
    const f = formatBeatText(p);
    expect(f.droppedOffGrid).toBe(1);
    expect(f.text).toBe('k - - -  - - - -  - - - -  - - - - |');
  });
});

describe('applyBeatText', () => {
  it('replaces notes and bars, keeps the rest', () => {
    const p = createPattern({ stepsPerBeat: 2, name: 'Keep', mix: { kick: { gain: 0.5, muted: true } }, notes: { ride: [{ tick: 0, vel: 96 }] } }, 1);
    const before = structuredClone(p);
    const r = applyBeatText(p, 'k+x x s+x x k+x k+x s+x x | k-------', 99);
    if (!r.ok) throw new Error('fail');
    expect(r.pattern.bars).toBe(2);
    expect(r.pattern.notes.ride).toBeUndefined();
    expect(r.pattern.mix).toEqual(p.mix);
    expect(r.pattern.name).toBe('Keep');
    expect(r.pattern.updatedAt).toBe(99);
    expect(r.warnings).toEqual([]);
    expect(p).toEqual(before);
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
  it('parse(format(p)) reproduces notes and bars (200 random patterns)', () => {
    const rand = rng(12345);
    const pick = <T,>(a: readonly T[]): T => a[Math.floor(rand() * a.length)]!;
    const sigs: TimeSignature[] = [{ num: 4, den: 4 }, { num: 3, den: 4 }, { num: 6, den: 8 }, { num: 7, den: 8 }];
    const vels = [VELOCITY.ghost, VELOCITY.normal, VELOCITY.accent];
    for (let n = 0; n < 200; n++) {
      const timeSig = pick(sigs);
      const stepsPerBeat = 1 + Math.floor(rand() * 4);
      const bars = 1 + Math.floor(rand() * 3);
      const p = createPattern({ timeSig, stepsPerBeat, bars }, 0);
      const st = stepTicks(timeSig, stepsPerBeat);
      const total = patternSteps(p);
      const density = rand();
      const notes: Pattern['notes'] = {};
      for (const id of SOUND_IDS) {
        if (rand() < 0.5) continue;
        const arr: NoteEvent[] = [];
        for (let s = 0; s < total; s++) if (rand() < density * 0.5) arr.push({ tick: s * st, vel: pick(vels) });
        if (arr.length) notes[id] = arr;
      }
      p.notes = notes;
      const f = formatBeatText(p);
      expect(f.droppedOffGrid).toBe(0);
      const r = parseBeatText(f.text, { timeSig, stepsPerBeat });
      if (!r.ok) throw new Error(`case ${n}: ${f.text}\n${JSON.stringify(r.errors)}`);
      expect(r.notes).toEqual(notes);
      expect(r.bars).toBe(bars);
      expect(r.warnings).toEqual([]);
    }
  });
});
