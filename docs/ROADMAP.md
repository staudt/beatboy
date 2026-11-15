# Roadmap

Ideas agreed with the user but not built yet (text-first song sections are done: see ARCHITECTURE, "Song-local beats"), roughly in priority order. Each item lands as its own slice
(working build + check-in).

## Live performance
- Full-screen perform view with an edit lock (rows become big tap targets, no accidental edits).
- Custom key mapping for footswitches (learn mode, conflict warnings); optional Web MIDI input.

## Durability
- Export / import songs and patterns as versioned JSON (validated, migrated).
- Installable PWA with offline support (precache app + kit).

## Section feel
- Optional per-section modifiers: intensity, half-time, crash on entry, hats → ride.

## Drum-tab importer (later)
- Paste a drum tab from the web → a song with sections and grooves, "good, never perfect".
- Build a fixture corpus of real tabs (various sites/styles, including broken ones) with hand-checked
  expectations; measure accuracy per fixture so the parser only improves.
- Tolerant parser: detect instrument lines by label (HH, Hh, CC, Cr, Ri, SD, S, BD, B, T1, T2, FT…), align
  systems on bar lines, infer the grid per bar from character counts, map hit glyphs (x o X O g f > …),
  handle repeats (`x2`, `|: :|`), section headers (Verse, Chorus…), stacked systems and ragged widths;
  dedupe identical bars into shared grooves.
