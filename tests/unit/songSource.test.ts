import { describe, expect, it } from 'vitest';
import type { Pattern } from '../../src/domain/types';
import type { Section, Song } from '../../src/domain/song';
import { SongSource, type SongConfig } from '../../src/engine/songSource';
import { Scheduler } from '../../src/engine/scheduler';
import type { Clock, NoteOut, NoteSink, SinkSound } from '../../src/engine/types';
import { mkPattern } from './helpers';

const BAR = 1920;
const notes = (ticks: number[], vel = 100) => ticks.map((tick) => ({ tick, vel }));

const pA = mkPattern({ id: 'pA', notes: { kick: notes([0, 960]), hatClosed: notes([480], 80) } });
const pB = mkPattern({ id: 'pB', notes: { snare: notes([0]), hatClosed: notes([960], 80) } });
const pC = mkPattern({ id: 'pC', notes: { ride: notes([0, 960]) } });
// 4-beat fill (tick within the fill): toms in beats 3-4.
const fill4 = mkPattern({ id: 'fill4', kind: 'fill', notes: { tomMid: notes([960, 1200, 1440, 1680]) } });
// short 1-beat fill: shorter than a bar.
const fill1 = mkPattern({ id: 'fill1', kind: 'fill', timeSig: { num: 1, den: 4 }, notes: { tomHigh: notes([0, 240]) } });
// 8-beat fill (longer than a bar): tail is played.
const fill8 = mkPattern({ id: 'fill8', kind: 'fill', timeSig: { num: 8, den: 4 }, notes: { tomFloor: notes([0, 1920, 3840]) } });
const waltz = mkPattern({ id: 'waltz', timeSig: { num: 3, den: 4 }, notes: { kick: notes([0]), snare: notes([480, 960]) } });

const lib: Record<string, Pattern> = { pA, pB, pC, fill4, fill1, fill8, waltz };

let sid = 0;
const sec = (patternId: string, bars: number, over: Partial<Section> = {}): Section => ({
  id: `s${++sid}`,
  kind: 'verse',
  name: 'S',
  patternId,
  bars,
  fill: { enabled: false, patternId: null },
  loop: false,
  ...over,
});
const song = (sections: Section[], over: Partial<Song> = {}): Song => ({
  id: 'song',
  name: 'T',
  bpm: 120,
  beatsPerBar: 4,
  fillId: 'fill4',
  sections,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

function mk(sections: Section[], over: Partial<SongConfig> = {}, songOver: Partial<Song> = {}, opts?: { startSection?: number }) {
  const state = { cfg: null as unknown as SongConfig };
  state.cfg = {
    song: song(sections, songOver),
    getPattern: (id) => lib[id] ?? null,
    click: { enabled: false, volume: 0.5 },
    countInBars: 0,
    crashAfterFill: true,
    ...over,
  };
  const src = new SongSource(() => state.cfg, opts);
  return { src, state, edit: (fn: (s: Song) => Song) => (state.cfg = { ...state.cfg, song: fn(state.cfg.song) }) };
}

const collect = (s: SongSource, a: number, b: number) => {
  const out: NoteOut[] = [];
  s.collect(a, b, out);
  return out;
};
const at = (o: NoteOut[], tick: number) => o.filter((n) => n.tick === tick);
const ticksOf = (o: NoteOut[], sound: SinkSound) => o.filter((n) => n.sound === sound).map((n) => n.tick).sort((a, b) => a - b);
const has = (o: NoteOut[], tick: number, sound: SinkSound) => o.some((n) => n.tick === tick && n.sound === sound);
const key = (n: NoteOut) => `${n.tick}|${n.sound}|${n.vel}|${n.gain}|${n.offsetTicks}`;
const sortedKeys = (o: NoteOut[]) => o.map(key).sort();

/** Play bar by bar to `to`, collecting everything (simulating the scheduler's contiguous windows). */
function playTo(s: SongSource, from: number, to: number, step = BAR / 4) {
  const out: NoteOut[] = [];
  for (let t = from; t < to; t += step) s.collect(t, Math.min(to, t + step), out);
  return out;
}

describe('SongSource traversal', () => {
  it('plays sections back to back with exact boundaries, restarts groove phase, final crash+kick, then nothing', () => {
    const { src } = mk([sec('pA', 2), sec('pB', 3), sec('pC', 1)]);
    expect(src.ended).toBeNull();
    const out = playTo(src, 0, 20 * BAR);
    // total 6 bars: final hit at 6 * BAR
    expect(src.ended).toBe(6 * BAR);
    expect(ticksOf(out, 'kick').filter((t) => t < 2 * BAR)).toEqual([0, 960, 1920, 2880]);
    // section starts
    expect(has(out, 0, 'kick')).toBe(true);
    expect(has(out, 2 * BAR, 'snare')).toBe(true);
    expect(has(out, 5 * BAR, 'ride')).toBe(true);
    // no pattern leakage across boundaries
    expect(ticksOf(out, 'snare')).toEqual([2 * BAR, 3 * BAR, 4 * BAR]);
    expect(ticksOf(out, 'ride')).toEqual([5 * BAR, 5 * BAR + 960]);
    expect(ticksOf(out, 'kick').filter((t) => t >= 2 * BAR && t < 6 * BAR)).toEqual([]);
    // final: crash 120 + kick 110, nothing after
    expect(at(out, 6 * BAR).map((n) => `${n.sound}:${n.vel}`).sort()).toEqual(['crash:120', 'kick:110']);
    expect(out.filter((n) => n.tick > 6 * BAR)).toEqual([]);
    expect(out.filter((n) => n.sound === 'crash').map((n) => n.tick)).toEqual([6 * BAR]);
  });

  it('groove phase is relative to the section start (a 2-bar pattern is one pass = one bar, played 3 times)', () => {
    const p2 = mkPattern({ id: 'p2', bars: 2, notes: { kick: notes([0]), snare: notes([BAR]) } });
    lib.p2 = p2;
    const { src } = mk([sec('pA', 1), sec('p2', 3), sec('pA', 1)]);
    const out = playTo(src, 0, 12 * BAR);
    delete lib.p2;
    // p2 (2 bars long) starts at BAR and plays 3 passes of 2 bars: kicks at 1,3,5 (x BAR), snares at 2,4,6
    expect(ticksOf(out, 'kick').filter((t) => t >= BAR && t < 7 * BAR)).toEqual([BAR, 3 * BAR, 5 * BAR]);
    expect(ticksOf(out, 'snare')).toEqual([2 * BAR, 4 * BAR, 6 * BAR]);
    expect(has(out, 7 * BAR, 'kick')).toBe(true); // next section's groove (pA) starts after 3 passes
  });

  it('3/4 song: bars of 1440 ticks (from the grooves)', () => {
    const { src } = mk([sec('waltz', 2), sec('waltz', 1)]);
    expect(src.timeSig()).toEqual({ num: 3, den: 4 });
    const out = playTo(src, 0, 8 * 1440, 360);
    expect(src.ended).toBe(3 * 1440);
    expect(ticksOf(out, 'kick').filter((t) => t < 3 * 1440)).toEqual([0, 1440, 2880]);
    expect(at(out, 3 * 1440).map((n) => n.sound).sort()).toEqual(['crash', 'kick']);
  });

  it('empty song: only the count-in, ended at 0, no hit', () => {
    const { src } = mk([], { countInBars: 1 });
    expect(src.startTick()).toBe(-BAR);
    const out = playTo(src, -BAR, 4 * BAR);
    expect(out.every((n) => n.tick < 0 && (n.sound === 'click' || n.sound === 'clickAccent'))).toBe(true);
    expect(out).toHaveLength(4);
    expect(src.ended).toBe(0);
  });

  it('missing pattern = silence for that section; unknown start section is clamped', () => {
    const { src } = mk([sec('nope', 1), sec('pB', 1)]);
    const out = playTo(src, 0, 3 * BAR);
    expect(ticksOf(out, 'kick')).toEqual([BAR * 2]);
    expect(ticksOf(out, 'snare')).toEqual([BAR]);
    const m = mk([sec('pA', 1), sec('pB', 1)], {}, {}, { startSection: 99 });
    expect(has(playTo(m.src, 0, BAR), 0, 'snare')).toBe(true);
  });

  it('swing offsets come from the pattern; triplet feel ignores swing', () => {
    const sw = mkPattern({ id: 'sw', swing: 0.67, notes: { hatClosed: notes([240]) } });
    const tr = mkPattern({ id: 'tr', swing: 0.67, stepsPerBeat: 3, notes: { hatClosed: notes([240]) } });
    lib.sw = sw;
    lib.tr = tr;
    const a = collect(mk([sec('sw', 1), sec('tr', 1)]).src, 0, 2 * BAR);
    delete lib.sw;
    delete lib.tr;
    expect(a.find((n) => n.tick === 240)!.offsetTicks).toBeGreaterThan(0);
    expect(a.find((n) => n.tick === BAR + 240)!.offsetTicks).toBe(0);
  });
});

describe('SongSource count-in and click', () => {
  it('count-in: only accented-downbeat clicks, always audible (min gain 0.6), even with click off', () => {
    const { src } = mk([sec('pA', 1)], { countInBars: 2, click: { enabled: false, volume: 0.2 } });
    expect(src.startTick()).toBe(-2 * BAR);
    const out = collect(src, -2 * BAR, 0);
    expect(out.map((n) => n.tick)).toEqual([-3840, -3360, -2880, -2400, -1920, -1440, -960, -480]);
    expect(out.filter((n) => n.sound === 'clickAccent').map((n) => n.tick)).toEqual([-3840, -1920]);
    expect(out.every((n) => n.gain === 0.6)).toBe(true);
  });

  it('click: per beat from tick 0, accent on downbeats, volume as gain; stops at the end', () => {
    const { src } = mk([sec('pA', 1), sec('pB', 1)], { click: { enabled: true, volume: 0.4 } });
    const out = playTo(src, 0, 6 * BAR);
    const clicks = out.filter((n) => n.sound === 'click' || n.sound === 'clickAccent');
    expect(clicks.filter((n) => n.sound === 'clickAccent').map((n) => n.tick)).toEqual([0, BAR, 2 * BAR]);
    expect(clicks.filter((n) => n.tick < 2 * BAR)).toHaveLength(8);
    expect(clicks.every((n) => n.gain === 0.4)).toBe(true);
    expect(Math.max(...clicks.map((n) => n.tick))).toBe(2 * BAR); // at the final downbeat, nothing after
  });

  it('click and groove after the count-in line up (tick 0 is the first downbeat of the start section)', () => {
    const { src } = mk([sec('pA', 1), sec('pB', 1)], { countInBars: 1, click: { enabled: true, volume: 1 } }, {}, { startSection: 1 });
    const out = playTo(src, -BAR, BAR);
    expect(has(out, 0, 'snare')).toBe(true);
    expect(has(out, 0, 'clickAccent')).toBe(true);
  });
});

describe('transition fills', () => {
  it('last bar plays the fill tail, groove is silenced, crash + kick on the next downbeat', () => {
    const { src } = mk([sec('pA', 2, { fill: { enabled: true, patternId: null } }), sec('pB', 2)]);
    const out = playTo(src, 0, 4 * BAR);
    // bar 0 normal, bar 1 is the fill bar (fill4 occupies the whole bar)
    expect(ticksOf(out, 'tomMid')).toEqual([BAR + 960, BAR + 1200, BAR + 1440, BAR + 1680]);
    expect(ticksOf(out, 'kick').filter((t) => t < 2 * BAR)).toEqual([0, 960]); // bar 1 groove silenced
    expect(ticksOf(out, 'hatClosed').filter((t) => t < 2 * BAR)).toEqual([480]);
    expect(at(out, 2 * BAR).map((n) => `${n.sound}:${n.vel}`).sort()).toEqual(['crash:120', 'kick:110', 'snare:100']);
  });

  it('crashAfterFill off: no crash', () => {
    const { src } = mk([sec('pA', 1, { fill: { enabled: true, patternId: null } }), sec('pB', 1)], { crashAfterFill: false });
    const out = playTo(src, 0, 3 * BAR);
    expect(ticksOf(out, 'crash').filter((t) => t < 2 * BAR)).toEqual([]);
  });

  it('dedupes with identical groove hits: max velocity', () => {
    const { src } = mk([sec('pA', 1, { fill: { enabled: true, patternId: null } }), sec('pA', 1)]);
    const out = playTo(src, 0, 3 * BAR);
    const kicks = at(out, BAR).filter((n) => n.sound === 'kick');
    expect(kicks).toHaveLength(1);
    expect(kicks[0]!.vel).toBe(110);
  });

  it('uses the section fill pattern over the song default; none without a pattern', () => {
    const a = mk([sec('pA', 1, { fill: { enabled: true, patternId: 'fill8' } }), sec('pB', 1)]);
    const out = playTo(a.src, 0, 3 * BAR);
    // fill8 is 8 beats long: tail = its second half (ticks 1920..3839 => floor(tick/1920)=1 only at 1920)
    expect(ticksOf(out, 'tomFloor')).toEqual([0]); // fill tick 1920 → bar-aligned origin = end - 3840 → at 0
    const b = mk([sec('pA', 1, { fill: { enabled: true, patternId: null } }), sec('pB', 1)], {}, { fillId: null });
    expect(ticksOf(playTo(b.src, 0, 3 * BAR), 'tomMid')).toEqual([]);
    expect(has(playTo(mk([sec('pA', 1, { fill: { enabled: true, patternId: null } }), sec('pB', 1)], {}, { fillId: null }).src, 0, 3 * BAR), BAR, 'crash')).toBe(false);
  });

  it('shorter-than-a-bar fill: groove plays until the fill starts', () => {
    const { src } = mk([sec('pA', 1, { fill: { enabled: true, patternId: 'fill1' } }), sec('pB', 1)]);
    const out = playTo(src, 0, 3 * BAR);
    expect(ticksOf(out, 'kick').filter((t) => t < BAR)).toEqual([0, 960]);
    expect(ticksOf(out, 'tomHigh')).toEqual([3 * 480, 3 * 480 + 240]);
  });

  it('1-bar section: the fill replaces the bar', () => {
    const { src } = mk([sec('pA', 1, { fill: { enabled: true, patternId: null } }), sec('pB', 1)]);
    const out = playTo(src, 0, 3 * BAR);
    expect(ticksOf(out, 'kick').filter((t) => t < BAR)).toEqual([]);
    expect(ticksOf(out, 'tomMid')).toHaveLength(4);
  });

  it('none when the section loops; into the final hit a fill is played', () => {
    const l = mk([sec('pA', 1, { loop: true, fill: { enabled: true, patternId: null } }), sec('pB', 1)]);
    const out = playTo(l.src, 0, 4 * BAR);
    expect(ticksOf(out, 'tomMid')).toEqual([]);
    expect(ticksOf(out, 'crash')).toEqual([]);

    const f = mk([sec('pA', 1), sec('pB', 2, { fill: { enabled: true, patternId: null } })]);
    const o2 = playTo(f.src, 0, 6 * BAR);
    expect(f.src.ended).toBe(3 * BAR);
    expect(ticksOf(o2, 'tomMid')).toHaveLength(4);
    expect(ticksOf(o2, 'tomMid')[0]).toBe(2 * BAR + 960);
    expect(at(o2, 3 * BAR).map((n) => n.sound).sort()).toEqual(['crash', 'kick']);
  });
});

describe('NEXT / PREV / jump', () => {
  const three = () => mk([sec('pA', 4), sec('pB', 4), sec('pC', 4)]);

  it('NEXT mid-bar changes exactly at the next bar boundary, never mid-bar', () => {
    const { src } = three();
    const out: NoteOut[] = [];
    src.collect(0, 1000, out); // scheduledUntil = 1000, inside bar 0
    src.act({ type: 'next' }, 1000);
    expect(src.infoAt(500)!.queued).toEqual({ kind: 'next', sectionIndex: 1 });
    src.collect(1000, 6 * BAR, out);
    expect(has(out, BAR, 'snare')).toBe(true); // section B starts at bar 1 start
    expect(ticksOf(out, 'kick').filter((t) => t >= BAR && t < 5 * BAR)).toEqual([]);
    expect(ticksOf(out, 'snare').slice(0, 4)).toEqual([BAR, 2 * BAR, 3 * BAR, 4 * BAR]);
    // the new section's groove phase starts at the boundary
    expect(src.infoAt(BAR + 10)).toMatchObject({ sectionIndex: 1, barInSection: 0, queued: null });
  });

  it('NEXT with fill enabled: fill tail over the remainder of the bar, crash on the boundary', () => {
    const { src } = mk([sec('pA', 4, { fill: { enabled: true, patternId: null } }), sec('pB', 4)]);
    const out: NoteOut[] = [];
    src.collect(0, 1000, out);
    src.act({ type: 'next' }, 1000);
    src.collect(1000, 3 * BAR, out);
    // fill starts at the next beat boundary (1440? no: ceil(1000/480)*480 = 1440) → tail of the fill from 1440
    expect(ticksOf(out, 'tomMid')).toEqual([1440, 1680]);
    expect(ticksOf(out, 'kick').filter((t) => t >= 1440 && t < BAR)).toEqual([]);
    expect(at(out, BAR).map((n) => n.sound).sort()).toEqual(['crash', 'kick', 'snare']);
    expect(src.infoAt(1500)!.phase).toBe('fill');
  });

  it('NEXT with no whole beat left in the bar: change without fill', () => {
    const { src } = mk([sec('pA', 4, { fill: { enabled: true, patternId: null } }), sec('pB', 4)]);
    const out: NoteOut[] = [];
    src.collect(0, BAR, out);
    src.act({ type: 'next' }, BAR);
    src.collect(BAR, 3 * BAR, out);
    // sU == bar boundary: bar 1 is unplanned, change applies at BAR, nothing to fill
    expect(ticksOf(out, 'tomMid')).toEqual([]);
    expect(has(out, BAR, 'snare')).toBe(true);
    expect(ticksOf(out, 'crash')).toEqual([]);
  });

  it('NEXT when the next boundary is already scheduled applies at the following boundary', () => {
    const { src } = three();
    const out: NoteOut[] = [];
    src.collect(0, BAR + 100, out); // bar 1 already planned and partly scheduled
    src.act({ type: 'next' }, BAR + 100);
    src.collect(BAR + 100, 5 * BAR, out);
    expect(has(out, BAR, 'kick')).toBe(true); // bar 1 still section A
    expect(has(out, 2 * BAR, 'snare')).toBe(true);
    expect(has(out, 2 * BAR, 'kick')).toBe(false);
    expect(src.infoAt(2 * BAR)!.sectionIndex).toBe(1);
  });

  it('NEXT then PREV cancels the change (and a not-yet-started fill)', () => {
    const { src } = mk([sec('pA', 4, { fill: { enabled: true, patternId: null } }), sec('pB', 4)]);
    const out: NoteOut[] = [];
    src.collect(0, 500, out);
    src.act({ type: 'next' }, 500);
    expect(src.infoAt(100)!.fillQueued).toBe(true);
    src.act({ type: 'prev' }, 500);
    expect(src.infoAt(100)!.queued).toBeNull();
    expect(src.infoAt(100)!.fillQueued).toBe(false);
    src.collect(500, 3 * BAR, out);
    expect(ticksOf(out, 'tomMid')).toEqual([]);
    expect(src.infoAt(BAR + 5)!.sectionIndex).toBe(0);
    // can be queued again afterwards
    src.act({ type: 'next' }, 3 * BAR);
    src.collect(3 * BAR, 5 * BAR, out);
    expect(src.infoAt(4 * BAR)!.sectionIndex).toBe(1);
  });

  describe('accumulating NEXT / PREV', () => {
    const four = () => mk([sec('pA', 8), sec('pB', 8), sec('pC', 8), sec('pA', 8)]);
    const land = (src: SongSource) => {
      src.collect(500, 3 * BAR, []);
      return src.infoAt(BAR + 5)!.sectionIndex;
    };

    it('NEXT x3 from section 1 lands on section 4 at the next bar line', () => {
      const { src } = four();
      src.collect(0, 500, []);
      for (let i = 0; i < 3; i++) src.act({ type: 'next' }, 500);
      expect(src.infoAt(100)!.queued).toEqual({ kind: 'next', sectionIndex: 3 });
      expect(src.infoAt(BAR - 1)!.sectionIndex).toBe(0);
      expect(land(src)).toBe(3);
    });

    it('NEXT x2 then PREV -> section 2', () => {
      const { src } = four();
      src.collect(0, 500, []);
      src.act({ type: 'next' }, 500);
      src.act({ type: 'next' }, 500);
      src.act({ type: 'prev' }, 500);
      expect(src.infoAt(100)!.queued).toEqual({ kind: 'prev', sectionIndex: 1 });
      expect(land(src)).toBe(1);
    });

    it('NEXT past the last section = final hit; one more NEXT does nothing; PREV returns to the last section', () => {
      const { src } = mk([sec('pA', 8), sec('pB', 8)]);
      src.collect(0, 500, []);
      src.act({ type: 'next' }, 500); // section 2
      src.act({ type: 'next' }, 500); // end
      expect(src.infoAt(100)!.queued).toEqual({ kind: 'next', sectionIndex: null });
      src.act({ type: 'next' }, 500);
      expect(src.infoAt(100)!.queued).toEqual({ kind: 'next', sectionIndex: null });
      src.act({ type: 'prev' }, 500);
      expect(src.infoAt(100)!.queued).toEqual({ kind: 'prev', sectionIndex: 1 });
      src.act({ type: 'next' }, 500);
      src.collect(500, 3 * BAR, []);
      expect(src.ended).toBe(BAR);
    });

    it('PREV accumulates down and clamps at the first section', () => {
      const { src } = mk([sec('pA', 8), sec('pB', 8), sec('pC', 8)], {}, {}, { startSection: 2 });
      src.collect(0, 500, []);
      for (let i = 0; i < 5; i++) src.act({ type: 'prev' }, 500);
      expect(src.infoAt(100)!.queued).toEqual({ kind: 'prev', sectionIndex: 0 });
    });

    it('only the first step arms the NEXT fill', () => {
      const { src } = mk([sec('pA', 8, { fill: { enabled: true, patternId: null } }), sec('pB', 8), sec('pC', 8)]);
      const out: NoteOut[] = [];
      src.collect(0, 1000, out);
      src.act({ type: 'next' }, 1000);
      src.act({ type: 'next' }, 1000);
      src.collect(1000, 3 * BAR, out);
      expect(ticksOf(out, 'tomMid')).toEqual([1440, 1680]); // a single fill tail
      expect(src.infoAt(BAR + 5)!.sectionIndex).toBe(2);
    });

    it('jump replaces the queue', () => {
      const { src } = four();
      src.collect(0, 500, []);
      src.act({ type: 'next' }, 500);
      src.act({ type: 'next' }, 500);
      src.act({ type: 'jump', sectionIndex: 3 }, 500);
      expect(src.infoAt(100)!.queued).toEqual({ kind: 'jump', sectionIndex: 3 });
      src.act({ type: 'next' }, 500); // steps from the jump target: end
      expect(src.infoAt(100)!.queued).toEqual({ kind: 'next', sectionIndex: null });
    });
  });

  it('NEXT in the last section goes to the final hit at the next boundary', () => {
    const { src } = mk([sec('pA', 1), sec('pB', 8)]);
    const out: NoteOut[] = [];
    src.collect(0, 2 * BAR + 100, out);
    expect(src.ended).toBeNull();
    src.act({ type: 'next' }, 2 * BAR + 100);
    expect(src.infoAt(2 * BAR + 50)!.queued).toEqual({ kind: 'next', sectionIndex: null });
    src.collect(2 * BAR + 100, 9 * BAR, out);
    expect(src.ended).toBe(3 * BAR);
    expect(at(out, 3 * BAR).map((n) => n.sound).sort()).toEqual(['crash', 'kick']);
    expect(out.filter((n) => n.tick > 3 * BAR)).toEqual([]);
  });

  it('PREV goes back a section; in the first section it restarts it', () => {
    const { src } = three();
    const out: NoteOut[] = [];
    src.collect(0, 5 * BAR + 10, out); // in section B (bar 5 = barInSection 1)
    src.act({ type: 'prev' }, 5 * BAR + 10);
    src.collect(5 * BAR + 10, 9 * BAR, out);
    expect(src.infoAt(6 * BAR)).toMatchObject({ sectionIndex: 0, barInSection: 0 });
    expect(has(out, 6 * BAR, 'kick')).toBe(true);

    const f = three();
    const o2: NoteOut[] = [];
    f.src.collect(0, 2 * BAR + 10, o2);
    f.src.act({ type: 'prev' }, 2 * BAR + 10);
    f.src.collect(2 * BAR + 10, 5 * BAR, o2);
    expect(f.src.infoAt(3 * BAR)).toMatchObject({ sectionIndex: 0, barInSection: 0 });
    expect(ticksOf(o2, 'kick').filter((t) => t >= 3 * BAR)).toContain(3 * BAR);
  });

  it('PREV has no fill; PREV then NEXT cancels', () => {
    const { src } = mk([sec('pA', 4), sec('pB', 4, { fill: { enabled: true, patternId: null } })], {}, {}, { startSection: 1 });
    const out: NoteOut[] = [];
    src.collect(0, 500, out);
    src.act({ type: 'prev' }, 500);
    expect(src.infoAt(0)!.queued).toEqual({ kind: 'prev', sectionIndex: 0 });
    src.act({ type: 'next' }, 500);
    expect(src.infoAt(0)!.queued).toBeNull();
    src.act({ type: 'prev' }, 500);
    src.collect(500, 3 * BAR, out);
    expect(ticksOf(out, 'tomMid')).toEqual([]);
    expect(has(out, BAR, 'kick')).toBe(true);
  });

  it('jump(i) lands at the next boundary; replaces a queued NEXT', () => {
    const { src } = three();
    const out: NoteOut[] = [];
    src.collect(0, 300, out);
    src.act({ type: 'next' }, 300);
    src.act({ type: 'jump', sectionIndex: 2 }, 300);
    expect(src.infoAt(0)!.queued).toEqual({ kind: 'jump', sectionIndex: 2 });
    src.collect(300, 4 * BAR, out);
    expect(has(out, BAR, 'ride')).toBe(true);
    expect(ticksOf(out, 'snare')).toEqual([]);
    expect(src.infoAt(BAR)).toMatchObject({ sectionIndex: 2, barInSection: 0 });
    // jump backwards, out-of-range clamps
    src.act({ type: 'jump', sectionIndex: 99 }, 4 * BAR);
    expect(src.infoAt(3 * BAR)!.queued!.sectionIndex).toBe(2);
  });

  it('jump with fill enabled in the current section plays the fill like NEXT', () => {
    const { src } = mk([sec('pA', 4, { fill: { enabled: true, patternId: null } }), sec('pB', 4), sec('pC', 4)]);
    const out: NoteOut[] = [];
    src.collect(0, 100, out);
    src.act({ type: 'jump', sectionIndex: 2 }, 100);
    src.collect(100, 3 * BAR, out);
    expect(ticksOf(out, 'tomMid')).toHaveLength(4);
    expect(at(out, BAR).map((n) => n.sound).sort()).toEqual(['crash', 'kick', 'ride']);
  });

  it('actions during the count-in apply at tick 0 (jump picks the start section)', () => {
    const { src } = mk([sec('pA', 2), sec('pB', 2)], { countInBars: 1 });
    const out: NoteOut[] = [];
    src.collect(-BAR, -BAR + 100, out);
    src.act({ type: 'jump', sectionIndex: 1 }, -BAR + 100);
    src.act({ type: 'fill' }, -BAR + 100); // ignored
    src.act({ type: 'break' }, -BAR + 100); // ignored
    src.collect(-BAR + 100, BAR, out);
    expect(has(out, 0, 'snare')).toBe(true);
    expect(ticksOf(out, 'tomMid')).toEqual([]);
  });
});

describe('BREAK', () => {
  it('stab on the downbeat, silence for the bar, resumption crash; the break bar counts as a bar', () => {
    const { src } = mk([sec('pA', 4), sec('pB', 2)], { click: { enabled: true, volume: 1 } });
    const out: NoteOut[] = [];
    src.collect(0, 500, out);
    src.act({ type: 'break' }, 500);
    expect(src.infoAt(100)!.breakQueued).toBe(true);
    src.collect(500, 8 * BAR, out);
    // bar 1 is the break bar
    expect(at(out, BAR).map((n) => `${n.sound}:${n.vel}`).filter((s) => !s.startsWith('click')).sort()).toEqual(['crash:120', 'kick:110']);
    expect(out.filter((n) => n.tick > BAR && n.tick < 2 * BAR && !n.sound.startsWith('click'))).toEqual([]);
    expect(out.filter((n) => n.tick >= BAR && n.tick < 2 * BAR && n.sound.startsWith('click'))).toHaveLength(4);
    // resumption on bar 2 (kick at the downbeat merged: max vel)
    expect(at(out, 2 * BAR).filter((n) => n.sound === 'crash')[0]!.vel).toBe(120);
    expect(at(out, 2 * BAR).find((n) => n.sound === 'kick')!.vel).toBe(110);
    expect(ticksOf(out, 'hatClosed').filter((t) => t >= 2 * BAR && t < 4 * BAR)).toEqual([2 * BAR + 480, 3 * BAR + 480]);
    // bars are counted: section B starts at bar 4 even with the break
    expect(src.infoAt(4 * BAR)).toMatchObject({ sectionIndex: 1, barInSection: 0 });
    expect(src.infoAt(BAR + 5)).toMatchObject({ phase: 'break', barInSection: 1, sectionIndex: 0 });
    expect(src.infoAt(2 * BAR + 5)!.phase).toBe('normal');
  });

  it('press again cancels', () => {
    const { src } = mk([sec('pA', 4)]);
    const out: NoteOut[] = [];
    src.collect(0, 500, out);
    src.act({ type: 'break' }, 500);
    src.act({ type: 'break' }, 500);
    expect(src.infoAt(100)!.breakQueued).toBe(false);
    src.collect(500, 3 * BAR, out);
    expect(ticksOf(out, 'crash')).toEqual([]);
    expect(ticksOf(out, 'kick')).toEqual([0, 960, BAR, BAR + 960, 2 * BAR, 2 * BAR + 960]);
  });

  it('a break on the last bar still ends with the final hit; break ignored after the end', () => {
    const { src } = mk([sec('pA', 2)]);
    const out: NoteOut[] = [];
    src.collect(0, BAR + 100, out);
    src.act({ type: 'break' }, BAR + 100); // the next boundary is the final hit: the final hit wins
    src.collect(BAR + 100, 5 * BAR, out);
    expect(src.ended).toBe(2 * BAR);
    expect(at(out, 2 * BAR).map((n) => n.sound).sort()).toEqual(['crash', 'kick']);
    src.act({ type: 'break' }, 5 * BAR);
    src.act({ type: 'next' }, 5 * BAR);
    expect(collect(src, 5 * BAR, 6 * BAR)).toEqual([]);
  });
});

describe('sticky loop', () => {
  it('a user LOOP persists into the next section and keeps looping past its bars', () => {
    const { src } = mk([sec('pA', 2), sec('pB', 2), sec('pC', 2)]);
    const out: NoteOut[] = [];
    src.collect(0, 500, out);
    src.act({ type: 'toggleLoop' }, 500);
    expect(src.infoAt(10)).toMatchObject({ loop: true, loopLocked: true });
    src.act({ type: 'next' }, 500);
    src.collect(500, 8 * BAR, out);
    expect(src.infoAt(BAR + 5)).toMatchObject({ sectionIndex: 1, loop: true });
    expect(src.infoAt(5 * BAR)).toMatchObject({ sectionIndex: 1, loop: true }); // past its 2 bars
    expect(src.infoAt(7 * BAR)).toMatchObject({ sectionIndex: 1 });
    src.act({ type: 'toggleLoop' }, 8 * BAR); // off: continues after this pass
    src.collect(8 * BAR, 14 * BAR, out);
    expect(src.infoAt(10 * BAR)).toMatchObject({ sectionIndex: 2, loop: false, loopLocked: true });
  });

  it('without a user toggle the saved flag of each section applies; reset clears the lock', () => {
    const { src } = mk([sec('pA', 1, { loop: false }), sec('pB', 1, { loop: true })]);
    const out: NoteOut[] = [];
    src.collect(0, 3 * BAR, out);
    expect(src.infoAt(0)).toMatchObject({ loop: false, loopLocked: false });
    expect(src.infoAt(BAR + 5)).toMatchObject({ sectionIndex: 1, loop: true, loopLocked: false });
    src.act({ type: 'toggleLoop' }, 3 * BAR);
    src.reset();
    src.collect(0, BAR, []);
    expect(src.infoAt(5)).toMatchObject({ loop: false, loopLocked: false });
  });

  it('a user LOOP off overrides a section saved as looping', () => {
    const { src } = mk([sec('pA', 1), sec('pB', 1, { loop: true }), sec('pC', 1)]);
    src.collect(0, 100, []);
    src.act({ type: 'toggleLoop' }, 100); // on
    src.act({ type: 'toggleLoop' }, 100); // off, locked
    src.act({ type: 'next' }, 100);
    src.collect(100, 6 * BAR, []);
    expect(src.infoAt(BAR + 5)).toMatchObject({ sectionIndex: 1, loop: false });
    expect(src.infoAt(2 * BAR + 5)).toMatchObject({ sectionIndex: 2 });
  });
});

describe('loop', () => {
  it('a looping section repeats; toggleLoop off continues at the end of the current pass', () => {
    const { src } = mk([sec('pA', 2, { loop: true }), sec('pB', 2)]);
    const out: NoteOut[] = [];
    src.collect(0, 2 * BAR, out);
    src.collect(2 * BAR, 4 * BAR, out); // second pass: restarted
    expect(src.infoAt(2 * BAR + 10)).toMatchObject({ sectionIndex: 0, barInSection: 0, loop: true, nextSectionIndex: 0 });
    expect(ticksOf(out, 'snare')).toEqual([]);
    src.act({ type: 'toggleLoop' }, 4 * BAR);
    // toggled at sU = 4*BAR: the 3rd pass was not planned yet, so this pass ends the loop
    src.collect(4 * BAR, 8 * BAR, out);
    expect(src.infoAt(4 * BAR)).toMatchObject({ sectionIndex: 1 });
  });

  it('toggleLoop in the middle of a pass: that pass finishes, then the arrangement moves on', () => {
    const { src } = mk([sec('pA', 2, { loop: true }), sec('pB', 2)]);
    const out: NoteOut[] = [];
    src.collect(0, BAR + 100, out);
    src.act({ type: 'toggleLoop' }, BAR + 100);
    expect(src.infoAt(BAR + 50)).toMatchObject({ loop: false, nextSectionIndex: 1 });
    src.collect(BAR + 100, 5 * BAR, out);
    expect(src.infoAt(2 * BAR)).toMatchObject({ sectionIndex: 1 });
  });

  it('toggleLoop on turns a normal section into a loop', () => {
    const { src } = mk([sec('pA', 2), sec('pB', 2)]);
    const out: NoteOut[] = [];
    src.collect(0, 100, out);
    src.act({ type: 'toggleLoop' }, 100);
    src.collect(100, 8 * BAR, out);
    expect(ticksOf(out, 'snare')).toEqual([]);
    expect(src.infoAt(6 * BAR)).toMatchObject({ sectionIndex: 0, barInSection: 0 });
  });

  it('the runtime flag is re-initialized from the section when it is entered', () => {
    const { src } = mk([sec('pA', 1), sec('pB', 1, { loop: true })]);
    const out: NoteOut[] = [];
    src.collect(0, 3 * BAR, out);
    expect(src.infoAt(BAR + 5)!.loop).toBe(true);
    expect(src.infoAt(5)!.loop).toBe(false);
  });
});

describe('manual FILL', () => {
  it('mid-bar: starts at the next beat, tail aligned to the bar end, crash after', () => {
    const { src } = mk([sec('pA', 4), sec('pB', 4)]);
    const out: NoteOut[] = [];
    src.collect(0, 1000, out);
    src.act({ type: 'fill' }, 1000);
    expect(src.infoAt(100)!.fillQueued).toBe(true);
    src.collect(1000, 3 * BAR, out);
    expect(ticksOf(out, 'tomMid')).toEqual([1440, 1680]);
    expect(ticksOf(out, 'kick').filter((t) => t >= 1440 && t < BAR)).toEqual([]);
    expect(at(out, BAR).map((n) => `${n.sound}:${n.vel}`).sort()).toEqual(['crash:120', 'kick:110']);
    expect(src.infoAt(1500)!.phase).toBe('fill');
    expect(src.infoAt(1000)!.phase).toBe('normal');
  });

  it('on a bar boundary: the whole next bar', () => {
    const { src } = mk([sec('pA', 4), sec('pB', 4)]);
    const out: NoteOut[] = [];
    src.collect(0, BAR, out);
    src.act({ type: 'fill' }, BAR);
    src.collect(BAR, 4 * BAR, out);
    expect(ticksOf(out, 'tomMid')).toEqual([BAR + 960, BAR + 1200, BAR + 1440, BAR + 1680]);
    expect(has(out, 2 * BAR, 'crash')).toBe(true);
  });

  it('is ignored while one is pending, in the count-in and after the end', () => {
    const { src } = mk([sec('pA', 4)], { countInBars: 1 });
    const out: NoteOut[] = [];
    src.collect(-BAR, -BAR + 10, out);
    src.act({ type: 'fill' }, -BAR + 10);
    src.collect(-BAR + 10, 1000, out);
    expect(ticksOf(out, 'tomMid')).toEqual([]);
    src.act({ type: 'fill' }, 1000);
    src.act({ type: 'fill' }, 1000);
    src.collect(1000, 3 * BAR, out);
    expect(ticksOf(out, 'tomMid')).toEqual([1440, 1680]);
    src.collect(3 * BAR, 6 * BAR, out);
    src.act({ type: 'fill' }, 6 * BAR);
    expect(collect(src, 6 * BAR, 7 * BAR)).toEqual([]);
  });

  it('in the last bar before the end the fill merges into the final hit', () => {
    const { src } = mk([sec('pA', 2)]);
    const out: NoteOut[] = [];
    src.collect(0, BAR + 100, out);
    src.act({ type: 'fill' }, BAR + 100);
    src.collect(BAR + 100, 4 * BAR, out);
    expect(ticksOf(out, 'tomMid')).toEqual([BAR + 960, BAR + 1200, BAR + 1440, BAR + 1680]);
    expect(at(out, 2 * BAR).filter((n) => n.sound === 'crash')).toHaveLength(1);
  });

  it('on the final bar boundary nothing is played after the end', () => {
    const { src } = mk([sec('pA', 1)]);
    const out: NoteOut[] = [];
    src.collect(0, BAR, out);
    src.act({ type: 'fill' }, BAR); // the next bar is the final hit
    src.collect(BAR, 4 * BAR, out);
    expect(out.filter((n) => n.tick > BAR)).toEqual([]);
  });

  it('does not stack on a transition fill of the same bar', () => {
    const { src } = mk([sec('pA', 2, { fill: { enabled: true, patternId: null } }), sec('pB', 2)]);
    const out: NoteOut[] = [];
    src.collect(0, BAR, out);
    src.act({ type: 'fill' }, BAR); // whole bar 1, which is also the transition fill bar
    src.collect(BAR, 4 * BAR, out);
    expect(ticksOf(out, 'tomMid')).toHaveLength(4);
    expect(ticksOf(out, 'crash')).toEqual([2 * BAR]);
  });
});

describe('infoAt', () => {
  it('count-in and normal playback', () => {
    const { src } = mk([sec('pA', 2), sec('pB', 3)], { countInBars: 1 });
    src.collect(-BAR, 3 * BAR, []);
    expect(src.infoAt(-BAR)).toMatchObject({ countIn: 4, bar: -1, beat: 0, sectionIndex: 0, phase: 'normal' });
    expect(src.infoAt(-1)).toMatchObject({ countIn: 1, bar: -1, beat: 3 });
    expect(src.infoAt(0)).toMatchObject({ countIn: null, bar: 0, beat: 0, sectionIndex: 0, barInSection: 0, sectionBars: 2, nextSectionIndex: 1, queued: null, loop: false });
    expect(src.infoAt(BAR + 1000)).toMatchObject({ bar: 1, beat: 2, barInSection: 1 });
    expect(src.infoAt(2 * BAR)).toMatchObject({ sectionIndex: 1, barInSection: 0, sectionBars: 3, nextSectionIndex: null });
  });

  it('final phase and unknown ticks', () => {
    const { src } = mk([sec('pA', 1)]);
    src.collect(0, 4 * BAR, []);
    expect(src.infoAt(BAR)!.phase).toBe('final');
    expect(src.infoAt(BAR + 5000)!.phase).toBe('final');
    expect(src.infoAt(50 * BAR)!.phase).toBe('final');
    const fresh = mk([sec('pA', 3)]).src;
    expect(fresh.infoAt(100)).toBeNull();
  });

  it('transition fill phase and queued jump targets', () => {
    const { src } = mk([sec('pA', 2, { fill: { enabled: true, patternId: 'fill1' } }), sec('pB', 2)]);
    src.collect(0, 3 * BAR, []);
    expect(src.infoAt(BAR + 100)!.phase).toBe('normal');
    expect(src.infoAt(BAR + 3 * 480 + 10)!.phase).toBe('fill');
  });
});

describe('live edits while playing', () => {
  it('changing the bars of the current section applies from the next bar', () => {
    const { src, edit } = mk([sec('pA', 4), sec('pB', 2)]);
    const out: NoteOut[] = [];
    src.collect(0, BAR + 10, out);
    edit((s) => ({ ...s, sections: [{ ...s.sections[0]!, bars: 2 }, s.sections[1]!] }));
    src.collect(BAR + 10, 6 * BAR, out);
    expect(src.infoAt(2 * BAR)).toMatchObject({ sectionIndex: 1 });
    expect(src.ended).toBe(4 * BAR);
    // shrinking below what was already played ends the section immediately at the next bar
    const m = mk([sec('pA', 8), sec('pB', 2)]);
    m.src.collect(0, 3 * BAR + 10, []);
    m.edit((s) => ({ ...s, sections: [{ ...s.sections[0]!, bars: 1 }, s.sections[1]!] }));
    m.src.collect(3 * BAR + 10, 7 * BAR, []);
    expect(m.src.infoAt(4 * BAR)).toMatchObject({ sectionIndex: 1, barInSection: 0 });
  });

  it('extending the section keeps playing it', () => {
    const { src, edit } = mk([sec('pA', 2), sec('pB', 2)]);
    src.collect(0, BAR + 10, []);
    edit((s) => ({ ...s, sections: [{ ...s.sections[0]!, bars: 4 }, s.sections[1]!] }));
    src.collect(BAR + 10, 5 * BAR, []);
    expect(src.infoAt(3 * BAR)).toMatchObject({ sectionIndex: 0, barInSection: 3 });
    expect(src.infoAt(4 * BAR)).toMatchObject({ sectionIndex: 1 });
  });

  it('deleting the current section continues with the section now at that index, or the end', () => {
    const { src, edit } = mk([sec('pA', 4), sec('pB', 2), sec('pC', 2)]);
    src.collect(0, BAR + 10, []);
    edit((s) => ({ ...s, sections: s.sections.slice(1) }));
    const out: NoteOut[] = [];
    src.collect(BAR + 10, 3 * BAR, out);
    expect(src.infoAt(2 * BAR)).toMatchObject({ sectionIndex: 0, barInSection: 0 });
    expect(has(out, 2 * BAR, 'snare')).toBe(true);

    const e = mk([sec('pA', 4), sec('pB', 2)]);
    e.src.collect(0, 5 * BAR + 10, []); // in section B
    e.edit((s) => ({ ...s, sections: s.sections.slice(0, 1) }));
    e.src.collect(5 * BAR + 10, 9 * BAR, []);
    expect(e.src.ended).toBe(6 * BAR);
    const z = mk([sec('pA', 4)]);
    z.src.collect(0, BAR + 1, []);
    z.edit((s) => ({ ...s, sections: [] }));
    z.src.collect(BAR + 1, 5 * BAR, []);
    expect(z.src.ended).toBe(2 * BAR);
  });

  it('swapping the pattern is audible live; a deleted pattern is silence', () => {
    const { src, edit, state } = mk([sec('pA', 4)]);
    src.collect(0, BAR, []);
    edit((s) => ({ ...s, sections: [{ ...s.sections[0]!, patternId: 'pB' }] }));
    const out = collect(src, BAR, 2 * BAR);
    expect(ticksOf(out, 'snare')).toEqual([BAR]);
    state.cfg = { ...state.cfg, getPattern: () => null };
    expect(collect(src, 2 * BAR, 3 * BAR)).toEqual([]);
  });

  it('queued target section deleted before it applies falls back sensibly', () => {
    const { src, edit } = mk([sec('pA', 4), sec('pB', 4), sec('pC', 4)]);
    src.collect(0, 100, []);
    src.act({ type: 'jump', sectionIndex: 2 }, 100);
    edit((s) => ({ ...s, sections: s.sections.filter((x) => x.patternId !== 'pC') }));
    const out = collect(src, 100, 3 * BAR);
    expect(out.length).toBeGreaterThan(0);
    expect(src.infoAt(BAR)!.sectionIndex).toBe(1);
  });

  it('changing a section groove to another length keeps the transport continuous (applies from the next bar)', () => {
    const { src, edit } = mk([sec('pA', 4)]);
    src.collect(0, BAR + 10, []); // bars 0 and 1 planned
    edit((s) => ({ ...s, sections: s.sections.map((x) => ({ ...x, patternId: 'waltz' })) }));
    const out = collect(src, BAR + 10, 6 * BAR);
    expect(src.timeSig().num).toBe(3);
    expect(src.ended).toBe(BAR * 2 + 1440 * 2);
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('per-section bar length (bar = one pass of the groove)', () => {
  const p8 = mkPattern({ id: 'p8', timeSig: { num: 8, den: 4 }, notes: { kick: notes([0]) } });
  lib.p8 = p8;
  const clicks = (o: NoteOut[]) => o.filter((n) => n.sound.startsWith('click')).sort((a, b) => a.tick - b.tick);

  it('3-beat waltz x2 then 4-beat x2: boundaries, end and click accents', () => {
    const { src } = mk([sec('waltz', 2), sec('pA', 2)], { click: { enabled: true, volume: 0.5 } });
    const out = playTo(src, 0, 8 * BAR, 240);
    expect(src.ended).toBe(2 * 1440 + 2 * BAR);
    expect(src.ended).toBe(6720);
    expect(has(out, 2880, 'kick')).toBe(true); // pA starts at the section boundary
    expect(has(out, 2880 + 480, 'hatClosed')).toBe(true);
    const acc = clicks(out).filter((n) => n.sound === 'clickAccent').map((n) => n.tick);
    expect(acc).toEqual([0, 1440, 2880, 4800, 6720]);
    expect(clicks(out).filter((n) => n.tick < 6720)).toHaveLength(2 * 3 + 2 * 4);
    expect(src.infoAt(1500)).toMatchObject({ sectionIndex: 0, barInSection: 1, beat: 0, beatsPerBar: 3 });
    expect(src.infoAt(3000)).toMatchObject({ sectionIndex: 1, barInSection: 0, beatsPerBar: 4 });
  });

  it('count-in uses the start section groove length, at least 4 beats', () => {
    const w = mk([sec('waltz', 1), sec('pA', 1)], { countInBars: 2, click: { enabled: true, volume: 0.5 } });
    expect(w.src.startTick()).toBe(-2 * 1920); // 3-beat waltz: the count-in bar is 4 beats
    const out = collect(w.src, -2 * 1920, 0);
    expect(clicks(out).map((n) => `${n.tick}:${n.sound}`)).toEqual([
      '-3840:clickAccent', '-3360:click', '-2880:click', '-2400:click',
      '-1920:clickAccent', '-1440:click', '-960:click', '-480:click',
    ]);
    expect(w.src.infoAt(-1000)).toMatchObject({ countIn: 3, beatsPerBar: 4 });
    const f = mk([sec('pA', 1), sec('waltz', 1)], { countInBars: 1 }, {}, { startSection: 1 });
    expect(f.src.startTick()).toBe(-1920);
    const long = mk([sec('p8', 1)], { countInBars: 1 });
    expect(long.src.startTick()).toBe(-3840); // longer grooves keep their own length
  });

  describe('grooves that are not whole beats', () => {
    const three = mkPattern({ id: 'three', steps: 3, timeSig: { num: 1, den: 4 }, notes: { snare: notes([0, 240]), kick: notes([120]) } });
    const five = mkPattern({ id: 'five', steps: 5, timeSig: { num: 2, den: 4 }, notes: { kick: notes([0]), snare: notes([480]) } });
    lib.three = three;
    lib.five = five;

    it('a 3-step groove makes a 360-tick bar', () => {
      const { src } = mk([sec('three', 4), sec('pA', 1)], { click: { enabled: true, volume: 0.5 } });
      const out = playTo(src, 0, 4 * 360 + 1920, 360);
      expect(ticksOf(out, 'snare').filter((t) => t < 1440)).toEqual([0, 240, 360, 600, 720, 960, 1080, 1320]);
      expect(ticksOf(out, 'kick').filter((t) => t < 1440)).toEqual([120, 480, 840, 1200]);
      // one click per beat from each bar start: just the accent of each 3-step bar
      const c = out.filter((n) => n.sound.startsWith('click') && n.tick < 1440).map((n) => `${n.tick}:${n.sound}`);
      expect(c).toEqual(['0:clickAccent', '360:clickAccent', '720:clickAccent', '1080:clickAccent']);
      expect(src.infoAt(400)).toMatchObject({ sectionIndex: 0, barInSection: 1, beatsPerBar: 1 });
      expect(src.infoAt(1440)).toMatchObject({ sectionIndex: 1, barInSection: 0, beatsPerBar: 4 });
    });

    it('a 5-step groove: 600-tick bars, clicks counted from each bar start', () => {
      const { src } = mk([sec('five', 2), sec('pA', 1)], { click: { enabled: true, volume: 0.5 } });
      const out = playTo(src, 0, 1200, 300);
      expect(ticksOf(out, 'kick').filter((t) => t < 1200)).toEqual([0, 600]);
      const c = out.filter((n) => n.sound.startsWith('click') && n.tick < 1200).map((n) => `${n.tick}:${n.sound}`);
      expect(c).toEqual(['0:clickAccent', '480:click', '600:clickAccent', '1080:click']);
    });

    it('count-in of a 3-step start section is 4 beats', () => {
      const w = mk([sec('three', 1)], { countInBars: 1, click: { enabled: true, volume: 0.5 } });
      expect(w.src.startTick()).toBe(-1920);
      const out = collect(w.src, -1920, 0);
      expect(clicks(out).map((n) => n.tick)).toEqual([-1920, -1440, -960, -480]);
    });

    it('a fill longer than the bar still ends at the bar end', () => {
      const { src } = mk([sec('three', 2, { fill: { enabled: true, patternId: 'fill4' } }), sec('pA', 1)], {});
      const out = playTo(src, 0, 720 + 1920, 360);
      // fill4 (1920 ticks) ends where the 360-tick bar ends (720): only its last 360 ticks are heard (fill tick 1680 at 480)
      expect(ticksOf(out, 'tomMid').filter((t) => t < 720)).toEqual([480]);
    });
  });

  it('8-beat groove x2 with a 4-beat fill: groove plays 4 beats, the fill covers the last 4', () => {
    const { src } = mk([sec('p8', 2, { fill: { enabled: true, patternId: 'fill4' } }), sec('pA', 1)]);
    const out = playTo(src, 0, 8 * BAR);
    expect(src.infoAt(0)).toMatchObject({ beatsPerBar: 8 });
    // pass 2 spans 3840..7680; fill tail occupies 5760..7680 (toms in beats 3-4 of the fill)
    expect(ticksOf(out, 'tomMid')).toEqual([6720, 6960, 7200, 7440]);
    expect(ticksOf(out, 'kick').filter((t) => t < 7680)).toEqual([0, 3840]);
    expect(src.ended).toBe(7680 + BAR);
  });

  it('NEXT applies at the current section pass boundary', () => {
    const { src } = mk([sec('p8', 4), sec('pB', 1)]);
    src.collect(0, 1000, []);
    src.act({ type: 'next' }, 1000);
    const out = collect(src, 1000, 8 * BAR);
    expect(ticksOf(out, 'snare')[0]).toBe(3840); // end of pass 1 (8 beats)
    expect(ticksOf(out, 'kick').filter((t) => t > 1000 && t < 5760)).toEqual([]); // 5760 = final hit
  });

  it('missing pattern keeps 4-beat bars', () => {
    const { src } = mk([sec('nope', 3), sec('waltz', 1)]);
    expect(src.timeSig()).toEqual({ num: 4, den: 4 });
    const out = playTo(src, 0, 6 * BAR);
    expect(ticksOf(out, 'kick')[0]).toBe(3 * BAR);
    expect(src.ended).toBe(3 * BAR + 1440);
  });

  it('tempo is constant across sections of different lengths (fake clock, 120 BPM)', () => {
    class FakeClock implements Clock {
      t = 10;
      now() {
        return this.t;
      }
    }
    const { src } = mk([sec('waltz', 2), sec('pA', 1), sec('p8', 1)], { click: { enabled: true, volume: 0.5 } });
    const clock = new FakeClock();
    const rec: Array<{ time: number; sound: SinkSound }> = [];
    const sink: NoteSink = { play: (time, sound) => rec.push({ time, sound }), stopAll: () => {} };
    const s = new Scheduler({ clock, sink, source: src });
    s.setBpm(120);
    const t0 = clock.t + 0.06;
    s.start(0);
    for (let i = 0; i < 1200; i++) {
      clock.t += 0.025;
      s.pump();
    }
    const acc = rec.filter((r) => r.sound === 'clickAccent').map((r) => +(r.time - t0).toFixed(6));
    // bars: 3, 3, 4, 8 beats at 0.5 s per beat
    expect(acc.slice(0, 4)).toEqual([0, 1.5, 3, 5]);
    expect(rec.filter((r) => r.sound === 'click' || r.sound === 'clickAccent').slice(0, 6).map((r) => +(r.time - t0).toFixed(6))).toEqual([0, 0.5, 1, 1.5, 2, 2.5]);
  });
});

describe('window independence', () => {
  function rng(seed: number) {
    let x = seed;
    return () => ((x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296);
  }
  const arrangement = () => [
    sec('pA', 3, { fill: { enabled: true, patternId: null } }),
    sec('pB', 4, { fill: { enabled: true, patternId: 'fill8' } }),
    sec('pC', 2, { loop: false }),
    sec('pA', 1, { fill: { enabled: true, patternId: 'fill1' } }),
  ];

  it('random contiguous windows equal one big window and never duplicate events', () => {
    const cfg = { click: { enabled: true, volume: 0.7 }, countInBars: 2 as const };
    const whole = mk(arrangement(), cfg).src;
    const big = collect(whole, whole.startTick(), 30 * BAR);
    for (let seed = 1; seed <= 20; seed++) {
      const r = rng(seed);
      const s = mk(arrangement(), cfg).src;
      const out: NoteOut[] = [];
      let t = s.startTick();
      while (t < 30 * BAR) {
        const e = Math.min(30 * BAR, t + 1 + Math.floor(r() * 2000));
        s.collect(t, e, out);
        t = e;
      }
      expect(sortedKeys(out)).toEqual(sortedKeys(big));
      expect(new Set(sortedKeys(out).map((k, i, a) => (a.indexOf(k) === i ? k : 'dup'))).has('dup')).toBe(false);
      expect(s.ended).toBe(whole.ended);
    }
    expect(whole.ended).toBe(10 * BAR);
  });

  it('reset restarts the song identically', () => {
    const { src } = mk(arrangement());
    const a = collect(src, 0, 20 * BAR);
    src.reset();
    expect(src.ended).toBeNull();
    expect(sortedKeys(collect(src, 0, 20 * BAR))).toEqual(sortedKeys(a));
  });
});

describe('Scheduler integration (fake clock)', () => {
  class FakeClock implements Clock {
    t = 10;
    now() {
      return this.t;
    }
  }
  function setup(src: SongSource, bpm = 120) {
    const clock = new FakeClock();
    const rec: Array<{ time: number; sound: SinkSound; vel: number }> = [];
    const sink: NoteSink = { play: (time, sound, vel) => rec.push({ time, sound, vel }), stopAll: () => {} };
    const s = new Scheduler({ clock, sink, source: src });
    s.setBpm(bpm);
    const t0 = clock.t + 0.06;
    s.start(src.startTick());
    const run = (sec: number) => {
      const end = clock.t + sec;
      while (clock.t < end) {
        clock.t += 0.025;
        s.pump();
      }
    };
    return { clock, rec, s, run, t0 };
  }

  it('120 BPM: count-in then sections land on exact audio times', () => {
    const src = mk([sec('pA', 1), sec('pB', 1)], { countInBars: 1 }).src;
    const h = setup(src);
    h.run(10);
    // 120 BPM => 0.5 s per beat, bar = 2 s; count-in bar first
    const clicks = h.rec.filter((r) => r.sound.startsWith('click'));
    expect(clicks.map((c) => +(c.time - h.t0).toFixed(6))).toEqual([0, 0.5, 1, 1.5]);
    const snare = h.rec.find((r) => r.sound === 'snare')!;
    expect(snare.time - h.t0).toBeCloseTo(4, 9); // bar 0 (A) 2s after count-in; section B at 2 + 2
    const kick0 = h.rec.find((r) => r.sound === 'kick')!;
    expect(kick0.time - h.t0).toBeCloseTo(2, 9);
    const crash = h.rec.find((r) => r.sound === 'crash')!;
    expect(crash.time - h.t0).toBeCloseTo(6, 9);
  });

  it('NEXT through the scheduler flow lands exactly on a bar line time', () => {
    const src = mk([sec('pA', 8), sec('pB', 8)]).src;
    const h = setup(src);
    h.run(3.1); // inside bar 1 (2s..4s)
    src.act({ type: 'next' }, h.s.scheduledUntil);
    h.run(10);
    const snares = h.rec.filter((r) => r.sound === 'snare');
    expect(snares[0]!.time - h.t0).toBeCloseTo(4, 9); // next bar line after the lookahead: 2 s bars → 4.0
    expect(h.rec.filter((r) => r.sound === 'kick' && r.time - h.t0 > 4.0 - 1e-9 && r.time - h.t0 < 8)).toHaveLength(0);
  });
});
