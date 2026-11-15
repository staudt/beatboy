# Beatboy architecture

## Layers

```
src/domain   pure model: Pattern, ticks/time math, sounds, beat-text notation, factory patterns
src/engine   pure timing: TempoMap, Scheduler (look-ahead), EventSources (PatternLoopSource; SongPerformer later)
src/audio    Web Audio: AudioContext unlock, sprite kit loader, Sampler (NoteSink), DrumEngine facade
src/storage  IndexedDB (idb): PatternRepo, validation + migrations, debounced Autosaver
src/ui       Preact + signals: stores in ui/state, components per tab
```

Dependencies only point downward: `ui → storage/audio → engine → domain`. `engine` and `domain` have no
DOM or Web Audio imports and are fully unit-tested in Node.

## Musical time

- Integer **ticks**, `TPQ = 480` per quarter note. A beat is one `1/den` note (`beatTicks = 480·4/den`).
- Patterns store sparse notes `{tick, vel}` per sound. The step grid is a *view*:
  `stepTicks = beatTicks / stepsPerBeat`.
- **Beats + feel model**: a Beat Lab pattern is one loop of N beats (1–32, the BEATS control at the top right of
  the editor). Every pattern has `timeSig = {num: N, den: 4}` and `bars = 1` (the field stays for the engine and
  later songs, where bar grouping will live). The grid is always 16ths: `stepsPerBeat` is 4 (FEEL = Straight, 4
  squares per beat; 8th-note grooves leave every other square empty) or 3 (FEEL = Triplet: shuffle, 6/8, 12/8).
  Changing FEEL quantizes notes to the new grid (nearest step, ties earlier, collisions keep the loudest), so no note
  is ever invisible. Adding a beat appends an empty beat; removing one drops its notes (the UI confirms first).
  `toBeatGrid` (patternOps) converts legacy meters (6/8 → 2×3, 12/8 → 4×3, …) with identical timing at the same BPM
  and flattens multiple bars into beats (`bars: b, num: k` → `bars: 1, num: k·b`, every tick unchanged); storage
  schema v3 applies this on read.
- **BPM counts pulses**: the beat in simple meters, the dotted beat group in compound meters
  (legacy 6/8 at 60 BPM = 60 dotted quarters per minute; with den 4 the pulse is just the beat). `secondsPerTick = 60 / (bpm · pulseTicks)`.
- **Swing** is classic 8th-note swing (the guitarist's "shuffle" knob, 50–75%), applied at scheduling time and
  never stored in the notes. Time is warped inside each beat so the "&" (half-beat) lands at `swing` of the beat and
  the 16ths in between scale proportionally. With `f = tickInBeat / beatTicks` in [0, 1):
  `f < 0.5 → warped = f · (swing / 0.5)`, else `warped = swing + (f − 0.5) · ((1 − swing) / 0.5)`; the playback
  offset is `(warped − f) · beatTicks` (`swingOffset` in `domain/time.ts`). 0.5 = straight, 0.67 ≈ triplet shuffle
  (the "&" lands on the 3rd triplet, the 16th "e" at 1/3 of the beat), 0.75 = dotted feel. Beat starts never move
  and note order is preserved. Triplet feel ignores swing.

## Scheduling ("two clocks")

Timing is the top product requirement, so sounds are never triggered from a JS timer.

1. A **Web Worker** posts a tick every 25 ms (falls back to `setInterval`). Worker timers are not throttled
   by main-thread work.
2. Each tick calls `Scheduler.pump()`: it asks the current `EventSource` for every note in the tick window
   `[scheduledUntil, tickAt(now + 120 ms))` and hands each to the Sampler with an absolute
   `AudioContext` time (`source.start(t)`, sample accurate).
3. Only ~120 ms is ever committed, so live edits and (later) NEXT/FILL/BREAK take effect almost
   immediately, and stopping never leaves a long queue of notes.
4. **TempoMap**: a list of `(tick, time, secondsPerTick)` segments. A tempo or time-signature change
   appends a segment at `scheduledUntil`, so the position is continuous and nothing drifts. All positions
   derive from the audio clock, never from accumulated timer deltas.
5. **Stalls** (background tab, GC pause): notes more than 80 ms in the past are dropped instead of being
   played in a burst; the grid stays aligned.
6. **Playhead UI**: a `requestAnimationFrame` loop reads `tickAt(currentTime − outputLatency − baseLatency)`,
   so what you see matches what you hear.
7. **Start/stop**: the AudioContext is created/resumed inside the user's first gesture (autoplay policy;
   iOS gets a silent unlock buffer). Stop ramps the master gain to 0 over 30 ms and stops all voices,
   including ones already scheduled for the next 120 ms, so stopping is click-free.

## Sound

- One kit = one MP3 **sprite** plus `kit.json` (start/duration/gain per sound), ~250 KB.
  Built by `scripts/build-kit.mjs` from CC0 sources (see `ASSET_LICENSES.md`).
- On load the sprite is decoded once and sliced into per-sound `AudioBuffer`s. Each slice starts at the
  detected onset (first sample within 24 dB of the sound's peak, minus 1 ms), which absorbs MP3 encoder
  delay and pre-echo.
- One sample per sound; velocity is gain only: `(vel/127)^1.6` (ghost 40, normal 96, accent 127).
- Hi-hat **choke**: any hi-hat hit fades out a ringing open hat at the new hit's scheduled time.
  Per-sound polyphony cap of 8. A gentle compressor on the master acts as a safety limiter.

## Persistence

- IndexedDB stores `patterns` and `settings` (more stores in later schema versions).
- Every record carries `schemaVersion`; `migratePattern` runs ordered migration steps, then a validator
  repairs what it can (sorting, clamping, dropping bad notes) and rejects the rest.
- Factory patterns live in code (`src/domain/factory.ts`) and are read-only; editing one saves a copy
  ("copy on write").
- The `Autosaver` debounces (400 ms), coalesces per id, serializes writes, keeps failed writes pending for
  retry, and flushes on `visibilitychange`/`pagehide`.

## Deployment

Static build (`base: './'`, hash routes) deployable to GitHub Pages by `.github/workflows/deploy.yml`.
All assets (kit, fonts) are served from the same origin; E2E tests assert there are no third-party requests.
