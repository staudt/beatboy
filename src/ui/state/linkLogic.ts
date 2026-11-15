/** Pure link rules between the Drummer (songs) and the Beat Editor (unit-tested; see link.ts for the wiring). */
import type { EngineMode } from '../../audio/engine';
import type { Route } from '../router';

export interface RouteChangeAction {
  /** Select this pattern in the editor (before it renders). */
  selectEditor: string | null;
  /** Stop playback. */
  stop: boolean;
}

/**
 * What to do when the user switches tabs. Drummer -> Editor while a song plays links the editor to the groove of
 * the section that is playing right now (playback continues); while stopped it links to the focus section's groove
 * (the section last played or touched); Editor -> Drummer stops only the editor's own loop.
 */
export function routeChangeAction(
  from: Route,
  to: Route,
  s: { mode: EngineMode; editorId: string; songPatternId?: string | null; focusPatternId?: string | null },
): RouteChangeAction {
  if (from === 'drummer' && to === 'editor') {
    // Playing: the section playing right now. Stopped: the section last touched (focus), so the editor opens the beat just worked with.
    const id = s.mode === 'song' ? (s.songPatternId ?? s.focusPatternId ?? null) : (s.focusPatternId ?? null);
    return { selectEditor: id !== null && id !== s.editorId ? id : null, stop: false };
  }
  if (from === 'editor' && to === 'drummer') return { selectEditor: null, stop: s.mode === 'lab' };
  return { selectEditor: null, stop: false };
}

/** What the editor's Play/Stop button does: stop whatever plays, else loop the editor's pattern. */
export type EditorPlayAction = 'stop' | 'pattern';
export function editorPlayAction(s: { playing: boolean }): EditorPlayAction {
  return s.playing ? 'stop' : 'pattern';
}

/** Which tab shows the "playing" dot. */
export function playingTabs(s: { mode: EngineMode }): Record<Route, boolean> {
  return { drummer: s.mode === 'song', editor: s.mode === 'lab' };
}
