import { describe, expect, it } from 'vitest';
import { editorPlayAction, grooveAfterCopy, playingTabs, routeChangeAction } from '../../src/ui/state/linkLogic';

const st = (mode: 'idle' | 'lab' | 'groove', grooveId: string | null, editorId: string) => ({ mode, grooveId, editorId });

describe('routeChangeAction', () => {
  it('drummer -> editor selects the playing groove', () => {
    expect(routeChangeAction('drummer', 'editor', st('groove', 'g1', 'e1'))).toEqual({ selectEditor: 'g1', stop: false });
  });
  it('drummer -> editor: click only, idle or already linked change nothing', () => {
    expect(routeChangeAction('drummer', 'editor', st('groove', null, 'e1'))).toEqual({ selectEditor: null, stop: false });
    expect(routeChangeAction('drummer', 'editor', st('idle', 'g1', 'e1'))).toEqual({ selectEditor: null, stop: false });
    expect(routeChangeAction('drummer', 'editor', st('groove', 'g1', 'g1'))).toEqual({ selectEditor: null, stop: false });
  });
  it('editor -> drummer stops only the editor-owned (lab) playback', () => {
    expect(routeChangeAction('editor', 'drummer', st('lab', 'g1', 'e1')).stop).toBe(true);
    expect(routeChangeAction('editor', 'drummer', st('lab', 'g1', 'g1')).stop).toBe(true);
    expect(routeChangeAction('editor', 'drummer', st('groove', 'g1', 'g1')).stop).toBe(false);
    expect(routeChangeAction('editor', 'drummer', st('groove', null, 'e1')).stop).toBe(false);
    expect(routeChangeAction('editor', 'drummer', st('idle', 'g1', 'e1')).stop).toBe(false);
  });
});

describe('editorPlayAction', () => {
  it('stops when anything plays', () => {
    expect(editorPlayAction({ playing: true, grooveId: 'a', editorId: 'a' })).toBe('stop');
  });
  it('starts the groove when linked, otherwise the pattern', () => {
    expect(editorPlayAction({ playing: false, grooveId: 'a', editorId: 'a' })).toBe('groove');
    expect(editorPlayAction({ playing: false, grooveId: 'a', editorId: 'b' })).toBe('pattern');
    expect(editorPlayAction({ playing: false, grooveId: null, editorId: 'b' })).toBe('pattern');
  });
});

describe('grooveAfterCopy', () => {
  it('follows the copy whenever the Drummer is on the copied built-in, playing or not', () => {
    expect(grooveAfterCopy('a', 'a', 'a2')).toBe('a2');
    expect(grooveAfterCopy('b', 'a', 'a2')).toBe('b');
    expect(grooveAfterCopy(null, 'a', 'a2')).toBeNull();
  });
});

describe('playingTabs', () => {
  it('marks the tabs whose content is playing', () => {
    expect(playingTabs(st('groove', 'g', 'e'))).toEqual({ drummer: true, editor: false });
    expect(playingTabs(st('groove', 'g', 'g'))).toEqual({ drummer: true, editor: true });
    expect(playingTabs(st('groove', null, 'e'))).toEqual({ drummer: true, editor: false });
    expect(playingTabs(st('lab', 'g', 'e'))).toEqual({ drummer: false, editor: true });
    expect(playingTabs(st('idle', 'g', 'g'))).toEqual({ drummer: false, editor: false });
  });
});
