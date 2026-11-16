import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseBeatText } from '../../src/domain/notation';
import { parseDrumTab, type TabImport } from '../../src/import/tab';

const DIR = join(__dirname, '..', 'fixtures', 'tabs');

interface Expected {
  description: string;
  reject: boolean;
  minConfidence: number;
  maxConfidence: number;
  song: { name: string; bpm: number | null };
  sections: { name: string; feel: 'straight' | 'triplet'; times: number; beat: string }[];
  warningsContain: string[];
}

const names = readdirSync(DIR)
  .filter((f) => f.endsWith('.txt'))
  .map((f) => f.slice(0, -4))
  .sort();

const tokens = (s: string): string[] => s.trim().split(/\s+/).filter(Boolean);

/** Every field check of one fixture; returns the failures (empty = fully passing). */
function check(got: TabImport, exp: Expected): string[] {
  const bad: string[] = [];
  if (got.reject !== exp.reject) bad.push(`reject: got ${got.reject}, want ${exp.reject}`);
  if (got.confidence < exp.minConfidence || got.confidence > exp.maxConfidence) {
    bad.push(`confidence ${got.confidence} not in [${exp.minConfidence}, ${exp.maxConfidence}]`);
  }
  if (got.song.name !== exp.song.name) bad.push(`song.name: got ${JSON.stringify(got.song.name)}, want ${JSON.stringify(exp.song.name)}`);
  if (got.song.bpm !== exp.song.bpm) bad.push(`song.bpm: got ${got.song.bpm}, want ${exp.song.bpm}`);
  if (got.sections.length !== exp.sections.length) {
    bad.push(`sections: got ${got.sections.length} (${got.sections.map((s) => s.name).join(', ')}), want ${exp.sections.length}`);
  }
  exp.sections.forEach((e, i) => {
    const g = got.sections[i];
    if (!g) return;
    if (g.name !== e.name) bad.push(`section ${i + 1} name: got ${JSON.stringify(g.name)}, want ${JSON.stringify(e.name)}`);
    if (g.feel !== e.feel) bad.push(`section ${i + 1} feel: got ${g.feel}, want ${e.feel}`);
    if (g.times !== e.times) bad.push(`section ${i + 1} times: got ${g.times}, want ${e.times}`);
    if (JSON.stringify(tokens(g.beat)) !== JSON.stringify(tokens(e.beat))) {
      bad.push(`section ${i + 1} (${e.name}) beat:\n    got  ${tokens(g.beat).join(' ')}\n    want ${tokens(e.beat).join(' ')}`);
    }
  });
  for (const w of exp.warningsContain) {
    if (!got.warnings.some((x) => x.toLowerCase().includes(w.toLowerCase()))) bad.push(`warning containing "${w}" missing (got: ${got.warnings.join(' | ')})`);
  }
  return bad;
}

const fields = { reject: [0, 0], confidence: [0, 0], song: [0, 0], sectionCount: [0, 0], sections: [0, 0], warnings: [0, 0] } as Record<string, [number, number]>;
let passing = 0;

describe('drum tab importer: fixture corpus', () => {
  it('has the full corpus (40 planned + 6 holdout)', () => {
    expect(names.length).toBe(46);
  });

  for (const name of names) {
    const text = readFileSync(join(DIR, `${name}.txt`), 'utf8');
    const exp = JSON.parse(readFileSync(join(DIR, `${name}.expected.json`), 'utf8')) as Expected;
    it(name, () => {
      const got = parseDrumTab(text);
      const bad = check(got, exp);
      // corpus score bookkeeping
      const tally = (k: string, ok: boolean) => {
        fields[k]![1]++;
        if (ok) fields[k]![0]++;
      };
      tally('reject', got.reject === exp.reject);
      tally('confidence', got.confidence >= exp.minConfidence && got.confidence <= exp.maxConfidence);
      tally('song', got.song.name === exp.song.name && got.song.bpm === exp.song.bpm);
      tally('sectionCount', got.sections.length === exp.sections.length);
      tally('sections', bad.every((b) => !/^section \d/.test(b) && !b.startsWith('sections:')));
      tally('warnings', exp.warningsContain.every((w) => got.warnings.some((x) => x.toLowerCase().includes(w.toLowerCase()))));
      if (bad.length === 0) passing++;
      expect(bad, bad.join('\n')).toEqual([]);
      // Speed is checked by the warmed-up "best of 5" test below (a single cold run is flaky under load).
      // the beats are valid beat text of the declared feel
      for (const s of got.sections) {
        const r = parseBeatText(s.beat, { stepsPerBeat: s.feel === 'triplet' ? 3 : 4 });
        expect(r.ok, `${name}: ${s.name} beat parses`).toBe(true);
      }
    });
  }

  afterAll(() => {
    const pct = (a: number, b: number) => `${a}/${b} (${Math.round((100 * a) / Math.max(1, b))}%)`;
    const lines = [
      '',
      '── tab importer corpus score ──',
      `fully passing fixtures: ${pct(passing, names.length)}`,
      ...Object.entries(fields).map(([k, [a, b]]) => `  ${k.padEnd(13)} ${pct(a, b)}`),
      '',
    ];
    console.log(lines.join('\n'));
  });
});

// ── robustness ───────────────────────────────────────────────────
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const ALPHABET = '-|xXoOgGfdbrcCsSkKhH.:*#()[]<>=_~ \n\n\t0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ –│​\r';

describe('drum tab importer: robustness', () => {
  const texts = names.map((n) => readFileSync(join(DIR, `${n}.txt`), 'utf8'));

  it('never throws on garbage and always returns a well-formed result', () => {
    const r = rng(12345);
    for (let i = 0; i < 500; i++) {
      const len = Math.floor(r() * 400);
      let s = '';
      for (let k = 0; k < len; k++) s += ALPHABET[Math.floor(r() * ALPHABET.length)];
      const out = parseDrumTab(s);
      expect(typeof out.reject).toBe('boolean');
      expect(out.confidence).toBeGreaterThanOrEqual(0);
      expect(out.confidence).toBeLessThanOrEqual(1);
      expect(Array.isArray(out.sections)).toBe(true);
      expect(out.sections.length).toBeLessThanOrEqual(32);
      if (out.reject) expect(out.sections).toEqual([]);
      for (const sec of out.sections) {
        expect(sec.times).toBeGreaterThanOrEqual(1);
        expect(sec.times).toBeLessThanOrEqual(64);
        expect(parseBeatText(sec.beat, { stepsPerBeat: sec.feel === 'triplet' ? 3 : 4 }).ok).toBe(true);
      }
    }
  });

  it('never throws on mutated fixtures', () => {
    const r = rng(777);
    for (let i = 0; i < 500; i++) {
      let s = texts[Math.floor(r() * texts.length)]!;
      const edits = 1 + Math.floor(r() * 12);
      for (let k = 0; k < edits; k++) {
        const at = Math.floor(r() * (s.length + 1));
        const op = r();
        if (op < 0.4) s = s.slice(0, at) + ALPHABET[Math.floor(r() * ALPHABET.length)] + s.slice(at);
        else if (op < 0.8) s = s.slice(0, at) + s.slice(at + 1 + Math.floor(r() * 5));
        else {
          const to = Math.min(s.length, at + Math.floor(r() * 60));
          s = s.slice(0, at) + s.slice(at, to) + s.slice(at, to) + s.slice(to);
        }
      }
      const out = parseDrumTab(s);
      expect(out.confidence).toBeLessThanOrEqual(1);
      for (const sec of out.sections) expect(parseBeatText(sec.beat, { stepsPerBeat: sec.feel === 'triplet' ? 3 : 4 }).ok).toBe(true);
    }
  });

  it('handles degenerate input', () => {
    for (const s of ['', ' ', '\n\n\n', '|', '||||||||', 'HH|', 'HH|||||||||||||', '-'.repeat(5000), 'HH|' + 'x-'.repeat(5000) + '|', ('HH|x-x-|\n'.repeat(3000))]) {
      const out = parseDrumTab(s);
      expect(out.sections.length).toBeLessThanOrEqual(32);
    }
    expect(parseDrumTab('').reject).toBe(true);
    expect(parseDrumTab(null as unknown as string).reject).toBe(true);
  });

  it('runs in under 50 ms for every fixture (best of 5) and for a large paste', () => {
    for (const t of texts) {
      let best = Infinity;
      for (let k = 0; k < 5; k++) {
        const t0 = performance.now();
        parseDrumTab(t);
        best = Math.min(best, performance.now() - t0);
      }
      expect(best).toBeLessThan(50);
    }
    const big = texts.join('\n\n');
    const t0 = performance.now();
    parseDrumTab(big);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
