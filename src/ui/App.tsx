import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { SongView } from './assistant/SongView';
import { BeatLab } from './beatlab/BeatLab';
import { ConfirmSheet } from './common/ConfirmSheet';
import { SaveGrooveSheet } from './common/SaveGrooveSheet';
import { IconBot, IconGrid } from './common/icons';
import { ImportSheet } from './common/ImportSheet';
import { TabImportSheet } from './common/TabImportSheet';
import { Toast } from './common/Toast';
import { isDesktop } from './media';
import { navigate, route, type Route } from './router';
import { initBackup, startImport } from './state/backup';
import * as drummer from './state/drummer';
import { editorTogglePlay, initLink } from './state/link';
import { playingTabs } from './state/linkLogic';
import * as songs from './state/songs';
import * as songLogic from './state/songLogic';
import { initLab, mode, prepareAudio, ready } from './state/lab';

const TABS: { id: Route; label: string; icon: typeof IconGrid }[] = [
  { id: 'drummer', label: 'Drummer', icon: IconBot },
  { id: 'editor', label: 'Beat Editor', icon: IconGrid },
];

function Tabs({ where }: { where: 'top' | 'bottom' }) {
  const dots = playingTabs({ mode: mode.value });
  return (
    <nav class={`tabs tabs-${where}`} aria-label="Sections">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          class="tab"
          aria-current={route.value === t.id ? 'page' : undefined}
          onClick={() => navigate(t.id)}
        >
          <t.icon width={20} height={20} />
          <span>{t.label}</span>
          {dots[t.id] && (
            <i class="tab-dot" data-testid={`playing-${t.id}`} aria-label="playing" role="img" />
          )}
        </button>
      ))}
    </nav>
  );
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  // Only fields where Space types a character keep it; sliders, selects, buttons and the
  // numeric BPM field don't, so Space always means play/stop there.
  return !!el.closest(
    'textarea, [contenteditable=""], [contenteditable="true"], input:is([type=text], [type=search], [type=email], [type=url], [type=password], [type=tel], :not([type]))',
  );
}

/**
 * True once ALL persisted state (patterns, Drummer settings, songs) has been loaded and applied.
 * Nothing is editable before that, so a late restore (e.g. the song's saved tempo) can never
 * overwrite something the user already changed.
 */
const appReady = signal(false);

export function App() {
  useEffect(() => {
    initLink();
    void initLab();
    void initBackup();
    void drummer.initDrummer();
    // initSongs waits for the Drummer settings, which wait for the lab (library + repo).
    void songs.initSongs().finally(() => {
      appReady.value = true;
    });
    // First gesture warms up audio + loads the kit.
    const warm = () => prepareAudio();
    document.addEventListener('pointerdown', warm, { once: true, capture: true });
    let spaceHandled = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat && e.code === 'Space') return;
      const t = e.target as HTMLElement | null;
      if (isTypingTarget(t) || t?.closest('.pp-panel')) return;
      const onDrummer = route.value === 'drummer';
      if (e.code === 'Space') {
        e.preventDefault();
        spaceHandled = true;
        if (onDrummer) songs.toggleSongPlay();
        else editorTogglePlay();
        return;
      }
      if (!onDrummer || e.ctrlKey || e.metaKey || e.altKey) return;
      const inField = !!t?.closest('input, select, textarea, [role=listbox]');
      const key = e.key;
      const once = (fn: () => void) => {
        if (e.repeat) return;
        e.preventDefault();
        fn();
      };
      const num = songLogic.sectionIndexForKey(e, songs.currentSong.peek()?.sections.length ?? 0);
      if (!inField && !e.shiftKey && num !== null) once(() => songs.selectSectionByIndex(num));
      else if (key === 'c' || key === 'C') once(drummer.toggleClick);
      else if (key === 'f' || key === 'F') once(songs.songFill);
      else if (key === 'b' || key === 'B') once(songs.songBreak);
      else if (key === 'l' || key === 'L') once(songs.songLoop);
      else if (key === 't' || key === 'T') once(drummer.tap);
      else if (key === 'PageDown' || (key === 'ArrowRight' && !inField)) once(songs.songNext);
      else if (key === 'PageUp' || (key === 'ArrowLeft' && !inField)) once(songs.songPrev);
      else if ((key === 'ArrowUp' || key === 'ArrowDown') && !inField) {
        e.preventDefault();
        drummer.nudgeBpm(key === 'ArrowUp' ? 1 : -1);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && spaceHandled) {
        spaceHandled = false;
        e.preventDefault(); // stop a focused button from also "clicking"
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('pointerdown', warm, true);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const desktop = isDesktop.value;
  // Drop a backup / shared song file anywhere: it opens the import preview.
  const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
  return (
    <div
      class="app"
      onDragOver={(e) => hasFiles(e) && e.preventDefault()}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        const f = e.dataTransfer?.files[0];
        if (f) void startImport(f);
      }}
      data-bar={route.value === 'drummer' ? 'song' : undefined}>
      {desktop && (
        <header class="topbar">
          <span class="brand">BEATBOY</span>
          <Tabs where="top" />
        </header>
      )}
      <main class="view">{!appReady.value || !ready.value ? <p class="boot">Loading…</p> : route.value === 'editor' ? <BeatLab /> : <SongView />}</main>
      {!desktop && <Tabs where="bottom" />}
      <Toast />
      <ConfirmSheet />
      <SaveGrooveSheet />
      <ImportSheet />
      <TabImportSheet />
    </div>
  );
}
