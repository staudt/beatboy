import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Pattern } from '../../domain/types';
import { feelOf } from '../../domain/patternOps';
import { isDesktop } from '../media';
import { IconChevronDown, IconPlus } from './icons';

export interface PatternPickerProps {
  patterns: readonly Pattern[];
  currentId: string;
  onSelect: (id: string) => void;
  /** Enables the NAME field; called (debounced) with the typed name for the current pattern. */
  onRename?: (name: string) => void;
  /** Enables the "+ New beat" row. Must make the new pattern current. */
  onNew?: () => void;
  /** Replaces the whole row subtitle. */
  subtitleOf?: (p: Pattern) => string;
  /** Accessible name of the trigger's popup. */
  label?: string;
  /** data-testid for the trigger's name text. */
  nameTestId?: string;
  /** Text shown on the trigger instead of the current pattern's name (e.g. "Song beat"). */
  triggerName?: string;
  /** Icon-only trigger (the name stays available to assistive tech); used inside the section beat combobox. */
  compact?: boolean;
  /** The panel is positioned under this element instead of the trigger. */
  anchorTo?: () => HTMLElement | null;
  /** Buttons shown at the top of the panel; choosing one closes the panel. */
  actions?: { label: string; onClick: () => void }[];
  /** Wording for other kinds of items (songs). */
  words?: { newLabel: string; nameLabel: string; findPlaceholder: string; findLabel: string; empty: string; list: string };
}

const BEAT_WORDS = { newLabel: 'New beat', nameLabel: 'Pattern name', findPlaceholder: 'Find a beat…', findLabel: 'Find pattern', empty: 'No beats match.', list: 'Patterns' };

const SEARCH_MIN = 8;
const RENAME_DEBOUNCE = 300;

/** Categories holding user patterns first, then the given order. */
export function groupPatterns(list: readonly Pattern[]): [string, Pattern[]][] {
  const map = new Map<string, Pattern[]>();
  for (const p of list) {
    const cat = p.category || 'Other';
    const arr = map.get(cat);
    if (arr) arr.push(p);
    else map.set(cat, [p]);
  }
  const hasUser = (arr: Pattern[]) => arr.some((p) => !p.builtIn);
  return [...map.entries()]
    .map((e, i) => ({ e, i }))
    .sort((a, b) => Number(hasUser(b.e[1])) - Number(hasUser(a.e[1])) || a.i - b.i)
    .map((x) => x.e);
}

const isTouch = (): boolean => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** Dropdown anchored to the current pattern's name: rename it, find another, or create a new one. */
export function PatternPicker({
  patterns,
  currentId,
  onSelect,
  onRename,
  onNew,
  subtitleOf,
  label = 'Patterns',
  nameTestId,
  triggerName,
  compact,
  anchorTo,
  actions,
  words = BEAT_WORDS,
}: PatternPickerProps) {
  const cur = patterns.find((p) => p.id === currentId);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number | undefined }>({
    top: 0,
    left: 0,
    width: undefined,
  });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<string | null>(null);
  const original = useRef('');
  const focusName = useRef(false);
  const desktop = isDesktop.value;

  const flush = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (pending.current !== null) {
      const v = pending.current;
      pending.current = null;
      onRename?.(v);
    }
  };

  const close = (opts: { revert?: boolean; focusTrigger?: boolean } = {}) => {
    if (opts.revert) {
      clearTimeout(timer.current);
      timer.current = undefined;
      pending.current = null;
      if (onRename && cur && cur.name !== original.current) onRename(original.current);
    } else flush();
    setOpen(false);
    setQuery('');
    if (opts.focusTrigger) queueMicrotask(() => trigger.current?.focus());
  };

  const doOpen = () => {
    original.current = cur?.name ?? '';
    setName(cur?.name ?? '');
    setQuery('');
    setActiveId(currentId);
    setOpen(true);
  };

  // Position the panel right under the trigger.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = (anchorTo?.() ?? trigger.current)?.getBoundingClientRect();
      if (!r) return;
      const vw = document.documentElement.clientWidth;
      if (vw < 900) setPos({ top: r.bottom + 4, left: 16, width: vw - 32 });
      else setPos({ top: r.bottom + 4, left: Math.max(16, Math.min(r.left, vw - 360 - 16)), width: 360 });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, desktop]);

  // Focus + select the name on open (not on touch: no surprise keyboard).
  useEffect(() => {
    if (open && onRename && !isTouch()) {
      nameInput.current?.focus();
      nameInput.current?.select();
    } else if (open) {
      if (!isTouch()) searchInput.current?.focus();
    }
  }, [open]);

  // Follow the current pattern (selection elsewhere, "+ New beat"); never fight live typing.
  useEffect(() => {
    if (!open) return;
    if (!timer.current && cur && cur.name !== name) setName(cur.name);
    if (focusName.current) {
      focusName.current = false;
      original.current = cur?.name ?? '';
      // After the value has been re-rendered, or the selection would be reset.
      if (!isTouch()) {
        setTimeout(() => {
          nameInput.current?.focus();
          nameInput.current?.select();
        }, 0);
      }
    }
    setActiveId((a) => a ?? currentId);
  }, [open, currentId, cur?.name]);

  // Escape reverts and closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close({ revert: true, focusTrigger: true });
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  });

  useEffect(() => () => clearTimeout(timer.current), []);

  const showSearch = patterns.length > SEARCH_MIN;
  const q = query.trim().toLowerCase();
  const groups = useMemo(
    () =>
      groupPatterns(
        q
          ? patterns.filter((p) => p.name.toLowerCase().includes(q) || (p.category || 'Other').toLowerCase().includes(q))
          : patterns,
      ),
    [patterns, q],
  );
  const flat = groups.flatMap(([, l]) => l);

  const move = (d: number) => {
    if (!flat.length) return;
    const i = flat.findIndex((p) => p.id === activeId);
    const n = i < 0 ? (d > 0 ? 0 : flat.length - 1) : (i + d + flat.length) % flat.length;
    const id = (flat[n] as Pattern).id;
    setActiveId(id);
    document.getElementById(optId(id))?.scrollIntoView({ block: 'nearest' });
  };

  const select = (id: string) => {
    // A name typed for a built-in is only a draft (no copy yet); switching away discards it.
    if (cur?.builtIn) pending.current = null;
    flush();
    onSelect(id);
    close({ focusTrigger: true });
  };

  const onPanelKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    const inName = t === nameInput.current;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (inName && showSearch) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          searchInput.current?.focus();
        }
        return;
      }
      if (t.tagName === 'INPUT' || t.closest('[role=listbox]')) {
        e.preventDefault();
        move(e.key === 'ArrowDown' ? 1 : -1);
      }
    } else if (e.key === 'Enter') {
      if (t.closest('[data-pp-action]')) return;
      if (inName) {
        e.preventDefault();
        close({ focusTrigger: true });
      } else if (t === searchInput.current || !onRename) {
        const id = activeId && flat.some((p) => p.id === activeId) ? activeId : flat[0]?.id;
        if (id) {
          e.preventDefault();
          select(id);
        }
      }
    } else if (e.key === 'Tab') {
      const f = [...(panel.current?.querySelectorAll<HTMLElement>('input, button') ?? [])].filter((x) => !x.hasAttribute('disabled'));
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && t === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && t === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  };

  const onNameInput = (v: string) => {
    setName(v);
    pending.current = v;
    clearTimeout(timer.current);
    // Renaming a built-in creates a user copy, so don't do it live: wait for an explicit
    // commit (Enter / closing by clicking outside). Escape then leaves no stray copy.
    if (cur?.builtIn) {
      timer.current = undefined;
      return;
    }
    timer.current = setTimeout(() => {
      timer.current = undefined;
      flush();
    }, RENAME_DEBOUNCE);
  };

  const listId = 'pp-list';
  const optId = (id: string) => `pp-opt-${id}`;
  const activeOpt = activeId && flat.some((p) => p.id === activeId) ? optId(activeId) : undefined;
  const subtitle = (p: Pattern) =>
    subtitleOf?.(p) ??
    `${p.timeSig.num} beat${p.timeSig.num === 1 ? '' : 's'} · ${feelOf(p)}${p.builtIn ? ' · built-in' : ''}`;

  return (
    <div class="pp">
      <button
        ref={trigger}
        type="button"
        class={compact ? 'pp-trigger pp-compact' : 'pp-trigger'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${triggerName ?? cur?.name ?? ''}`}
        onClick={() => (open ? close({ focusTrigger: true }) : doOpen())}
      >
        <span class={compact ? 'pattern-name sr-only' : 'pattern-name'} data-testid={nameTestId}>
          {triggerName ?? cur?.name ?? ''}
        </span>
        <IconChevronDown class="pp-caret" />
      </button>
      {open && (
        <>
          <div class="pp-catcher" onPointerDown={() => close()} />
          <div
            ref={panel}
            class="pp-panel"
            role="dialog"
            aria-label={label}
            style={{ top: `${pos.top}px`, left: `${pos.left}px`, width: pos.width ? `${pos.width}px` : undefined }}
            onKeyDown={onPanelKey}
          >
            <div class="pp-top">
              {actions?.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  class="btn pp-new"
                  data-pp-action=""
                  onClick={() => {
                    close();
                    a.onClick();
                  }}
                >
                  {a.label}
                </button>
              ))}
              {onRename && (
                <label class="pp-field">
                  <span class="label">name</span>
                  <input
                    ref={nameInput}
                    class="input"
                    type="text"
                    value={name}
                    maxLength={48}
                    aria-label={words.nameLabel}
                    autoComplete="off"
                    onInput={(e) => onNameInput(e.currentTarget.value)}
                  />
                </label>
              )}
              {showSearch && (
                <input
                  ref={searchInput}
                  class="input pp-search"
                  type="search"
                  value={query}
                  placeholder={words.findPlaceholder}
                  aria-label={words.findLabel}
                  autoComplete="off"
                  aria-controls={listId}
                  aria-activedescendant={activeOpt}
                  onInput={(e) => {
                    setQuery(e.currentTarget.value);
                    setActiveId(null);
                  }}
                />
              )}
              {onNew && (
                <button
                  type="button"
                  class="btn pp-new"
                  onClick={() => {
                    flush();
                    focusName.current = true;
                    onNew();
                  }}
                >
                  <IconPlus /> {words.newLabel}
                </button>
              )}
            </div>
            <div class="pp-list" id={listId} role="listbox" aria-label={words.list}>
              {groups.length === 0 && <p class="pp-empty">{words.empty}</p>}
              {groups.map(([cat, list]) => (
                <div role="group" aria-label={cat} key={cat}>
                  <h3 class="label pp-cat" aria-hidden="true">
                    {cat}
                  </h3>
                  {list.map((p) => (
                    <div
                      key={p.id}
                      id={optId(p.id)}
                      role="option"
                      aria-selected={p.id === currentId}
                      class={`pp-item${p.id === currentId ? ' is-current' : ''}${p.id === activeId ? ' is-active' : ''}`}
                      onClick={() => select(p.id)}
                      onMouseMove={() => p.id !== activeId && setActiveId(p.id)}
                    >
                      <span class="pp-main">
                        <span class="bi-name">{p.name}</span>
                        <span class="bi-meta">{subtitle(p)}</span>
                      </span>
                      {p.id === currentId && (
                        <span class="pp-check" aria-hidden="true">
                          ✓
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
