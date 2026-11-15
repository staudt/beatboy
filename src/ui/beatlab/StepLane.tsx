import { useRef } from 'preact/hooks';
import { SOUNDS } from '../../domain/sounds';
import { registerLane, laneView } from '../laneScroll';
import { auditionSound, selectedSound } from '../state/lab';
import { useFollowPlayhead } from '../useFollowPlayhead';
import { useEffect } from 'preact/hooks';
import { SoundKey, soundTitle } from './SoundKey';
import { BeatsControl, FollowChip, Ruler, TrackCells } from './Timeline';

/** Mobile step editor: one horizontal timeline of the selected sound across all bars. */
export function StepLane() {
  const sound = selectedSound.value;
  const scroller = useRef<HTMLDivElement>(null);
  useFollowPlayhead(scroller);

  useEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    registerLane(sc);
    let raf = 0;
    const update = () => {
      raf = 0;
      const cells = sc.querySelectorAll<HTMLElement>('[data-cell]');
      const sr = sc.getBoundingClientRect();
      let s0 = -1;
      let s1 = -1;
      for (const c of cells) {
        const r = c.getBoundingClientRect();
        if (r.right > sr.left && r.left < sr.right) {
          const step = Number(c.dataset.step);
          if (s0 < 0) s0 = step;
          s1 = step;
        }
      }
      const prev = laneView.peek();
      if (s0 < 0) laneView.value = null;
      else if (!prev || prev.s0 !== s0 || prev.s1 !== s1) laneView.value = { s0, s1 };
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    sc.addEventListener('scroll', schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(sc);
    ro.observe(sc.firstElementChild as Element);
    schedule();
    return () => {
      sc.removeEventListener('scroll', schedule);
      ro.disconnect();
      cancelAnimationFrame(raf);
      registerLane(null);
    };
  }, []);

  return (
    <section class="lane" aria-label={`${SOUNDS[sound].name} steps`}>
      <div class="lane-head">
        <h3
          class="stepgrid-title"
          title={soundTitle(sound)}
          data-testid="lane-title"
          onPointerDown={(e) => (e.button === 0 || e.pointerType !== 'mouse') && auditionSound(sound)}
        >
          <SoundKey sound={sound} />
          {SOUNDS[sound].name}
        </h3>
        <FollowChip />
        <span class="spacer" />
        <BeatsControl />
      </div>
      <div class="lane-scroll tl" ref={scroller} data-testid="lane">
        <div class="lane-inner">
          <Ruler />
          <TrackCells sound={sound} />
        </div>
      </div>
      <p class="hint lane-hint" aria-hidden="true">
        tap: on / off · hold for <i class="glyph g-accent" /> accent or <i class="glyph g-ghost" /> ghost · swipe to scroll
      </p>
    </section>
  );
}
