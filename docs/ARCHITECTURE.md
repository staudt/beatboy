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
  - Drummer -> Editor while stopped: the editor selects the **focus section's** pattern (`selectPattern`, no
    autosave or playback side effects). Focus (`songs.focusSectionId`, runtime only, reset on song change) is the
    section last played (follows the playing section, stays after Stop), tapped / number-keyed while stopped, or whose
    beat dropdown was opened or beat edited. No focus yet: the start section, else section 1 (`focusPatternId`).
  - Copy-on-write of a built-in that the playing section uses repoints that section to the copy.
  - "Something else" in the editor (pick another pattern, New beat, Duplicate, delete the current one) while mode is
    `song`: `engine.playPattern` swaps the source to a `PatternLoopSource` without restarting the scheduler (same
    transport position, no count-in, no click) and mode becomes `lab`.
  - Editor -> Drummer: `song` continues; `lab` stops; `idle` nothing.
  - Editor Play when stopped always loops the editor's pattern (`lab`); Stop stops whatever plays.
  - Editor pattern picker: the first group is "In <Song name>" (`songGrooves`): the current song's distinct patterns in
    section order, song-local beats included, subtitle "<sections> · <length>"; the usual groups follow without those
    patterns (other songs' beats stay hidden). The find field also matches section names (`groupWithLeading`).
  - Playing dot: Drummer tab when mode is `song`; Beat Editor tab when `lab`.

## Drummer (songs)

The Drummer tab is song-only (`ui/assistant/Song*.tsx`, state in `ui/state/songs.ts`, pure helpers in `songLogic.ts`,
shared transport settings in `ui/state/drummer.ts`). A single groove is just a one-section song with LOOP on; the
built-in pattern "No drums (click only)" (`f-click-only`) makes a section a pure metronome. First run seeds two songs:
"Practice" (Rock 8ths, 4 bars, loop on; selected, so Play is one tap) and a demo arrangement.

- **Layout**: phones and tablets (< 900 px): song picker (`PatternPicker` in song form: rename, find, New song), a compact
  tempo row, then the section rows; a *dock* (now-playing bar + transport: PLAY, FILL, NEXT, BREAK, LOOP, CLICK) is sticky
  at the bottom of the scroll area directly above the tab bar. Desktop (>= 900 px, `isDesktop`): `SongView` renders a
  full-width **sticky player** (`.sv-player`, pinned under the top tabs, <= 200 px: row 1 song picker, icons, save status
  and tempo; row 2 now-playing panel and transport) and below it the section list centred at max 1160 px, one line per
  row (handle, go, label, beat display, x n, F, loop, copy, delete). `SongView` publishes the player height as `--player-h`
  (ResizeObserver); rows use it as `scroll-margin-top`, and the drag auto-scroll treats the player's bottom as the top edge.
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
- Keys (not while typing): Space play/stop, F fill, Right/Down/PageDown next, Left/Up/PageUp prev (stopped: move the
  start section), B break, L loop, C click, T tap. Tempo has no arrow keys (slider, +/-, TAP).
- **Sticky LOOP**: a user LOOP toggle (`userLoop`) persists across section changes until the song restarts; untouched,
  each section's saved `loop` flag applies. `SongInfo.loopLocked` reports it.
- **Accumulating NEXT/PREV**: while a change is queued each press moves the queued *target* by one (clamped; past the last
  section = final hit, PREV from it = last section); returning to the current section cancels the queue. Jump replaces
  the queue. Timing is unchanged (next unplanned bar line); the NEXT fill is armed only by the first step.

## Song-local beats (typed section text)

Each section row is `line 1 controls` and `line 2 = [beat display] [- x n +]` (one line on desktop). The **beat display**
is a read-only button: it shows the groove's NAME for a saved groove, or the written pattern (one line of monospace beat
text, ellipsis) for a song beat, plus a muted length caption ("4 beats" / "3 steps"; under the text on phones, at the right
on wider rows). Clicking it (or Space / Enter / arrow keys on it) opens a dropdown panel (`PatternPicker` with `renderTrigger`
and `topSlot`), top to bottom: (1) the **beat text editor** (auto-growing textarea, 1-3 lines, live caption "4 steps · 1 beat"
or the first error, "Open in Beat Editor"); (2) **name and save**: a song beat gets a name field (default "<Song> ·
<Section>") and "Save as groove", a saved groove shows its name, "saved groove" and "Built-in" (renaming stays in the Beat
Editor); (3) "Choose another beat": the find field and the grouped groove list (song beats excluded). Typing happens only
in the panel; the row itself is never an input.

- **Data**: `Pattern.ownerSongId?` marks a pattern owned by one song. It is a normal user pattern (patterns store,
  autosave, playable, editable) hidden from the groove pickers (`grooves`/`fills` in drummer.ts, the section and default
  fill pickers) and from the Beat Editor list (except while it is the open pattern, shown under "Song beat" with a
  "Save as groove" button). The storage validator keeps the field; no schema bump (additive, old records have no owner).
  `duplicatePattern` drops it (a duplicate is a library pattern).
- **Rules** (pure, `domain/songBeats.ts`, applied by `songs.setSectionText`): typing over a library groove creates a
  local copy (name "<Song> · <Section>", feel and mix copied) and points the section at it, the groove is never touched;
  a local beat only this section uses is updated in place; a local beat used by 2+ sections (or owned by another song) is
  forked. Text is parsed live (250 ms debounce; Enter, closing the panel or clicking outside flush it); invalid text shows the error,
  keeps playing the last valid beat and saves nothing (Enter on invalid text keeps the panel open); Escape discards pending text and closes. Every typed step is one square (a 16th, or a triplet step for triplet
  grooves) and the loop is exactly as long as the text, so `kh h hs h` is one beat and `s k s` a 3-step beat; the
  section's × n plays it n times. Empty text is an error ("Type at least one step").
- **Copies**: duplicating a section, the add-section chips and duplicating a song fork song-local beats, so edits stay
  independent. Choosing a groove never deletes the previous local beat.
- **GC**: `garbageLocalPatterns` (owned patterns that no section/fill of their song references, or whose song is gone) runs
  once after songs and patterns are loaded and after deleting a song; never during the section-delete Undo window.
- **Playback**: the engine reads patterns live at every collect, so an edit is heard within the look-ahead (~120 ms),
  notes already scheduled are untouched; a changed beat count takes effect at the next bar.
- **Save as groove** (the panel's name field + button; the Beat Editor uses a small sheet) clears `ownerSongId` (category "My beats"); sections keep referencing it.
  **Open in Beat Editor** selects the pattern even while a song plays (`link.openInEditor`).

## Drum-tab importer

`src/import/tab/` is a pure TypeScript pipeline (no DOM, never throws) behind `parseDrumTab(text) -> TabImport` (`reject`, `confidence`, `song {name, bpm}`, `sections {name, feel, times, beat}`, `warnings`). Strategy: `docs/tab-formats.md` section 7; corpus: `tests/fixtures/tabs` (40 fixtures, `tests/unit/tabImport.test.ts`).

- `normalise.ts`: entities, NFKC, BOM/zero-width/NBSP, Unicode dashes and bars, tabs, BBCode wrappers, `>` quotes, line-number column.
- `classify.ts` + `rows.ts` + `legend.ts`: per-line classification (row, count, bracket/ending/repeat line, header, legend, metadata, prose); rows are split into bar cells (beat groups joined, `||` stronger than `|`, `(o)` ghosts collapsed, repeat signs, trailing comments cut, fret-number rows flagged as guitar).
- `instruments.ts`: label to instrument (legend wins; `F` ambiguity rule) and per-family hit-character mapping (accent, ghost, open/closed hat, flams simplified).
- `systems.ts`: label inference, bar alignment by bar index (pad/truncate), per-bar grid from the character count (8/16/32/12/24, odd lengths kept), hits into sparse steps. `index.ts` also joins hard-wrapped systems.
- `repeats.ts`, `sections.ts`: `|: :|` and endings, `xN`, "same as", headers, shortest period (up to 4 bars) = one section x times, headerless runs = "Part N", unique names.
- `beat.ts`: bars to a Pattern and `formatBeatText`, so beats are canonical. `confidence.ts`: warnings with penalties. `toSong.ts`: tab to Song + song-local beats (identical beats shared, kinds from names).
- UI: `ui/common/TabImportSheet.tsx` (live preview, 300 ms debounce), `ui/state/tabImport.ts` (create, select, toast); entry points in the Drummer song picker and the settings Backup section.

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

## Export / import (backup and sharing)

Everything lives only in the browser, so the Drummer settings sheet has a Backup section (Export everything, Import…,
"Last backup", persisted as the `lastExportAt` setting) and the song header has Export song. Pure code:
`src/storage/exportImport.ts`; file I/O, preview and persistence: `src/ui/state/backup.ts`, `ui/common/ImportSheet.tsx`.

```
{ format: 'beatboy', version: 1, kind: 'library' | 'song', exportedAt: ISO, app?: string,
  patterns: StoredPattern[]   // user patterns incl. song-local beats, each with schemaVersion
  songs: StoredSong[],        // each with schemaVersion
  settings?: { drummer?: … } } // library exports only (not applied on import: it would clobber the tempo)
```
- `version` is the file format. A larger version is refused ("made by a newer version of Beatboy"); wrong `format`,
  invalid JSON or an empty file give readable errors. Each record goes through `migratePattern` / `migrateSong`, so older
  schema versions import; unreadable records are skipped and counted ("2 patterns could not be read and were skipped").
- `exportSong` = the song + every non-built-in pattern it references (grooves, fills, its song-local beats). Built-ins
  are referenced by their stable `f-…` ids and are never exported or imported (`builtIn` records and `f-` ids are ignored).
- `planImport(local, incoming, 'keepBoth' | 'replace')` returns the records to put plus a summary
  `{songsAdded, songsReplaced, patternsAdded, patternsReplaced, skipped}`, a conflict count, the song to select and warnings.
  Same id + identical content (key order ignored) = skipped. Same id + different content:
  - keepBoth: the incoming record gets a new id (`crypto.randomUUID`) and every reference follows (section `patternId`,
    fill `patternId`, `fillId`). A conflicting song's own beats get new ids and the new `ownerSongId`; a copied library
    groove is named "… (imported)". A song added while its name is taken becomes "<name> (imported)".
  - replace: local records with those ids are overwritten.
  - A beat whose owner song is in neither the file nor the library becomes a normal groove. References to non-built-in
    patterns found nowhere are kept (the section plays silence) and reported as a warning in the preview.
- Imports go through the shared autosavers (`putImportedPatterns` / `putImportedSongs`, patterns first, then flush), so they are
  persisted before the toast. On phones that can `navigator.canShare({files})` the file goes through the share sheet,
  otherwise a Blob download. Drop a file on the page (desktop) or use Import… to get the preview.

## Deployment

Static build (`base: './'`, hash routes) deployable to GitHub Pages by `.github/workflows/deploy.yml`.
All assets (kit, fonts) are served from the same origin; E2E tests assert there are no third-party requests.
