import { signal } from '@preact/signals';
import { useMemo } from 'preact/hooks';
import { createPattern } from '../../domain/patternOps';
import type { Pattern } from '../../domain/types';
import { PATTERN_LIMITS } from '../../domain/types';
import { IconCopy, IconGear, IconLoop, IconMinus, IconPlay, IconPlus, IconStop, IconTrash } from '../common/icons';
import { Sheet } from '../common/Sheet';
import { PatternPicker } from '../common/PatternPicker';
import { isDesktop } from '../media';
import { bpm, click, countInBars, crashAfterFill, setBpm, setClickVolume, setCountIn, tap, toggleClick } from '../state/drummer';
import {
  currentSong,
  currentSongId,
  duplicateSong,
  fillState,
  newSong,
  renameSong,
  requestDeleteSong,
  retrySongSave,
  songsReady,
  selectSong,
  songBreak,
  songFill,
  songInfo,
  songLoop,
  songNext,
  songPlaying,
  songSaveStatus,
  songs,
  toggleSongPlay,
} from '../state/songs';
import { HoldButton } from './HoldButton';
import { NowPanel, SectionAnnouncer } from './SongNow';
import { DefaultFill, SectionList } from './SongSections';

const settingsOpen = signal(false);

const SONG_WORDS = { newLabel: 'New song', nameLabel: 'Song name', findPlaceholder: 'Find a song…', findLabel: 'Find song', empty: 'No songs match.', list: 'Songs' };

function SongSaveChip() {
  const s = songSaveStatus.value;
  if (s === 'error') {
    return (
      <button type="button" class="chip chip-error" aria-label="Song not saved. Tap to retry." onClick={retrySongSave}>
        <span class="chip-dot" aria-hidden="true" />
        Not saved
      </button>
    );
  }
  const saving = s === 'saving';
  return (
    <span class={`chip ${saving ? 'chip-saving' : 'chip-saved'}`} role="status" data-testid="song-save">
      <span class="chip-dot" aria-hidden="true" />
      {saving ? 'Saving…' : 'Saved'}
    </span>
  );
}

function SongHeader() {
  const list = songs.value;
  const items = useMemo<Pattern[]>(
    () => list.map((s) => ({ ...createPattern({ name: s.name, category: 'Songs' }), id: s.id, builtIn: false })),
    [list],
  );
  const song = currentSong.value;
  const subtitleOf = (p: Pattern) => {
    const s = list.find((x) => x.id === p.id);
    return s ? `${s.bpm} BPM · ${s.sections.length} section${s.sections.length === 1 ? '' : 's'}` : '';
  };
  return (
    <header class="sv-header">
      {song ? (
        <PatternPicker
          patterns={items}
          currentId={currentSongId.value ?? ''}
          onSelect={selectSong}
          onRename={renameSong}
          onNew={newSong}
          subtitleOf={subtitleOf}
          label="Song"
          nameTestId="song-name"
          words={SONG_WORDS}
        />
      ) : (
        <button type="button" class="btn btn-primary" onClick={newSong}>
          <IconPlus /> New song
        </button>
      )}
      <button type="button" class="btn btn-icon" aria-label="Drummer settings" onClick={() => (settingsOpen.value = true)}>
        <IconGear />
      </button>
      <button type="button" class="btn btn-icon" aria-label="Duplicate song" disabled={!song} onClick={duplicateSong}>
        <IconCopy />
      </button>
      <button type="button" class="btn btn-icon" aria-label="Delete song" disabled={!song} onClick={requestDeleteSong}>
        <IconTrash />
      </button>
      <SongSaveChip />
    </header>
  );
}

function TempoRow() {
  const b = bpm.value;
  const commit = (el: HTMLInputElement) => {
    const v = Number(el.value);
    if (Number.isFinite(v) && v > 0) setBpm(v);
    el.value = String(bpm.peek());
  };
  return (
    <div class="sv-tempo">
      <div class="sv-bpm">
        <HoldButton delta={-1} label="Tempo down" disabled={b <= PATTERN_LIMITS.minBpm} className="sv-step">
          <IconMinus />
        </HoldButton>
        <div class="sv-bpm-field">
          <input
            class="sv-bpm-input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={3}
            value={b}
            aria-label="Tempo in BPM"
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => commit(e.currentTarget)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <span class="label">bpm</span>
        </div>
        <HoldButton delta={1} label="Tempo up" disabled={b >= PATTERN_LIMITS.maxBpm} className="sv-step">
          <IconPlus />
        </HoldButton>
        <input
          class="range sv-slider"
          type="range"
          min={PATTERN_LIMITS.minBpm}
          max={PATTERN_LIMITS.maxBpm}
          step={1}
          value={b}
          aria-label="Tempo slider"
          onInput={(e) => setBpm(Number(e.currentTarget.value))}
        />
        <button type="button" class="btn btn-tap" aria-label="Tap tempo" onPointerDown={() => tap()} onClick={(e) => e.detail === 0 && tap()}>
          TAP
        </button>
      </div>
    </div>
  );
}

function Transport() {
  const on = songPlaying.value;
  const info = songInfo.value;
  const ph = fillState.value;
  const desktop = isDesktop.value;
  const hasSong = (currentSong.value?.sections.length ?? 0) > 0;
  const kbd = (k: string) => desktop && <kbd class="gv-kbd">{k}</kbd>;
  return (
    <div class="sv-bar">
      <button type="button" class={`btn sv-btn sv-play${on ? ' is-playing' : ''}`} aria-label={on ? 'Stop' : 'Play'} disabled={!on && !hasSong} onClick={toggleSongPlay}>
        {on ? <IconStop width={24} height={24} /> : <IconPlay width={24} height={24} />}
        <span>{on ? 'Stop' : 'Play'}</span>
        {kbd('Space')}
      </button>
      <button type="button" class={`btn sv-btn sv-fill is-${ph}`} aria-label="Fill" data-testid="song-fill-btn" data-state={ph} disabled={!on} onClick={songFill}>
        <span>Fill</span>
        {kbd('F')}
      </button>
      <button type="button" class={`btn sv-btn sv-next${info?.queued ? ' is-queued' : ''}`} aria-label="Next section" disabled={!on} onClick={songNext}>
        <span>Next</span>
        {kbd('→')}
      </button>
      <button type="button" class={`btn sv-btn sv-break${info?.breakQueued || info?.phase === 'break' ? ' is-queued' : ''}`} aria-label="Break" disabled={!on} onClick={songBreak}>
        <span>Break</span>
        {kbd('B')}
      </button>
      <button type="button" class="btn sv-btn sv-loop" aria-label="Loop section" aria-pressed={!!info?.loop} disabled={!on} onClick={songLoop}>
        <IconLoop width={20} height={20} />
        {kbd('L')}
      </button>
      <button type="button" class="btn sv-btn sv-clickbtn" aria-label="Click" aria-pressed={click.value.enabled} onClick={toggleClick}>
        <span>Click</span>
        {kbd('C')}
      </button>
    </div>
  );
}

function SettingsSheet() {
  if (!settingsOpen.value) return null;
  const cin = countInBars.value;
  const c = click.value;
  return (
    <Sheet title="Drummer settings" onClose={() => (settingsOpen.value = false)}>
      <div class="set-grid">
        <div class="gv-field">
          <span class="label">count-in (bars)</span>
          <div class="seg" role="group" aria-label="Count-in">
            {([0, 1, 2] as const).map((v) => (
              <button key={v} type="button" class="btn seg-btn" aria-pressed={cin === v} onClick={() => setCountIn(v)}>
                {v === 0 ? 'Off' : v}
              </button>
            ))}
          </div>
        </div>
        <div class="gv-field">
          <span class="label">click volume</span>
          <input class="range" type="range" min={0} max={1} step={0.05} value={c.volume} aria-label="Click volume" onInput={(e) => setClickVolume(Number(e.currentTarget.value))} />
        </div>
        <label class="gv-check">
          <input type="checkbox" checked={crashAfterFill.value} onChange={(e) => (crashAfterFill.value = e.currentTarget.checked)} />
          <span>Crash after fill</span>
        </label>
        <DefaultFill />
      </div>
      <Credits />
    </Sheet>
  );
}

/** Credits for bundled sounds, font and code (see public/licenses/). */
function Credits() {
  const base = import.meta.env.BASE_URL;
  return (
    <details class="credits">
      <summary class="label">About &amp; credits</summary>
      <p>
        Drum sounds from <a href="https://github.com/sfzinstruments/virtuosity_drums" target="_blank" rel="noopener">Virtuosity Drums</a> by
        Versilian Studios; clap from <a href="https://github.com/august-byrne/phazite-sounds" target="_blank" rel="noopener">Phazite Sounds</a> (from the
        Versilian Community Sample Library). All samples are CC0 1.0 (public domain).{' '}
        <a href={`${base}licenses/ASSET_LICENSES.md`} target="_blank" rel="noopener">Sample sources</a>
      </p>
      <p>
        Font: JetBrains Mono (SIL Open Font License 1.1). Built with Preact, Preact Signals and idb (MIT / ISC).{' '}
        <a href={`${base}licenses/THIRD_PARTY_NOTICES.txt`} target="_blank" rel="noopener">Third-party notices</a>
      </p>
    </details>
  );
}

export function SongView() {
  if (!songsReady.value) return <p class="boot">Loading…</p>;
  return (
    <section class="sv" aria-label="Drummer">
      <div class="sv-main">
        <SongHeader />
        <TempoRow />
        <SectionList />
      </div>
      <div class="sv-dock">
        <NowPanel />
        <Transport />
      </div>
      <SectionAnnouncer />
      <SettingsSheet />
    </section>
  );
}
