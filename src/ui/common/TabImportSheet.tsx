import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { parseDrumTab, type TabImport } from '../../import/tab';
import { PATTERN_LIMITS } from '../../domain/types';
import { bpm as sharedBpm } from '../state/drummer';
import { closeTabImport, createSongFromTab, tabImportOpen } from '../state/tabImport';
import { Sheet } from './Sheet';

const DEBOUNCE_MS = 300;

/** A short tab of our own for the "Paste example" link. */
export const EXAMPLE_TAB = `Example Groove
Tempo: 96

Verse
HH|x-x-x-x-x-x-x-x-|x-x-x-x-x-x-x-x-|
SD|----o-------o---|----o-------o---|
BD|o-------o-o-----|o-------o-o-----|

Chorus x2
CC|x---------------|----------------|
HH|--x-x-x-x-x-x-x-|x-x-x-x-x-x-x-x-|
SD|----o-------o---|----o-------o-o-|
BD|o-------o-o-----|o-------o-------|
`;

export const confidenceLabel = (t: TabImport): 'Good' | 'Check it' | 'Not a drum tab' => (t.reject ? 'Not a drum tab' : t.confidence >= 0.9 ? 'Good' : 'Check it');

/** Paste a drum tab, see what was understood, create a song. */
export function TabImportSheet() {
  if (!tabImportOpen.value) return null;
  return <Body />;
}

function Body() {
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  const [bpmEdit, setBpmEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(text), text === '' ? 0 : DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [text]);
  const res = useMemo<TabImport | null>(() => (debounced.trim() === '' ? null : parseDrumTab(debounced)), [debounced]);
  const stale = text !== debounced;

  const name = nameEdit ?? res?.song.name ?? '';
  const bpmText = bpmEdit ?? String(res?.song.bpm ?? sharedBpm.value);
  const ok = !!res && !res.reject && res.sections.length > 0 && !stale;

  const create = async () => {
    if (busy) return;
    const fresh = parseDrumTab(text);
    if (fresh.reject || fresh.sections.length === 0) return;
    const n = Number(bpmText);
    const tempo = Math.min(PATTERN_LIMITS.maxBpm, Math.max(PATTERN_LIMITS.minBpm, Math.round(Number.isFinite(n) && n > 0 ? n : (fresh.song.bpm ?? sharedBpm.peek()))));
    setBusy(true);
    const done = await createSongFromTab(fresh, nameEdit ?? fresh.song.name, tempo);
    if (!done) setBusy(false);
  };

  return (
    <Sheet title="Import drum tab" onClose={closeTabImport} className="sheet-tab">
      <div class="tab-cols">
        <div class="tab-in">
          <label class="label" for="tab-text">
            drum tab
          </label>
          <textarea
            id="tab-text"
            ref={area}
            class="input tab-text"
            value={text}
            placeholder={'Paste a drum tab here\n\nHH|x-x-x-x-x-x-x-x-|\nSD|----o-------o---|\nBD|o-------o-------|'}
            aria-label="Drum tab text"
            spellcheck={false}
            autocomplete="off"
            autocapitalize="off"
            wrap="off"
            onInput={(e) => setText(e.currentTarget.value)}
          />
          <div class="tab-tools">
            <button
              type="button"
              class="btn btn-ghost"
              onClick={() => {
                setText(EXAMPLE_TAB);
                area.current?.focus();
              }}
            >
              Paste example
            </button>
            {text !== '' && (
              <button type="button" class="btn btn-ghost" onClick={() => setText('')}>
                Clear
              </button>
            )}
          </div>
        </div>
        <div class="tab-out" aria-live="polite" data-testid="tab-preview">
          {!res ? (
            <p class="sheet-text tab-hint">
              Paste an ASCII drum tab (from a tab site, a forum or a chat) and Beatboy turns it into a song: one section per part, with
              the repeats counted. Rows like <code>HH|x-x-x-x-|</code>, <code>SD|--o---o-|</code> and <code>BD|o---o---|</code> are what it looks for.
            </p>
          ) : (
            <Preview res={res} name={name} bpmText={bpmText} onName={setNameEdit} onBpm={setBpmEdit} stale={stale} />
          )}
        </div>
      </div>
      <div class="sheet-actions">
        <button type="button" class="btn" onClick={closeTabImport}>
          Cancel
        </button>
        <button type="button" class="btn btn-primary" disabled={!ok || busy} onClick={() => void create()}>
          Create song
        </button>
      </div>
    </Sheet>
  );
}

function Preview({
  res,
  name,
  bpmText,
  onName,
  onBpm,
  stale,
}: {
  res: TabImport;
  name: string;
  bpmText: string;
  onName: (v: string) => void;
  onBpm: (v: string) => void;
  stale: boolean;
}) {
  const label = confidenceLabel(res);
  const tone = res.reject ? 'bad' : label === 'Good' ? 'good' : 'check';
  return (
    <div class={`tab-preview${stale ? ' is-stale' : ''}`}>
      <div class="tab-meta">
        <span class={`tab-badge is-${tone}`} data-testid="tab-confidence" title={`confidence ${Math.round(res.confidence * 100)}%`}>
          {label}
        </span>
        {!res.reject && (
          <>
            <label class="tab-field">
              <span class="label">song name</span>
              <input class="input" type="text" value={name} maxLength={48} aria-label="Song name" data-testid="tab-song-name" onInput={(e) => onName(e.currentTarget.value)} />
            </label>
            <label class="tab-field tab-field-bpm">
              <span class="label">tempo</span>
              <input
                class="input"
                type="text"
                inputMode="numeric"
                value={bpmText}
                maxLength={3}
                aria-label="Tempo in BPM"
                data-testid="tab-bpm"
                onInput={(e) => onBpm(e.currentTarget.value.replace(/\D/g, ''))}
              />
            </label>
          </>
        )}
      </div>
      {!res.reject && (
        <>
          <p class="label tab-count" data-testid="tab-summary">
            {res.sections.length} section{res.sections.length === 1 ? '' : 's'}
          </p>
          <ul class="tab-sections" aria-label="Sections found">
            {res.sections.map((s, i) => (
              <li key={i} class="tab-sec" data-testid="tab-section">
                <div class="tab-sec-head">
                  <span class="tab-sec-name">{s.name}</span>
                  <span class="tab-sec-meta">
                    {s.feel === 'triplet' ? 'triplet · ' : ''}× {s.times}
                  </span>
                </div>
                <div class="tab-beat" tabIndex={0} aria-label={`Beat of ${s.name}`}>
                  {s.beat}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {res.warnings.length > 0 && (
        <ul class="tab-warns" aria-label="Notes">
          {res.warnings.map((w) => (
            <li key={w} class="imp-warn">
              {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
