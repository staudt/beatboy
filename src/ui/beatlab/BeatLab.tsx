import { stepLabel } from '../gridLayout';
import { isDesktop } from '../media';
import { current, labView, settingsOpen, type LabView } from '../state/lab';
import { BarPager } from './BarPager';
import { FullGrid } from './FullGrid';
import { MixPanel } from './MixPanel';
import { OverviewGrid } from './OverviewGrid';
import { PadGrid } from './PadGrid';
import { PatternBrowser } from './PatternBrowser';
import { PatternHeader } from './PatternHeader';
import { PatternSettings } from './PatternSettings';
import { StepGrid } from './StepGrid';
import { TextPanel } from './TextPanel';
import { Transport } from './Transport';
import { VelocityPopover } from './VelocityPopover';
import { IconGear } from '../common/icons';

const VIEWS: { id: LabView; label: string }[] = [
  { id: 'grid', label: 'Grid' },
  { id: 'text', label: 'Text' },
  { id: 'mix', label: 'Mix' },
];

function SubTabs() {
  return (
    <div class="subtabs" role="tablist" aria-label="Editor view">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          type="button"
          role="tab"
          class="subtab"
          aria-selected={labView.value === v.id}
          onClick={() => (labView.value = v.id)}
        >
          {v.label}
        </button>
      ))}
      <span class="spacer" />
      {labView.value === 'grid' && <BarPager />}
    </div>
  );
}

function Summary() {
  const p = current.value;
  const open = settingsOpen.value;
  return (
    <button
      type="button"
      class="summary"
      aria-expanded={open}
      aria-controls="pattern-settings"
      aria-label="Pattern settings"
      onClick={() => (settingsOpen.value = !open)}
    >
      <span>
        {p.timeSig.num}/{p.timeSig.den} · {stepLabel(p.timeSig, p.stepsPerBeat)} · {p.bars} bar{p.bars === 1 ? '' : 's'}
      </span>
      <IconGear width={18} height={18} />
    </button>
  );
}

export function BeatLab() {
  if (isDesktop.value) {
    return (
      <div class="lab lab-desktop">
        <div class="lab-top">
          <PatternHeader />
          <Transport />
        </div>
        <div class="lab-cols">
          <div class="lab-left">
            <PadGrid />
            <div class="panel">
              <h2 class="label panel-title">pattern settings</h2>
              <PatternSettings />
            </div>
          </div>
          <div class="lab-right">
            <FullGrid />
            <div class="panel">
              <h2 class="label panel-title">text</h2>
              <TextPanel />
            </div>
          </div>
        </div>
        <PatternBrowser />
        <VelocityPopover />
      </div>
    );
  }
  const view = labView.value;
  return (
    <div class="lab lab-mobile">
      <PatternHeader />
      <Transport />
      <Summary />
      {settingsOpen.value && (
        <div id="pattern-settings" class="panel">
          <PatternSettings />
        </div>
      )}
      <PadGrid />
      <SubTabs />
      {view === 'grid' && (
        <>
          <StepGrid />
          <OverviewGrid />
        </>
      )}
      {view === 'text' && <TextPanel />}
      {view === 'mix' && <MixPanel />}
      <PatternBrowser />
      <VelocityPopover />
    </div>
  );
}
