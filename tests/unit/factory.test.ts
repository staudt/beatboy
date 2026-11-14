import { describe, expect, it } from 'vitest';
import { FACTORY_SPECS, factoryPatterns } from '../../src/domain/factory';
import { parseBeatText } from '../../src/domain/notation';
import { noteCount } from '../../src/domain/patternOps';

describe('factory patterns', () => {
  it('all parse into exactly one full bar with no warnings', () => {
    for (const s of FACTORY_SPECS) {
      const r = parseBeatText(s.text, { timeSig: s.timeSig ?? { num: 4, den: 4 }, stepsPerBeat: s.stepsPerBeat });
      expect(r.ok, s.id).toBe(true);
      if (r.ok) {
        expect(r.warnings, s.id).toEqual([]);
        expect(r.bars, s.id).toBe(1);
      }
    }
  });

  it('builds read-only patterns with stable unique ids and notes', () => {
    const ps = factoryPatterns();
    expect(new Set(ps.map((p) => p.id)).size).toBe(ps.length);
    for (const p of ps) {
      expect(p.builtIn).toBe(true);
      expect(p.id.startsWith('f-')).toBe(true);
      expect(noteCount(p)).toBeGreaterThan(0);
      expect(Object.isFrozen(p)).toBe(true);
    }
  });

  it('rock 8ths has kick on 1, 3, &3 and snare on 2, 4', () => {
    const p = factoryPatterns().find((x) => x.id === 'f-rock-8ths')!;
    expect(p.notes.kick!.map((n) => n.tick)).toEqual([0, 960, 1200]);
    expect(p.notes.snare!.map((n) => n.tick)).toEqual([480, 1440]);
    expect(p.notes.hatClosed!.length).toBe(8);
  });
});
