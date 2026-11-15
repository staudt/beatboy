/** Pure link rules between the Drummer and the Beat Editor (unit-tested; see link.ts for the wiring). */
import type { EngineMode } from '../../audio/engine';
import type { Route } from '../router';

export interface RouteChangeAction {
  /** Select this pattern in the editor (before it renders). */
  selectEditor: string | null;
  /** Stop playback. */
  stop: boolean;
}

/** What to do when the user switches tabs. */
export function routeChangeAction(
  from: Route,
  to: Route,
  s: { mode: EngineMode; grooveId: string | null; editorId: string },
): RouteChangeAction {
  if (from === 'drummer' && to === 'editor') {
    const linked = s.mode === 'groove' && s.grooveId !== null && s.grooveId !== s.editorId;
    return { selectEditor: linked ? s.grooveId : null, stop: false };
  }
  if (from === 'editor' && to === 'drummer') return { selectEditor: null, stop: s.mode === 'lab' };
  return { selectEditor: null, stop: false };
}

/** What the editor's Play/Stop button does. */
export type EditorPlayAction = 'stop' | 'groove' | 'pattern';
export function editorPlayAction(s: {
  playing: boolean;
  grooveId: string | null;
  editorId: string;
}): EditorPlayAction {
  if (s.playing) return 'stop';
  return s.grooveId !== null && s.grooveId === s.editorId ? 'groove' : 'pattern';
}

/**
 * The Drummer's groove after the editor copied a built-in (copy-on-write): if the Drummer was on that
 * built-in it follows the copy — playing or not — so both tabs stay on the same beat.
 */
export function grooveAfterCopy(grooveId: string | null, fromId: string, copyId: string): string | null {
  return grooveId !== null && grooveId === fromId ? copyId : grooveId;
}

/** Which tab shows the "playing" dot. */
export function playingTabs(s: { mode: EngineMode; grooveId: string | null; editorId: string }): Record<Route, boolean> {
  return {
    drummer: s.mode === 'groove',
    editor: s.mode === 'lab' || (s.mode === 'groove' && s.grooveId !== null && s.grooveId === s.editorId),
  };
}
