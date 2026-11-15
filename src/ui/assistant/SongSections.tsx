import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { SECTION_KINDS, SECTION_LABELS, SONG_LIMITS, type Section } from '../../domain/song';
import { formatBeatText, stepsCaption } from '../../domain/notation';
import { feelOf } from '../../domain/patternOps';
import { isSongLocal, parseSectionText } from '../../domain/songBeats';
import { lengthLabel } from '../../domain/time';
import type { Pattern } from '../../domain/types';
import { IconChevronDown, IconCopy, IconLoop, IconMinus, IconPlus, IconTrash } from '../common/icons';
import { isTouch, PatternPicker } from '../common/PatternPicker';
import { fills, grooves } from '../state/drummer';
import { isDoubleTap, isTap, LONG_PRESS_MS, TAP_SLOP, type TapPoint } from '../state/songLogic';
import { library, saveAsGroove } from '../state/lab';
import { openInEditor } from '../state/link';
import {
  addSectionOfKind,
  currentSong,
  deleteSectionById,
  duplicateSectionById,
  moveSectionBy,
  moveSectionTo,
  patchSection,
  playingSectionIndex,
  selectedSectionId,
  setDefaultFill,
  setSectionText,
  songInfo,
  songPlaying,
  tapSection,
  touchSection,
} from '../state/songs';

const beatsLabel = (p: Pattern) => `${lengthLabel(p)} · ${feelOf(p)}`;

/** `pass` = one play of the groove ("4 beats", "3 steps"); shown in the tooltip unless it's a plain 4-beat bar. */
function BarsEditor({ section, pass }: { section: Section; pass: string }) {
  const set = (v: number) => patchSection(section.id, { bars: v });
  const times = `${section.bars} time${section.bars === 1 ? '' : 's'}`;
  return (
    <div class="stepper sc-stepper" role="group" aria-label="Repeats" title={`Plays the groove ${times}${pass !== '4 beats' ? ` (${pass} each)` : ''}`}>
      <button type="button" class="btn btn-icon" aria-label="Plays fewer" disabled={section.bars <= SONG_LIMITS.minBars} onClick={() => set(section.bars - 1)}>
        <IconMinus />
      </button>
      <span class="sc-times" aria-hidden="true">
        ×
      </span>
      <input
        class="sc-bars-input"
        type="text"
        inputMode="numeric"
        maxLength={2}
        value={section.bars}
        aria-label={`Plays ${section.bars} time${section.bars === 1 ? '' : 's'}`}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          const v = Number(e.currentTarget.value);
          if (Number.isFinite(v) && v > 0) set(v);
          e.currentTarget.value = String(currentSong.peek()?.sections.find((s) => s.id === section.id)?.bars ?? section.bars);
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <button type="button" class="btn btn-icon" aria-label="Plays more" disabled={section.bars >= SONG_LIMITS.maxBars} onClick={() => set(section.bars + 1)}>
        <IconPlus />
      </button>
    </div>
  );
}

/** The section name: plain text (a tap on it jumps like the rest of the row) that becomes a text field on rename (Enter / blur commits, Escape cancels). */
function SectionLabel({ section, editing, onDone }: { section: Section; editing: boolean; onDone: () => void }) {
  const cancelled = useRef(false);
  const openedAt = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) {
      cancelled.current = false;
      openedAt.current = Date.now();
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  if (!editing) {
    return (
      <span class="sc-label" data-row-label title="Double-click or press F2 to rename">
        {section.name}
      </span>
    );
  }
  const commit = () => {
    // a touch that opened the field is followed by emulated mouse events that steal focus: take it back
    if (!cancelled.current && Date.now() - openedAt.current < 250) {
      input.current?.focus();
      return;
    }
    onDone();
    if (!cancelled.current && input.current && input.current.value.trim() !== section.name) patchSection(section.id, { name: input.current.value });
  };
  return (
    <input
      ref={input}
      class="sc-label-input"
      type="text"
      defaultValue={section.name}
      maxLength={32}
      aria-label="Section name"
      autoComplete="off"
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          openedAt.current = 0;
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.stopPropagation();
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

const BEAT_DEBOUNCE = 250;
const MAX_LINES = 3;

interface SlotProps {
  section: Section;
  pattern: Pattern | undefined;
  local: boolean;
  value: string;
  error: string | null;
  info: string;
  saveName: string;
  onValue: (v: string) => void;
  onSaveName: (v: string) => void;
  /** Enter: apply and close (stays open when the text is invalid). */
  onEnter: () => void;
  onOpenEditor: () => void;
  onSave: () => void;
}

/** Top of the section beat panel: text editor, then name and save. */
function BeatSlot({ section, pattern, local, value, error, info, saveName, onValue, onSaveName, onEnter, onOpenEditor, onSave }: SlotProps) {
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('autocapitalize', 'off');
    if (!isTouch()) {
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, []);
  // auto-grow up to MAX_LINES lines
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 22;
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    el.style.height = `${Math.min(el.scrollHeight, line * MAX_LINES + pad)}px`;
  }, [value]);
  return (
    <>
      <div class="sb-edit">
        <label class="label" for={`sb-text-${section.id}`}>
          beat text
        </label>
        <textarea
          id={`sb-text-${section.id}`}
          ref={area}
          class={`sb-text${error ? ' is-invalid' : ''}`}
          rows={1}
          value={value}
          spellcheck={false}
          autocomplete="off"
          enterkeyhint="done"
          aria-label={`Beat for ${section.name}`}
          aria-invalid={error ? 'true' : undefined}
          data-testid="beat-text"
          onInput={(e) => onValue(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
              e.preventDefault();
              onEnter();
            }
          }}
        />
        <div class="sb-row">
          <p class={error ? 'sb-cap sc-err' : 'sb-cap'}>
            <span data-testid={error ? 'beat-error' : 'beat-info'} role={error ? 'alert' : undefined}>
              {error ?? (info || ' ')}
            </span>
          </p>
          <button type="button" class="btn sb-btn" disabled={!pattern} onClick={onOpenEditor}>
            Open in Beat Editor
          </button>
        </div>
      </div>
      <div class="sb-save" data-testid="beat-save">
        {local ? (
          <>
            <label class="pp-field sb-name">
              <span class="label">groove name</span>
              <input
                class="input"
                type="text"
                value={saveName}
                maxLength={48}
                aria-label="Groove name"
                autoComplete="off"
                onInput={(e) => onSaveName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.isComposing) {
                    e.preventDefault();
                    if (!error) onSave();
                  }
                }}
              />
            </label>
            <button type="button" class="btn btn-primary sb-btn" disabled={!!error} onClick={onSave}>
              Save as groove
            </button>
          </>
        ) : (
          <div class="sb-groove">
            <span class="label">saved groove</span>
            <b class="sb-groove-name" data-testid="beat-groove-name">
              {pattern?.name ?? 'missing groove'}
            </b>
            {pattern?.builtIn && <span class="tag">Built-in</span>}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * The section's beat: a read-only display (the groove's name, or the written pattern of a song beat) that opens a panel with
 * the beat text editor, name and save, and the groove list. Typing applies live (debounced): see setSectionText for the song-local rules.
 */
function BeatCombo({ section, pattern }: { section: Section; pattern: Pattern | undefined }) {
  const local = isSongLocal(pattern);
  const text = pattern ? formatBeatText(pattern, { lineBreaks: false }).text : '';
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(text);
  /** null until the user edits it: the name follows the song beat's own name (it is created by the first edit of a groove). */
  const [saveName, setSaveName] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastApplied = useRef(text);
  const latest = useRef(text);
  const apply = (v: string): boolean => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (v === lastApplied.current) return true;
    const ok = setSectionText(section.id, v).ok;
    if (ok) lastApplied.current = v;
    return ok;
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const parsed = open ? parseSectionText(pattern, value) : null;
  let error: string | null = null;
  let info = '';
  if (parsed && !parsed.ok) {
    const e = parsed.errors[0]!;
    error = `${e.line > 1 ? `line ${e.line}, ` : ''}col ${e.col}: ${e.message}`;
  } else if (parsed?.ok) info = stepsCaption(parsed.steps, pattern?.stepsPerBeat ?? 4);
  const name = local ? 'Song beat' : (pattern?.name ?? 'missing groove');
  const currentPattern = () => library.peek().find((p) => p.id === currentPatternId());
  const currentPatternId = () => currentSong.peek()?.sections.find((s) => s.id === section.id)?.patternId ?? section.patternId;
  const onInput = (v: string) => {
    latest.current = v;
    setValue(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => apply(v), BEAT_DEBOUNCE);
  };
  return (
    <PatternPicker
      className="sc-main"
      patterns={grooves.value}
      currentId={section.patternId}
      onSelect={(id) => patchSection(section.id, { patternId: id })}
      subtitleOf={beatsLabel}
      label="Section groove"
      autoFocus={false}
      panelWidth={600}
      findHeading="Choose another beat"
      onOpen={() => {
        touchSection(section.id);
        clearTimeout(timer.current);
        lastApplied.current = text;
        latest.current = text;
        setValue(text);
        setSaveName(null);
        setOpen(true);
      }}
      onClose={(reason) => {
        clearTimeout(timer.current);
        timer.current = undefined;
        if (reason === 'commit') apply(latest.current);
        setOpen(false);
      }}
      renderTrigger={({ ref, open: isOpen, toggle, onKeyDown }) => (
        <button
          ref={ref}
          type="button"
          class={`sc-display${local ? ' is-text' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-label={`Section groove: ${name}`}
          title={local || !text ? (local ? text : name) : `${name}: ${text}`}
          data-testid="beat-display"
          onClick={toggle}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => e.key === ' ' && e.preventDefault()}
        >
          {local ? (
            <span class="sc-disp-main" data-testid="beat-display-text">
              {text}
            </span>
          ) : (
            <span class="sc-disp-main has-pat">
              <span class="sc-disp-name" data-testid="beat-display-text">
                {name}
              </span>
              <span class="sc-disp-pat" data-testid="beat-display-pattern" aria-hidden="true">
                {text}
              </span>
            </span>
          )}
          <span class="sc-disp-cap" data-testid="beat-length">
            {pattern ? lengthLabel(pattern) : ''}
          </span>
          <IconChevronDown class="pp-caret" />
        </button>
      )}
      topSlot={({ close }) => (
        <BeatSlot
          section={section}
          pattern={pattern}
          local={local}
          value={value}
          error={error}
          info={info}
          saveName={saveName ?? pattern?.name ?? ''}
          onValue={onInput}
          onSaveName={setSaveName}
          onEnter={() => {
            if (parsed?.ok && apply(latest.current)) close({ focusTrigger: true });
          }}
          onOpenEditor={() => {
            apply(latest.current);
            const id = currentPatternId();
            close();
            openInEditor(id);
          }}
          onSave={() => {
            if (!apply(latest.current)) return;
            close({ focusTrigger: true });
            saveAsGroove(currentPatternId(), saveName ?? currentPattern()?.name ?? '');
          }}
        />
      )}
    />
  );
}

const CONTROL = '[data-row-control], button, input, select, textarea, a, label, .pp, .pp-panel, .pp-catcher, [role=listbox], [role=option], [role=dialog]';
/** Did this event come from an interactive control (not the row itself)? composedPath: a picker option removes itself on select, so the target may already be detached. */
const fromControl = (e: Event, row: Element): boolean => e.composedPath().some((n) => n instanceof HTMLElement && n !== row && n.matches(CONTROL));
const onLabelPath = (e: Event): boolean => e.composedPath().some((n) => n instanceof HTMLElement && n.hasAttribute('data-row-label'));

interface Press extends TapPoint {
  onLabel: boolean;
  ok: boolean;
  consumed: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
}

interface RowProps {
  section: Section;
  index: number;
  count: number;
  current: boolean;
  selected: boolean;
  queued: boolean;
  shift: number;
  dragging: boolean;
  onHandleDown: (e: PointerEvent, id: string, index: number) => void;
}

function SectionRow({ section, index, count, current, selected, queued, shift, dragging, onHandleDown }: RowProps) {
  const groove = library.value.find((p) => p.id === section.patternId);
  const local = isSongLocal(groove);
  const [editing, setEditing] = useState(false);
  const press = useRef<Press | null>(null);
  const lastTap = useRef<(TapPoint & { onLabel: boolean }) | null>(null);
  const playing = songPlaying.value;
  const key = index < 10 ? String((index + 1) % 10) : null;
  const state = current ? 'playing' : queued ? 'queued' : selected ? 'selected' : 'idle';
  const goLabel = playing ? `Go to ${section.name}${key ? ` (key ${key})` : ''}` : `Start from ${section.name}`;
  const clearPress = () => {
    clearTimeout(press.current?.timer);
    press.current = null;
  };
  const label = `${index + 1}. ${section.name}, ${local ? 'song beat' : (groove?.name ?? 'missing groove')}, plays ${section.bars} time${section.bars === 1 ? '' : 's'}`;
  return (
    <li
      class={`sc${current ? ' is-current' : ''}${selected ? ' is-selected' : ''}${dragging ? ' is-dragging' : ''}`}
      data-kind={section.kind}
      data-testid="section-card"
      data-index={index}
      data-id={section.id}
      aria-current={current ? 'true' : undefined}
      aria-label={label}
      style={shift ? { transform: `translateY(${shift}px)` } : undefined}
      onPointerDown={(e) => {
        clearPress();
        if ((e.pointerType === 'mouse' && e.button !== 0) || fromControl(e, e.currentTarget)) return;
        const onLabel = onLabelPath(e);
        const p: Press = { x: e.clientX, y: e.clientY, t: e.timeStamp, onLabel, ok: true, consumed: false, timer: undefined };
        if (onLabel && e.pointerType !== 'mouse') {
          p.timer = setTimeout(() => {
            if (press.current === p && p.ok) {
              p.consumed = true;
              setEditing(true);
            }
          }, LONG_PRESS_MS);
        }
        press.current = p;
      }}
      onPointerMove={(e) => {
        const p = press.current;
        if (p && p.ok && !isTap(p, { x: e.clientX, y: e.clientY, t: p.t })) {
          p.ok = false;
          clearTimeout(p.timer);
        }
      }}
      onPointerCancel={clearPress}
      onPointerUp={(e) => {
        const p = press.current;
        clearPress();
        if (!p || !p.ok || p.consumed || fromControl(e, e.currentTarget)) return;
        const up = { x: e.clientX, y: e.clientY, t: e.timeStamp };
        if (!isTap(p, up)) return;
        const prev = lastTap.current;
        if (p.onLabel && prev?.onLabel && isDoubleTap(prev, up)) {
          lastTap.current = null;
          setEditing(true);
          return;
        }
        lastTap.current = { ...up, onLabel: p.onLabel };
        tapSection(section.id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'F2' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
          e.preventDefault();
          setEditing(true);
        }
      }}
    >
      <div class="sc-l1">
        <button
          type="button"
          class="sc-handle"
          data-handle={section.id}
          aria-label={`Reorder ${section.name}. Drag, or press arrow up or down.`}
          title="Drag to reorder"
          onPointerDown={(e) => onHandleDown(e, section.id, index)}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            e.preventDefault();
            e.stopPropagation();
            moveSectionBy(section.id, e.key === 'ArrowUp' ? -1 : 1);
            setTimeout(() => document.querySelector<HTMLElement>(`[data-handle="${section.id}"]`)?.focus(), 0);
          }}
        >
          <span aria-hidden="true">⋮⋮</span>
        </button>
        <button
          type="button"
          class="sc-go"
          data-testid="section-go"
          data-state={state}
          aria-label={goLabel}
          title={goLabel}
          onClick={() => tapSection(section.id)}
        >
          {index + 1}
        </button>
        <SectionLabel section={section} editing={editing} onDone={() => setEditing(false)} />
        <button
          type="button"
          class="btn sc-ic sc-fill"
          aria-label="Fill into next section"
          aria-pressed={section.fill.enabled}
          title="Fill into the next section"
          onClick={() => patchSection(section.id, { fill: { enabled: !section.fill.enabled } })}
        >
          F
        </button>
        <button
          type="button"
          class="btn sc-ic"
          aria-label="Loop this section"
          aria-pressed={section.loop}
          title="Loop until NEXT"
          onClick={() => patchSection(section.id, { loop: !section.loop })}
        >
          <IconLoop width={18} height={18} />
        </button>
        <button type="button" class="btn sc-ic" aria-label="Duplicate section" title="Duplicate (inserted below)" disabled={count >= SONG_LIMITS.maxSections} onClick={() => duplicateSectionById(section.id)}>
          <IconCopy width={18} height={18} />
        </button>
        <button type="button" class="btn sc-ic" aria-label="Delete section" title="Delete (Undo available)" onClick={() => deleteSectionById(section.id)}>
          <IconTrash width={18} height={18} />
        </button>
      </div>
      <div class="sc-l2">
        <BeatCombo section={section} pattern={groove} />
        <BarsEditor section={section} pass={groove ? lengthLabel(groove) : '4 beats'} />
      </div>
    </li>
  );
}

interface DragState {
  id: string;
  from: number;
  to: number;
  dy: number;
  h: number;
}
interface DragRun {
  startY: number;
  startScroll: number;
  centers: number[];
  from: number;
  to: number;
  id: string;
  h: number;
  scroller: HTMLElement;
  y: number;
  raf: number;
  handle: HTMLElement;
  pointerId: number;
}

const EDGE = 64;

export function SectionList() {
  const song = currentSong.value;
  const cur = playingSectionIndex.value;
  const sel = selectedSectionId.value;
  const queuedIdx = songPlaying.value ? (songInfo.value?.queued?.sectionIndex ?? null) : null;
  const [drag, setDrag] = useState<DragState | null>(null);
  const run = useRef<DragRun | null>(null);
  const list = useRef<HTMLOListElement>(null);

  const update = () => {
    const r = run.current;
    if (!r) return;
    const dy = r.y - r.startY + (r.scroller.scrollTop - r.startScroll);
    const dc = r.centers[r.from]! + dy;
    let to = r.from;
    r.centers.forEach((c, j) => {
      if (j > r.from && dc > c) to = Math.max(to, j);
      if (j < r.from && dc < c) to = Math.min(to, j);
    });
    r.to = to;
    setDrag({ id: r.id, from: r.from, to, dy, h: r.h });
  };

  const stopRun = (commit: boolean) => {
    const r = run.current;
    if (!r) return;
    run.current = null;
    cancelAnimationFrame(r.raf);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
    try {
      r.handle.releasePointerCapture(r.pointerId);
    } catch {
      /* already released */
    }
    if (commit && r.to !== r.from) moveSectionTo(r.id, r.to);
    setDrag(null);
  };
  const onMove = (e: PointerEvent) => {
    if (!run.current || e.pointerId !== run.current.pointerId) return;
    run.current.y = e.clientY;
    update();
  };
  const onUp = () => stopRun(true);
  const onCancel = () => stopRun(false);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      stopRun(false);
    }
  };

  const autoScroll = () => {
    const r = run.current;
    if (!r) return;
    const box = r.scroller.getBoundingClientRect();
    const dock = document.querySelector('.sv-dock')?.getBoundingClientRect();
    const player = document.querySelector('.sv-player')?.getBoundingClientRect();
    const top = player && player.bottom > box.top ? player.bottom : box.top;
    const bottom = dock && dock.top > box.top + 100 && dock.top < box.bottom ? dock.top : box.bottom;
    let v = 0;
    if (r.y < top + EDGE) v = -Math.min(16, ((top + EDGE - r.y) / EDGE) * 16);
    else if (r.y > bottom - EDGE) v = Math.min(16, ((r.y - (bottom - EDGE)) / EDGE) * 16);
    if (v !== 0) {
      r.scroller.scrollTop += v;
      update();
    }
    r.raf = requestAnimationFrame(autoScroll);
  };

  const onHandleDown = (e: PointerEvent, id: string, index: number) => {
    if (e.button !== 0 || run.current || !list.current) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    const scroller = (list.current.closest('.view') as HTMLElement | null) ?? document.documentElement;
    const rows = [...list.current.children] as HTMLElement[];
    const rects = rows.map((r) => r.getBoundingClientRect());
    const gap = rects.length > 1 ? rects[1]!.top - rects[0]!.bottom : 8;
    run.current = {
      startY: e.clientY,
      startScroll: scroller.scrollTop,
      centers: rects.map((r) => r.top + r.height / 2 + scroller.scrollTop),
      from: index,
      to: index,
      id,
      h: rects[index]!.height + gap,
      scroller,
      y: e.clientY,
      raf: requestAnimationFrame(autoScroll),
      handle,
      pointerId: e.pointerId,
    };
    handle.setPointerCapture?.(e.pointerId);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    update();
  };

  useEffect(() => () => stopRun(false), []);

  if (!song) return null;
  const shiftOf = (i: number): number => {
    if (!drag || i === drag.from) return 0;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -drag.h;
    if (drag.from > drag.to && i < drag.from && i >= drag.to) return drag.h;
    return 0;
  };
  return (
    <>
      {song.sections.length === 0 ? (
        <p class="sv-empty">Add a section to start your arrangement.</p>
      ) : (
        <ol class={`sc-list${drag ? ' is-dragging' : ''}`} aria-label="Sections" ref={list}>
          {song.sections.map((s, i) => (
            <SectionRow
              key={s.id}
              section={s}
              index={i}
              count={song.sections.length}
              current={cur === i}
              selected={cur === null && sel === s.id}
              queued={queuedIdx === i}
              shift={drag && drag.id === s.id ? drag.dy : shiftOf(i)}
              dragging={drag?.id === s.id}
              onHandleDown={onHandleDown}
            />
          ))}
        </ol>
      )}
      <AddChips />
    </>
  );
}

function AddChips() {
  const song = currentSong.value;
  const full = (song?.sections.length ?? 0) >= SONG_LIMITS.maxSections;
  return (
    <div class="sv-chips" role="group" aria-label="Add section">
      {SECTION_KINDS.filter((k) => k !== 'custom').map((k) => (
        <button key={k} type="button" class="btn chip-add" data-kind={k} disabled={full} aria-label={`Add ${SECTION_LABELS[k]}`} onClick={() => addSectionOfKind(k)}>
          <IconPlus width={14} height={14} /> {SECTION_LABELS[k]}
        </button>
      ))}
    </div>
  );
}

/** Song-wide default fill (used by sections with the F toggle on). */
export function DefaultFill() {
  const song = currentSong.value;
  if (!song) return null;
  const list = fills.value;
  const cur = song.fillId && list.some((f) => f.id === song.fillId) ? song.fillId : (list[0]?.id ?? '');
  return (
    <div class="gv-field">
      <span class="label">fill pattern (this song)</span>
      <PatternPicker patterns={list} currentId={cur} onSelect={setDefaultFill} subtitleOf={beatsLabel} label="Default fill" />
    </div>
  );
}
