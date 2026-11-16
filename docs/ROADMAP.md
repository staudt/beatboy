# Roadmap

Ideas agreed with the user but not built yet (text-first song sections are done: see ARCHITECTURE, "Song-local beats"), roughly in priority order. Each item lands as its own slice
(working build + check-in).

## Live performance
- Full-screen perform view with an edit lock (rows become big tap targets, no accidental edits).
- Custom key mapping for footswitches (learn mode, conflict warnings); optional Web MIDI input.

## Durability
- Installable PWA with offline support (precache app + kit).

## Section feel
- Optional per-section modifiers: intensity, half-time, crash on entry, hats → ride.

## Drum-tab importer (done, first version)
Paste a drum tab -> a song: see ARCHITECTURE, "Drum-tab importer". Remaining gaps:
- Only synthetic fixtures so far: add real-world tabs (with permission) and re-tune.
- No manual repair view (reassign a row's instrument, split/merge bars) when confidence is low.
- Odd meters are kept as plain step counts (no time signature); 32nd/24-char bars are merged to the 16th/triplet grid.
- Fills are not detected as fills (a fill bar is just another section); no "import into the current song".
- Nested repeats, D.S./D.C., and per-bar resolution changes inside one section are not handled.
