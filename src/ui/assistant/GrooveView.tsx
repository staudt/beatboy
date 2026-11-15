import { feelOf } from '../../domain/patternOps';
import type { Pattern } from '../../domain/types';
import { IconPlay, IconStop } from '../common/icons';
import { PatternPicker } from '../common/PatternPicker';
import { Stepper } from '../common/Stepper';
import { isDesktop } from '../media';
import { navigate } from '../router';
import { CLICK_ONLY_ID } from '../state/grooveLogic';
import {
  CLICK_ONLY,
  beatsPerBar,
  click,
  countInBars,
  crashAfterFill,
  fill,
  fillPhase,
  fills,
  groovePickerList,
  grooveId,
  fillId,
  playing,
  selectFill,
  selectGroove,
  selectedFill,
  selectedGroove,
  setBeats,
  setClickEnabled,
  setClickVolume,
  setCountIn,
  togglePlay,
} from '../state/groove';
import { selectPattern } from '../state/lab';
import { BeatLamps } from './BeatLamps';
import { BpmControl } from './BpmControl';

const beatsLabel = (p: Pattern) => `${p.timeSig.num} beat${p.timeSig.num === 1 ? '' : 's'} · ${feelOf(p)}`;
const grooveSubtitle = (p: Pattern) => (p.id === CLICK_ONLY_ID ? 'metronome only, no drums' : `${beatsLabel(p)}${p.builtIn ? ' · built-in' : ''}`);

function Actions() {
  const on = playing.value;
  const ph = fillPhase.value;
  const desktop = isDesktop.value;
  const canFill = on && !!selectedGroove.value && !!selectedFill.value;
  return (
    <div class="gv-actions">
      <button
        type="button"
        class={`btn gv-play${on ? ' is-playing' : ''}`}
        aria-label={on ? 'Stop' : 'Play'}
        onClick={togglePlay}
      >
        {on ? <IconStop width={30} height={30} /> : <IconPlay width={30} height={30} />}
        <span>{on ? 'Stop' : 'Play'}</span>
        {desktop && <kbd class="gv-kbd">Space</kbd>}
      </button>
      <button
        type="button"
        class={`btn gv-fill is-${ph}`}
        data-testid="fill-btn"
        data-state={ph}
        disabled={!canFill}
        onClick={fill}
      >
        <span>{ph === 'queued' ? 'Queued' : ph === 'active' ? 'Filling' : 'Fill'}</span>
        {desktop && <kbd class="gv-kbd">F</kbd>}
      </button>
    </div>
  );
}

function Settings() {
  const n = beatsPerBar.value;
  const cin = countInBars.value;
  const c = click.value;
  const g = selectedGroove.value;
  return (
    <div class="gv-settings">
      <div class="gv-row gv-row-pair">
        <div class="gv-field">
          <span class="label">beats</span>
          <div class="gv-beats">
            <Stepper label="Beats" value={n} min={1} max={7} onChange={setBeats} />
            <span class="gv-sig" aria-hidden="true">
              {n}/4
            </span>
          </div>
        </div>
        <div class="gv-field">
          <span class="label">count-in</span>
          <div class="seg" role="group" aria-label="Count-in">
            {([0, 1, 2] as const).map((v) => (
              <button key={v} type="button" class="btn seg-btn" aria-pressed={cin === v} onClick={() => setCountIn(v)}>
                {v === 0 ? 'Off' : v}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div class="gv-row gv-click">
        <button type="button" class="btn gv-click-toggle" aria-pressed={c.enabled} onClick={() => setClickEnabled(!c.enabled)}>
          Click {c.enabled ? 'on' : 'off'}
        </button>
        <input
          class="range"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={c.volume}
          aria-label="Click volume"
          onInput={(e) => setClickVolume(Number(e.currentTarget.value))}
        />
      </div>

      <div class="gv-field gv-pick">
        <span class="label">groove</span>
        <PatternPicker
          patterns={groovePickerList.value}
          currentId={grooveId.value ?? CLICK_ONLY.id}
          onSelect={selectGroove}
          subtitleOf={grooveSubtitle}
          label="Groove"
          nameTestId="groove-name"
        />
        <div class="gv-sub">
          <span class="hint" data-testid="groove-sub">
            {g ? beatsLabel(g) : 'Metronome only, no drums'}
          </span>
          {g && (
            <button
              type="button"
              class="btn btn-small btn-ghost gv-edit"
              onClick={() => {
                selectPattern(g.id);
                navigate('editor');
              }}
            >
              Edit in Beat Editor
            </button>
          )}
        </div>
      </div>

      <div class="gv-field gv-pick">
        <span class="label">fill</span>
        <div class="gv-fillrow">
          <PatternPicker
            patterns={fills.value}
            currentId={fillId.value ?? ''}
            onSelect={selectFill}
            subtitleOf={beatsLabel}
            label="Fill pattern"
            nameTestId="fill-name"
          />
          <label class="gv-check">
            <input type="checkbox" checked={crashAfterFill.value} onChange={(e) => (crashAfterFill.value = e.currentTarget.checked)} />
            <span>Crash after</span>
          </label>
        </div>
      </div>
    </div>
  );
}

export function GrooveView() {
  return (
    <section class="gv" aria-label="Drummer">
      <div class="gv-main">
        <h2 class="label gv-title">Drummer · Groove</h2>
        <BpmControl />
        <BeatLamps />
      </div>
      <Settings />
      <Actions />
    </section>
  );
}
