import { describe, expect, it } from 'vitest';
import { editorPlayAction, playingTabs, routeChangeAction } from '../../src/ui/state/linkLogic';

type Mode = 'idle' | 'lab' | 'song';
const st = (mode: Mode, editorId: string, songPatternId: string | null = null) => ({ mode, editorId, songPatternId });

describe('routeChangeAction', () => {
  it('drummer -> editor selects the groove of the section that is playing; playback continues', () => {
    expect(routeChangeAction('drummer', 'editor', st('song', 'e1', 's1'))).toEqual({ selectEditor: 's1', stop: false });
  });
  it('drummer -> editor: nothing to link when idle, already linked or no section pattern', () => {
    expect(routeChangeAction('drummer', 'editor', st('idle', 'e1', 's1'))).toEqual({ selectEditor: null, stop: false });
    expect(routeChangeAction('drummer', 'editor', st('song', 's1', 's1'))).toEqual({ selectEditor: null, stop: false });
    expect(routeChangeAction('drummer', 'editor', st('song', 'e1', null))).toEqual({ selectEditor: null, stop: false });
  });
  it('editor -> drummer stops only the editor-owned (lab) playback', () => {
    expect(routeChangeAction('editor', 'drummer', st('lab', 'e1', 's1')).stop).toBe(true);
    expect(routeChangeAction('editor', 'drummer', st('song', 's1', 's1')).stop).toBe(false);
    expect(routeChangeAction('editor', 'drummer', st('idle', 'e1')).stop).toBe(false);
  });
});

describe('editorPlayAction', () => {
  it('stops when anything plays, otherwise loops the pattern', () => {
    expect(editorPlayAction({ playing: true })).toBe('stop');
    expect(editorPlayAction({ playing: false })).toBe('pattern');
  });
});

describe('playingTabs', () => {
  it('marks the tabs whose content is playing', () => {
    expect(playingTabs({ mode: 'song' })).toEqual({ drummer: true, editor: false });
    expect(playingTabs({ mode: 'lab' })).toEqual({ drummer: false, editor: true });
    expect(playingTabs({ mode: 'idle' })).toEqual({ drummer: false, editor: false });
  });
});
