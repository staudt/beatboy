import { useEffect } from 'preact/hooks';
import { BeatLab } from './beatlab/BeatLab';
import { ConfirmSheet } from './common/ConfirmSheet';
import { IconBot, IconGrid } from './common/icons';
import { Toast } from './common/Toast';
import { isDesktop } from './media';
import { navigate, route, type Route } from './router';
import { initLab, prepareAudio, ready, togglePlay } from './state/lab';

const TABS: { id: Route; label: string; icon: typeof IconGrid }[] = [
  { id: 'assistant', label: 'Assistant', icon: IconBot },
  { id: 'lab', label: 'Beat Lab', icon: IconGrid },
];

function Tabs({ where }: { where: 'top' | 'bottom' }) {
  const desktopOrder = [...TABS].reverse();
  return (
    <nav class={`tabs tabs-${where}`} aria-label="Sections">
      {(where === 'top' ? desktopOrder : TABS).map((t) => (
        <button
          key={t.id}
          type="button"
          class="tab"
          aria-current={route.value === t.id ? 'page' : undefined}
          onClick={() => navigate(t.id)}
        >
          <t.icon width={20} height={20} />
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

function Assistant() {
  return (
    <section class="assistant card" aria-label="Drum Assistant">
      <span class="chip chip-builtin">Coming next iteration</span>
      <h2>Drum Assistant</h2>
      <p>Drum Assistant — songs, sections and a performance view — arrive in the next iteration.</p>
    </section>
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
    void initLab();
    // First gesture warms up audio + loads the kit.
    const warm = () => prepareAudio();
    document.addEventListener('pointerdown', warm, { once: true, capture: true });
    let spaceHandled = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (isTypingTarget(t) || route.value !== 'lab') return;
      e.preventDefault();
      spaceHandled = true;
      togglePlay();
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
      <main class="view">{route.value === 'lab' ? ready.value ? <BeatLab /> : <p class="boot">Loading…</p> : <Assistant />}</main>
      {!desktop && <Tabs where="bottom" />}
      <Toast />
      <ConfirmSheet />
    </div>
  );
}
