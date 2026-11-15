/**
 * Seamless link between the Drummer and the Beat Editor.
 *
* The rules are small pure functions in linkLogic.ts (unit-tested); `initLink()` wires them to the route signal (so tab clicks,
 * keyboard and the back button behave identically) and to the editor's copy-on-write.
 */
import { effect } from '@preact/signals';
import { engine } from '../../audio/engine';
import type { Pattern } from '../../domain/types';
import * as groove from './groove';
import * as lab from './lab';
import { route, type Route } from '../router';
import { editorPlayAction, grooveAfterCopy, routeChangeAction } from './linkLogic';

/** Editor Play/Stop (button and Space). Call from a user gesture. */
export function editorTogglePlay(): void {
  const action = editorPlayAction({
    playing: engine.playing,
    grooveId: groove.grooveId.peek(),
    editorId: lab.currentId.peek(),
  });
  if (action === 'stop') {
    engine.stop();
  } else if (action === 'groove') {
    groove.play({ countIn: false });
  } else {
    engine.setBpm(groove.bpm.peek());
    const started = engine.playPattern(() => lab.current.peek());
    lab.trackKit(started);
    started.catch(() => {});
  }
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
      grooveId: groove.grooveId.peek(),
      editorId: lab.currentId.peek(),
    });
    if (a.selectEditor) lab.selectPattern(a.selectEditor);
    if (a.stop) engine.stop();
  });
  lab.hooks.onCopied = (from: Pattern, copy: Pattern) => {
    const next = grooveAfterCopy(groove.grooveId.peek(), from.id, copy.id);
    if (next !== groove.grooveId.peek()) groove.grooveId.value = next;
  };
}
