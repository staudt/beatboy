import { SECTION_LABELS, type Song } from '../../domain/song';
import type { SongInfo } from '../../engine/songSource';
import { IconChevron } from '../common/icons';
import { countInBars } from '../state/drummer';
import { announcement, currentSong, selectedSectionId, songInfo, songPlaying, songPrev } from '../state/songs';
import { clampStartIndex } from '../state/songLogic';

const QUEUE_WORD = { next: 'Next', prev: 'Prev', jump: 'Jump' } as const;

interface BadgeSpec {
  key: string;
  cls: string;
  text: string;
  testid?: string;
}

/** Status badges: loop, queued section change, break, fill, final hit. */
function badgeList(song: Song, i: SongInfo): BadgeSpec[] {
  const nameOf = (idx: number | null) => (idx === null ? 'END' : (song.sections[idx]?.name ?? '?').toUpperCase());
  const out: BadgeSpec[] = [];
  if (i.queued) out.push({ key: 'q', cls: 'b-next', text: `${QUEUE_WORD[i.queued.kind]} → ${nameOf(i.queued.sectionIndex)}`, testid: 'queued-badge' });
  if (i.loop) out.push({ key: 'l', cls: 'b-loop', text: 'Loop', testid: 'loop-badge' });
  if (i.breakQueued) out.push({ key: 'bq', cls: 'b-break', text: 'Break queued', testid: 'break-badge' });
  if (i.phase === 'break') out.push({ key: 'b', cls: 'b-break', text: 'Break', testid: 'break-badge' });
  if (i.phase !== 'fill' && i.fillQueued) out.push({ key: 'fq', cls: 'b-fill', text: 'Fill queued', testid: 'fill-badge' });
  if (i.phase === 'fill') out.push({ key: 'f', cls: 'b-fill is-on', text: 'Filling', testid: 'fill-badge' });
  if (i.phase === 'final') out.push({ key: 'e', cls: 'b-end', text: 'Final hit' });
  return out;
}

/** Now-playing bar: section, bar, progress, beat lamps, what comes next, queued actions. */
export function NowPanel() {
  const song = currentSong.value;
  const playing = songPlaying.value;
  const info = songInfo.value;
  if (!song) return <section class="now" aria-label="Now playing" data-kind="custom" data-state="stopped" />;
  const live = playing && info;
  const idx = live ? info.sectionIndex : clampStartIndex(song, selectedSectionId.value);
  const sec = song.sections[idx];
  const bars = live ? info.sectionBars : (sec?.bars ?? 0);
  const bpb = song.beatsPerBar;
  // With the count-in off, the audible tick is a few ms negative at the start (output latency): not a count-in.
  const countIn = live && countInBars.value > 0 ? info.countIn : null;
  const progress = live && countIn === null && bars > 0 ? ((info.barInSection * bpb + info.beat) / (bars * bpb)) * 100 : 0;
  const next = live ? info.nextSectionIndex : idx + 1 < song.sections.length ? idx + 1 : null;
  const nextName = next === null ? 'END' : next === idx ? 'repeat' : (song.sections[next]?.name ?? '').toUpperCase();
  const badges = live ? badgeList(song, info) : [];
  return (
    <section class="now" aria-label="Now playing" data-kind={sec?.kind ?? 'custom'} data-state={live ? 'playing' : 'stopped'} data-badges={badges.length ? '1' : undefined}>
      <div class="now-progress" role="progressbar" aria-label="Section progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
        <i style={{ width: `${progress}%` }} />
      </div>
      <div class="now-l1">
        <div class="now-name-wrap">
          <span class="label now-tag">{!live ? 'Ready' : countIn !== null ? 'Count-in' : 'Now'}</span>
          <h3 class="now-name" data-testid="now-name">
            {sec ? sec.name : song.sections.length === 0 ? 'No sections' : '—'}
          </h3>
        </div>
        <div class="now-pos" data-testid="now-bar">
          {countIn !== null ? (
            <span class="now-count" data-testid="countdown">
              {countIn}
            </span>
          ) : live ? (
            <span>
              bar {info.barInSection + 1} / {bars || '–'}
            </span>
          ) : (
            <span>{bars ? `${bars} bar${bars === 1 ? '' : 's'}` : ''}</span>
          )}
        </div>
        <button type="button" class="btn btn-icon now-prev" aria-label="Previous section" title="Previous section" disabled={!live} onClick={songPrev}>
          <IconChevron width={18} height={18} />
        </button>
      </div>
      <div class="now-l2">
        {live ? (
          <div class="now-lamps" aria-hidden="true">
            {Array.from({ length: bpb }, (_, b) => (
              <span key={b} class={`now-lamp${b === 0 ? ' is-accent' : ''}${info.beat === b ? ' is-on' : ''}`} />
            ))}
          </div>
        ) : (
          <span class="now-song" data-testid="now-song">
            {song.name}
          </span>
        )}
        <div class="now-info">
          {live && (
            <span class="now-next" data-testid="now-next">
              next › <b>{nextName}</b>
            </span>
          )}
          <div class="now-badges">
            {badges.map((b) => (
              <span key={b.key} class={`badge ${b.cls}`} data-testid={b.testid}>
                {b.text}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Screen-reader announcements: the section that is playing, and reorder results. */
export function SectionAnnouncer() {
  const song = currentSong.value;
  const i = songInfo.value;
  const sec = song && i ? song.sections[i.sectionIndex] : null;
  return (
    <>
      <div class="sr-only" aria-live="polite" role="status">
        {sec ? sec.name || SECTION_LABELS[sec.kind] : ''}
      </div>
      <div class="sr-only" aria-live="polite" role="status" data-testid="announce">
        {announcement.value}
      </div>
    </>
  );
}
