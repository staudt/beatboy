import { useEffect } from 'preact/hooks';
import { GrooveView } from './assistant/GrooveView';
import { BeatLab } from './beatlab/BeatLab';
import { ConfirmSheet } from './common/ConfirmSheet';
import { IconBot, IconGrid } from './common/icons';
import { Toast } from './common/Toast';
import { isDesktop } from './media';
import { navigate, route, type Route } from './router';
import * as groove from './state/groove';
import { editorTogglePlay, initLink } from './state/link';
import { playingTabs } from './state/linkLogic';
import { currentId, initLab, mode, prepareAudio, ready } from './state/lab';

const TABS: { id: Route; label: string; icon: typeof IconGrid }[] = [
  { id: 'drummer', label: 'Drummer', icon: IconBot },
  { id: 'editor', label: 'Beat Editor', icon: IconGrid },
];

function Tabs({ where }: { where: 'top' | 'bottom' }) {
  const dots = playingTabs({ mode: mode.value, grooveId: groove.grooveId.value, editorId: currentId.value });
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

export function App() {
  useEffect(() => {
    initLink();
    void initLab();
    void groove.initGroove();
    // First gesture warms up audio + loads the kit.
    const warm = () => prepareAudio();
    document.addEventListener('pointerdown', warm, { once: true, capture: true });
    let spaceHandled = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat && e.code === 'Space') return;
      const t = e.target as HTMLElement | null;
      if (isTypingTarget(t) || t?.closest('.pp-panel')) return;
      const drummer = route.value === 'drummer';
      if (e.code === 'Space') {
        e.preventDefault();
        spaceHandled = true;
        if (drummer) groove.togglePlay();
        else editorTogglePlay();
        return;
      }
      if (!drummer || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'f' || e.key === 'F') {
        if (e.repeat) return;
        e.preventDefault();
        groove.fill();
      } else if (e.key === 't' || e.key === 'T') {
        if (e.repeat) return;
        e.preventDefault();
        groove.tap();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // Sliders, selects and fields keep their own arrow-key behavior.
        if (t?.closest('input, select, textarea, [role=listbox]')) return;
        e.preventDefault();
        groove.nudgeBpm(e.key === 'ArrowUp' ? 1 : -1);
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
  return (
    <div class="app">
      {desktop && (
        <header class="topbar">
          <span class="brand">BEATBOY</span>
          <Tabs where="top" />
        </header>
      )}
      <main class="view">{route.value === 'editor' ? ready.value ? <BeatLab /> : <p class="boot">Loading…</p> : <GrooveView />}</main>
      {!desktop && <Tabs where="bottom" />}
      <Toast />
      <ConfirmSheet />
    </div>
  );
}
