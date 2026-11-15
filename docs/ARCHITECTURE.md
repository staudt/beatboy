# Beatboy architecture

## Layers

```
src/domain   pure model: Pattern, ticks/time math, sounds, beat-text notation, factory patterns
src/engine   pure timing: TempoMap, Scheduler (look-ahead), EventSources (PatternLoopSource, SongSource)
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
- **Beats + feel model**: a Beat Editor pattern is one loop of N beats (1–32). Every pattern has
  `timeSig = {num: N, den: 4}` and `bars = 1` (the field stays for the engine and later songs, where bar grouping will
  live). **Length in steps**: the loop can be any number of squares, not only whole beats (`s k s` is a 3-step loop).
  `Pattern.steps?` holds the length only when it is not a whole number of beats (then `timeSig.num = ceil(steps /
  stepsPerBeat)`); otherwise it is absent and the length is `num × stepsPerBeat × bars`. Always read lengths through
  `patternSteps` / `patternTicks` (`domain/time.ts`), never from `timeSig`: the engine loop, song bars (one bar = one
  pass of the groove, so a 3-step groove makes a 360-tick bar), fills, the editor grids, the formatter and the
  validator all do. Limits: 1 step to 32 beats' worth. Editor `+` / `−` add / remove one beat's worth of squares (4
  straight, 3 triplet; 3 → 7 → 11, min 1 step); the stepper reads "4 beats" or "3 steps". Changing FEEL keeps the
  beats of a whole-beat loop and converts a partial one proportionally (rounded, min 1 step). Songs: clicks are one per
  beat from each bar start (a 3-step bar has just its accent) and the count-in bar is `max(start bar, 4 beats)`.
  Storage schema v4 adds `steps` (identity migration from v3). The grid is always 16ths: `stepsPerBeat` is 4 (FEEL = Straight, 4
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

## Tabs, shared tempo and the Drummer/Editor link

Two tabs: **Drummer** (`#/drummer`, default, first) and **Beat Editor** (`#/editor`). Old `#/assistant` / `#/lab`
hashes are rewritten with `replaceState`. (Internal names `assistant/`, `beatlab/`, `lab.ts` are unchanged.)

- **One tempo**: both tabs read and write `drummer.bpm` (persisted with the Drummer settings); the engine follows it
  in every mode. In the Drummer it is the current song's tempo (see below). `Pattern.bpm` stays in the data model but
  no longer drives playback; selecting or creating a pattern never changes the tempo.
- **Link rules** (pure functions in `ui/state/linkLogic.ts`, wired in `ui/state/link.ts` by one effect on the route
  signal, so tab clicks, keyboard and the back button behave the same). `engine.mode` is `idle | lab | song`.
  - Drummer -> Editor while a song plays: the editor selects the pattern of the section playing right now before it
    renders; playback (same `SongSource`, which reads patterns from the shared library on every collect, so editor
    edits are heard live) is untouched.
  - Copy-on-write of a built-in that the playing section uses repoints that section to the copy.
  - "Something else" in the editor (pick another pattern, New beat, Duplicate, delete the current one) while mode is
    `song`: `engine.playPattern` swaps the source to a `PatternLoopSource` without restarting the scheduler (same
    transport position, no count-in, no click) and mode becomes `lab`.
  - Editor -> Drummer: `song` continues; `lab` stops; `idle` nothing.
  - Editor Play when stopped always loops the editor's pattern (`lab`); Stop stops whatever plays.
  - Playing dot: Drummer tab when mode is `song`; Beat Editor tab when `lab`.

## Drummer (songs)

The Drummer tab is song-only (`ui/assistant/Song*.tsx`, state in `ui/state/songs.ts`, pure helpers in `songLogic.ts`,
shared transport settings in `ui/state/drummer.ts`). A single groove is just a one-section song with LOOP on; the
built-in pattern "No drums (click only)" (`f-click-only`) makes a section a pure metronome. First run seeds two songs:
"Practice" (Rock 8ths, 4 bars, loop on; selected, so Play is one tap) and a demo arrangement.

- **Layout**: song picker (`PatternPicker` in song form: rename, find, New song), a compact tempo row, then the section
  rows; a *dock* (now-playing bar + transport: PLAY, FILL, NEXT, BREAK, LOOP, CLICK) is sticky at the bottom of the
  scroll area directly above the tab bar on phones, and the sticky left column on desktop (>= 900 px).
- **Section rows** are always editable inline: drag handle (pointer-event drag with auto-scroll, handle only; Arrow keys
  on the focused handle also move the row and announce it), label (tap to rename), fill/loop/duplicate/delete toggles,
  groove picker and bars stepper. Tapping a row jumps there at the next bar line while playing, or picks the start
  section while stopped. Delete has no confirmation, the toast offers Undo for 5 s.
- **Songs** live in `repo.songs` (shared connection with the pattern repo). Edits go through `editSong(fn)` (immutable
  `songOps`) and a dedicated debounced `Autosaver<Song>`. `currentSongId` is a setting.
- **Settings** (`drummer.ts`, persisted under `drummer`; the legacy `groove` record of the old Groove mode is read when
  `drummer` is missing): shared BPM, click on/off + volume, count-in bars, crash after fill, last groove (default for
  new songs). CLICK is a live toggle in the dock (key C); the rest is in the settings sheet.
- **Tempo**: the shared `drummer.bpm` is the transport tempo. Selecting/creating a song sets it to `song.bpm`; any BPM
  change is written back to the current song.
- **Playback**: `engine.playSong(() => SongConfig, { startSection, countIn })` is called synchronously in the gesture;
  the config is rebuilt with `.peek()` on every collect (`buildSongConfig`), so click/count-in/groove edits apply
  within the look-ahead (~120 ms). A rAF loop mirrors `engine.songInfo()` into a signal only when a displayed field
  changes. The wake lock is held while a song plays.
- **Delete protection**: `lab.requestDelete` asks `hooks.songsUsing(id)` and shows an informational ConfirmSheet
  ("Used in: ...") instead of deleting a pattern a song uses.
- Keys (not while typing): Space play/stop, F fill, Right/PageDown next, Left/PageUp prev, B break, L loop, C click,
  T tap, Up/Down BPM.

## Song-local beats (typed section text)

Each section row is `line 1 controls` and `line 2 = [beat combobox] [− × n +]`. The combobox is a monospace text field
holding the section pattern as ONE line of beat text (`formatBeatText(p, { lineBreaks: false })`), with a small name tag
("Rock 8ths" or "song beat"; on narrow rows the tag moves to the caption line below the field, which also shows
"4 steps · 1 beat" / "3 steps" or the first error as "col N: message"). Its ▾ opens the groove picker with the actions
"Save as groove…" (song beats only) and "Open in Beat Editor", then the saved grooves.

- **Data**: `Pattern.ownerSongId?` marks a pattern owned by one song. It is a normal user pattern (patterns store,
  autosave, playable, editable) hidden from the groove pickers (`grooves`/`fills` in drummer.ts, the section and default
  fill pickers) and from the Beat Editor list (except while it is the open pattern, shown under "Song beat" with a
  "Save as groove" button). The storage validator keeps the field; no schema bump (additive, old records have no owner).
  `duplicatePattern` drops it (a duplicate is a library pattern).
- **Rules** (pure, `domain/songBeats.ts`, applied by `songs.setSectionText`): typing over a library groove creates a
  local copy (name "<Song> · <Section>", feel and mix copied) and points the section at it, the groove is never touched;
  a local beat only this section uses is updated in place; a local beat used by 2+ sections (or owned by another song) is
  forked. Text is parsed live (250 ms debounce, Enter/blur flush); invalid text shows the error, keeps playing the last
  valid beat and saves nothing; Escape reverts. Every typed step is one square (a 16th, or a triplet step for triplet
  grooves) and the loop is exactly as long as the text, so `kh h hs h` is one beat and `s k s` a 3-step beat; the
  section's × n plays it n times. Empty text is an error ("Type at least one step").
- **Copies**: duplicating a section, the add-section chips and duplicating a song fork song-local beats, so edits stay
  independent. Choosing a groove never deletes the previous local beat.
- **GC**: `garbageLocalPatterns` (owned patterns that no section/fill of their song references, or whose song is gone) runs
  once after songs and patterns are loaded and after deleting a song; never during the section-delete Undo window.
- **Playback**: the engine reads patterns live at every collect, so an edit is heard within the look-ahead (~120 ms),
  notes already scheduled are untouched; a changed beat count takes effect at the next bar.
- **Save as groove** (sheet) clears `ownerSongId` (category "My beats"); sections keep referencing it.
  **Open in Beat Editor** selects the pattern even while a song plays (`link.openInEditor`).

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

- IndexedDB stores `patterns` and `settings` .
- Every record carries `schemaVersion`; `migratePattern` runs ordered migration steps, then a validator
  repairs what it can (sorting, clamping, dropping bad notes) and rejects the rest.
- Factory patterns live in code (`src/domain/factory.ts`) and are read-only; editing one saves a copy
  ("copy on write").
- The `Autosaver` debounces (400 ms), coalesces per id, serializes writes, keeps failed writes pending for
  retry, and flushes on `visibilitychange`/`pagehide`.

## Deployment

Static build (`base: './'`, hash routes) deployable to GitHub Pages by `.github/workflows/deploy.yml`.
All assets (kit, fonts) are served from the same origin; E2E tests assert there are no third-party requests.
