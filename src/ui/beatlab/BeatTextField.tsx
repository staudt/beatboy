import { useSignal } from '@preact/signals';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { applyBeatText, formatBeatText, parseBeatText, stepsCaption, type NotationError } from '../../domain/notation';
import { patternSteps } from '../../domain/time';
import { SOUND_IDS } from '../../domain/types';
import { SOUNDS } from '../../domain/sounds';
import { current, editCurrent, showToast } from '../state/lab';
import { isDesktop } from '../media';

const RULES =
  'Spaces separate steps; letters written together sound together (kh = kick + hat) · . or - rest · UPPERCASE accent · (s) ghost · [ … ]*2 repeat · | is cosmetic · # comment · every step is one square (a 16th, or a triplet step) and the loop is exactly as long as you type';

function CheatSheet() {
  return (
    <div class="cheat" id="beat-syntax">
      <p class="cheat-rules">{RULES}</p>
      <dl class="cheat-letters">
        {SOUND_IDS.map((id) => (
          <div key={id} class="cheat-item">
            <dt>{SOUNDS[id].letter}</dt>
            <dd>{SOUNDS[id].name}</dd>
          </div>
        ))}
      </dl>
      <p class="cheat-rules">Aliases: b = kick, x = closed hat. Example: kh . sh . = kick+hat, rest, snare+hat, rest.</p>
    </div>
  );
}

type Problem = { kind: 'err'; errors: NotationError[] } | { kind: 'empty' } | null;

/**
 * The beat text: the primary, always-visible way to edit a pattern. Typing applies live (debounced) when it
 * parses; the pads and grid below are helpers that rewrite this field. The field is never rewritten under the
 * caret: while it is focused and has been typed in, grid edits wait until blur.
 */
/** Phones get 2 beats per line so lines break on beat boundaries instead of wrapping mid-beat. */
const format = (p: Parameters<typeof formatBeatText>[0], desktop: boolean) =>
  formatBeatText(p, { beatsPerLine: desktop ? 4 : 2 });

export function BeatTextField() {
  const p = current.value;
  const desktop = isDesktop.value;
  const formatted = format(p, desktop);
  const ta = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dirty = useRef(false); // typed since focus, not yet reconciled
  const focused = useRef(false);
  const applied = useRef<string | null>(null); // field text last applied by commit (null = none since focus)
  const problem = useSignal<Problem>(null);
  const hint = useSignal<string | null>(null);
  const syntax = useSignal(false);
  const lastId = useRef(p.id);

  const grow = () => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  };
  const show = (text: string) => {
    const el = ta.current;
    if (!el) return;
    if (el.value !== text) el.value = text;
    grow();
  };

  // Follow the pattern (grid edits, picking another pattern) unless the user is mid-typing.
  useLayoutEffect(() => {
    const idChanged = lastId.current !== p.id;
    lastId.current = p.id;
    if (idChanged) {
      clearTimeout(timer.current);
      dirty.current = false;
      problem.value = null;
      hint.value = null;
    }
    if (focused.current && dirty.current) return;
    show(formatted.text);
  }, [formatted.text, p.id]);

  useEffect(() => {
    const onResize = () => grow();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      clearTimeout(timer.current);
    };
  }, []);

  /** Parses and applies the field's text; returns false when it was not applied (invalid or empty). */
  const commit = (): boolean => {
    const el = ta.current;
    if (!el) return false;
    const text = el.value;
    const cur = current.peek();
    const r = parseBeatText(text, { stepsPerBeat: cur.stepsPerBeat });
    if (!r.ok) {
      problem.value = { kind: 'err', errors: r.errors };
      return false;
    }
    if (r.steps === 0) {
      problem.value = { kind: 'empty' };
      return false;
    }
    problem.value = null;
    applied.current = text;
    const before = formatBeatText(cur).text;
    const res = applyBeatText(cur, text);
    if (!res.ok || formatBeatText(res.pattern).text === before) return true; // nothing to change
    editCurrent(() => res.pattern);
    lastId.current = current.peek().id; // a built-in was copied by our own edit: not a pattern switch
    if (res.warnings.length > 0) showToast(res.warnings[0] as string);
    return true;
  };

  const revert = (message: string | null) => {
    clearTimeout(timer.current);
    dirty.current = false;
    applied.current = null;
    problem.value = null;
    hint.value = message;
    show(format(current.peek(), isDesktop.peek()).text);
  };

  const onInput = () => {
    dirty.current = true;
    hint.value = null;
    grow();
    clearTimeout(timer.current);
    timer.current = setTimeout(commit, 250);
  };

  const onBlur = () => {
    focused.current = false;
    clearTimeout(timer.current);
    if (!dirty.current) return;
    if (applied.current === ta.current?.value) return revert(null); // already applied; keep later grid edits
    if (commit()) revert(null);
    else revert(problem.peek()?.kind === 'err' ? 'Reverted — invalid beat' : null);
  };

  const prob = problem.value;
  const dropped = formatted.droppedOffGrid;
  let caption;
  if (prob?.kind === 'err') {
    const [first, ...rest] = prob.errors;
    caption = (
      <p class="parse err" role="alert" aria-label="Notation errors">
        Line {first?.line}, col {first?.col}: {first?.message}
        {rest.length > 0 && <span class="parse-more"> (+{rest.length} more)</span>}
      </p>
    );
  } else if (prob?.kind === 'empty') {
    caption = <p class="parse" role="status">Type at least one step (. is a rest)</p>;
  } else if (hint.value) {
    caption = <p class="parse warn" role="status">{hint.value}</p>;
  } else {
    caption = <p class="parse ok" role="status">{stepsCaption(patternSteps(p), p.stepsPerBeat)}</p>;
  }

  return (
    <section class="beattext" aria-label="Beat text editor">
      <textarea
        ref={ta}
        class={`textarea beattext-field${prob?.kind === 'err' ? ' invalid' : ''}`}
        aria-label="Beat text"
        aria-invalid={prob?.kind === 'err'}
        defaultValue={formatted.text}
        rows={1}
        spellcheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        onFocus={() => {
          focused.current = true;
          hint.value = null;
        }}
        onInput={onInput}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            revert(null);
            e.currentTarget.blur();
          }
        }}
      />
      <div class="beattext-caption">
        {caption}
        <button
          type="button"
          class="syntax-toggle"
          aria-expanded={syntax.value}
          aria-controls="beat-syntax"
          onClick={() => (syntax.value = !syntax.value)}
        >
          {syntax.value ? 'Hide syntax' : '? Syntax'}
        </button>
      </div>
      {dropped > 0 && (
        <p class="notice">
          {dropped} off-grid note{dropped === 1 ? '' : 's'} can't be written as text and would be dropped if you edit it.
        </p>
      )}
      {syntax.value && <CheatSheet />}
    </section>
  );
}
