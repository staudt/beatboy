import { useComputed, useSignal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';
import { applyBeatText, formatBeatText, parseBeatText, type ParseResult } from '../../domain/notation';
import { SOUND_IDS } from '../../domain/types';
import { SOUNDS } from '../../domain/sounds';
import { current, editCurrent, showToast, textDraft } from '../state/lab';

const RULES =
  '- or . rest · + joins hits (k+x) · UPPERCASE accent · (s) ghost · | bar line · [ … ]*2 repeat · spaces are ignored · # comment · | is cosmetic · write one token per beat, 8th or 16th';

function CheatSheet() {
  return (
    <details class="cheat">
      <summary>Cheat sheet</summary>
      <p class="cheat-rules">{RULES}</p>
      <dl class="cheat-letters">
        {SOUND_IDS.map((id) => (
          <div key={id} class="cheat-item">
            <dt>{SOUNDS[id].letter}</dt>
            <dd>{SOUNDS[id].name}</dd>
          </div>
        ))}
      </dl>
      <p class="cheat-rules">Aliases: b = kick, h = open hat.</p>
    </details>
  );
}

export function TextPanel() {
  const p = current.value;
  const formatted = useComputed(() => formatBeatText(current.value));
  const draft = textDraft.value;
  const text = draft ?? formatted.value.text;
  // Debounced parse of the draft (the formatted text is always valid).
  const parsed = useSignal<{ text: string; ctx: string; result: ParseResult } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ctx = `${p.id}|${p.timeSig.num}/${p.timeSig.den}|${p.stepsPerBeat}`;

  useEffect(() => {
    clearTimeout(timer.current);
    if (draft === null) return;
    timer.current = setTimeout(() => {
      const cur = current.peek();
      parsed.value = {
        text: draft,
        ctx,
        result: parseBeatText(draft, { timeSig: cur.timeSig, stepsPerBeat: cur.stepsPerBeat }),
      };
    }, 150);
    return () => clearTimeout(timer.current);
  }, [draft, ctx]);

  const fresh = draft !== null && parsed.value?.text === draft && parsed.value.ctx === ctx ? parsed.value.result : null;
  const dirty = draft !== null;
  const dropped = formatted.value.droppedOffGrid;

  const apply = () => {
    if (draft === null) return;
    let res: ReturnType<typeof applyBeatText> | null = null;
    editCurrent((q) => {
      res = applyBeatText(q, draft);
      return res.ok ? res.pattern : q;
    });
    const r = res as ReturnType<typeof applyBeatText> | null;
    if (r && r.ok) {
      textDraft.value = null;
      if (r.warnings.length > 0) showToast(r.warnings[0] as string);
    } else if (r && !r.ok) {
      parsed.value = { text: draft, ctx, result: { ok: false, errors: r.errors } };
    }
  };

  let status;
  if (!dirty) {
    status = (
      <p class="parse ok" role="status">
        ✓ {p.timeSig.num} beat{p.timeSig.num === 1 ? '' : 's'} · read as {formatted.value.resolution}
      </p>
    );
  } else if (!fresh) {
    status = (
      <p class="parse" role="status">
        Checking…
      </p>
    );
  } else if (fresh.ok) {
    status = (
      <p class="parse ok" role="status">
        ✓ {fresh.beats} beat{fresh.beats === 1 ? '' : 's'} · read as {fresh.resolution}
        {fresh.warnings.length > 0 && <span class="parse-warn"> · {fresh.warnings[0]}</span>}
      </p>
    );
  } else {
    status = (
      <ul class="parse err" role="alert" aria-label="Notation errors">
        {fresh.errors.map((e, i) => (
          <li key={i}>
            Line {e.line}, col {e.col}: {e.message}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section class="textpanel" aria-label="Beat text">
      <textarea
        class="textarea"
        aria-label="Beat text"
        value={text}
        rows={Math.min(12, Math.max(4, text.split('\n').length + 1))}
        spellcheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        onInput={(e) => {
          const v = e.currentTarget.value;
          textDraft.value = v === formatted.peek().text ? null : v;
        }}
      />
      {status}
      {dropped > 0 && (
        <p class="notice">
          {dropped} off-grid note{dropped === 1 ? '' : 's'} can't be written as text and would be dropped if you apply.
        </p>
      )}
      <div class="text-actions">
        <button type="button" class="btn btn-primary" disabled={!dirty || (fresh !== null && !fresh.ok)} onClick={apply}>
          Apply
        </button>
        <button type="button" class="btn" disabled={!dirty} onClick={() => (textDraft.value = null)}>
          Revert
        </button>
      </div>
      <CheatSheet />
    </section>
  );
}
