/**
 * Seamless link between the Drummer (songs) and the Beat Editor.
 *
 * The rules are small pure functions in linkLogic.ts (unit-tested); `initLink()` wires them to the route signal (so
 * tab clicks, keyboard and the back button behave identically) and to the editor's copy-on-write.
 */
import { effect } from '@preact/signals';
import { engine } from '../../audio/engine';
import type { Pattern } from '../../domain/types';
import * as drummer from './drummer';
import * as lab from './lab';
import * as songs from './songs';
import { route, type Route } from '../router';
import { editorPlayAction, routeChangeAction } from './linkLogic';

/** Editor Play/Stop (button and Space). Call from a user gesture. */
export function editorTogglePlay(): void {
  if (editorPlayAction({ playing: engine.playing }) === 'stop') {
    engine.stop();
    return;
  }
  engine.setBpm(drummer.bpm.peek());
  const started = engine.playPattern(() => lab.current.peek());
  lab.trackKit(started);
  started.catch(() => {});
}

/** Pattern of the section a playing song is in right now (null unless a song plays). */
function playingSectionPatternId(): string | null {
  if (engine.mode !== 'song') return null;
  const i = songs.playingSectionIndex.peek();
  return i === null ? null : (songs.currentSong.peek()?.sections[i]?.patternId ?? null);
}

let inited = false;
export function initLink(): void {
  if (inited) return;
  inited = true;
  let prev: Route = route.peek();
  effect(() => {
    const to = route.value;
    const from = prev;
    prev = to;
    if (from === to) return;
    const a = routeChangeAction(from, to, {
      mode: engine.mode,
      editorId: lab.currentId.peek(),
      songPatternId: playingSectionPatternId(),
    });
    if (a.selectEditor) lab.selectPattern(a.selectEditor);
    if (a.stop) engine.stop();
  });
  lab.hooks.onCopied = (from: Pattern, copy: Pattern) => songs.followCopy(from.id, copy.id);
}
