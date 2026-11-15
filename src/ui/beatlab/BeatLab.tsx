import { isDesktop } from '../media';
import { feelOf } from '../../domain/patternOps';
import { lengthLabel } from '../../domain/time';
import { current, labView, settingsOpen, type LabView } from '../state/lab';
import { FullGrid } from './FullGrid';
import { MixPanel } from './MixPanel';
import { OverviewGrid } from './OverviewGrid';
import { PadGrid } from './PadGrid';
import { PatternHeader } from './PatternHeader';
import { PatternSettings } from './PatternSettings';
import { StepLane } from './StepLane';
import { BeatTextField } from './BeatTextField';
import { Transport } from './Transport';
import { VelocityPopover } from './VelocityPopover';
import { IconGear } from '../common/icons';

const VIEWS: { id: LabView; label: string }[] = [
  { id: 'grid', label: 'Grid' },
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
        {lengthLabel(p)} · {feelOf(p)}
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
          </div>
        </div>
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
          <BeatTextField />
          <StepLane />
          <OverviewGrid />
        </>
      )}
      {view === 'mix' && <MixPanel />}
      <VelocityPopover />
    </div>
  );
}
