# Drum tab importer fixtures

Test corpus for the drum-tab importer (see `docs/tab-formats.md` section 8). Written before the parser exists, from the point of view of a careful human transcriber. Every tab is original (generic beats, no real published tab). Each fixture is `NN-name.txt` (the pasted text, byte-exact; `36` has BOM, CRLF, NBSP, ZWSP, tabs, Unicode dashes and box-drawing bars) plus `NN-name.expected.json`.

## Expected-result format

```json
{
  "description": "what this fixture exercises",
  "reject": false,
  "minConfidence": 0.9, "maxConfidence": 1,
  "song": { "name": "Imported tab", "bpm": null },
  "sections": [ { "name": "Verse", "feel": "straight", "times": 4, "beat": "kh . h .  sh . h ." } ],
  "warningsContain": ["simplified"],
  "notes": "judgement calls"
}
```

- `beat` is Beatboy beat text at full grid resolution: one token per 16th (straight, 4 per beat) or per triplet step (3 per beat). Letters in a step are in sound order `k s j l h d o r e c i t m f z w`; uppercase = accent, `(s)` = ghost. Whitespace (the double space between beats) is cosmetic: compare token lists.
- `times` = consecutive repeats of the groove. A groove may span several bars (token count = bars x steps per bar).
- Confidence bands: clean 0.9 to 1, noisy 0.5 to 0.9, rejected 0 to 0.49.
- `warningsContain`: lowercase substrings that must appear in some warning (may be empty; the parser may emit more).
- `song.name`: a title found in the paste (Title:/Song:/first line of a titled tab), else `Imported tab`. `bpm` null when absent.

## Conventions applied

- Arrangement: **headerless** tabs split into runs of identical consecutive bars (run = section x times), named `Part 1`, `Part 2`... **Under a header** all bars up to the next header form one section: its `times` is how many times its shortest repeating phrase (period up to 4 bars) repeats, with the phrase as `beat` (fixture 29: not periodic, so one 64-step phrase x1). Repeat counts (`x4`, `(x2)`, `repeat 3 times`, `|: :|`) are total plays; `|: :|` without a count = 2.
- Header text gives the name (timestamps, `x4`, parenthesised notes and brackets stripped). A repeated name gets a numeric suffix on the later occurrences (`Verse`, `Verse 2`); an explicit number in the header is kept (`Verse 1`).
- Resolution: 8 chars/bar in 4/4 = 8ths, spread onto every other 16th. 32 chars/bar = 32nds, pairs merged to 16ths (warning `merged`). 12 chars/bar with a triplet count or 12/8 = triplet feel (12 tokens). 24 chars in 12/8 = merged to 12 (warning). Bars of other lengths (14, 20): one 16th per char, no meter stored (7/8 = 14-step beat, 5/4 = 20-step beat). A section's bars all share one grid; different grids = different sections.
- Mapping: HH/H/hh = h (x closed, o open when the line also has x, X accent), Hf = d, SD/S/SN = s, BD/B/K = k, CC/C = c, C2/Ch/Sp = i, RC/Rd/R = r (b = rideBell e), T1/T2/T3/FT = t/m/f, a lone `T` = m, Cb = w, Ta = z, Cl = l, `g` = ghost, `O`/`X` = accent, flam/drag/roll = one hit (warning `simplified`), `#` = normal hit. An uppercase letter equal to its row label (fixture 17) is a normal hit.
- `F` ambiguity (15): F is the hat foot (d) when the system also has an FT line, otherwise floor tom; a legend (14) overrides. `C` is always crash here. Both warn `ambiguous`.
- Two tabs in one paste (40): one import = one song; first title/tempo win, later sections appended, second tab warned.
- Rows with no label and unmatched row counts are dropped with a warning; unmappable instruments (woodblock) are dropped with `unknown instrument`.

## Fixtures

| Fixture | Tests | Sections / reject |
|---|---|---|
| 01-basic-rock-16th | Clean HH/SD/BD, 16 chars per bar, 1e&a count line, two identical bars. | 1 |
| 02-basic-rock-8th | Same beat as 01 written at 8 chars per bar (8th resolution). | 1 |
| 03-aered-canonical | Aered-style header (Song/Band/Tempo), S/B/H/C/Hf labels, bracket |- x4 -| over a 2-bar phrase. | 1 |
| 04-editor-export-synthetic | Software-export style: long padded labels (Crash, Hi-Hat, Snare, Bass Drum), 4 bars in one system. | 2 |
| 05-five-line-tab | 5-line tab with single-letter labels C H T S B (TablEdit 5-line layout). | 2 |
| 06-eight-line-tablelike | 8-line TablEdit layout CC RC HH T1 T2 SD T3 BD; bar 2 is a tom fill T1->T2->T3. Empty HH row. | 2 |
| 07-label-case-and-width | Mixed label case and width (hh, S, Bd, CC:) inside one system; CC uses a colon and no leading bar. | 2 |
| 08-open-closed-hat | HH line with x closed, X accented closed, o open hat. | 1 |
| 09-o-as-generic-hit-on-hat | HH line uses only o (no x/X): o is the generic hit, so closed hat, low-severity warning. | 1 |
| 10-ghost-g-and-accent | Snare with g ghost notes and O accents. | 1 |
| 11-ghost-parens | Snare ghosts written as (o): each shifts the raw snare row by 2 columns against HH/BD. | 1 |
| 12-flam-drag-roll | Snare ornaments f d b r with a legend; each collapses to one snare hit. | 1 |
| 13-cymbal-zoo | Cymbal lines CC, C2, Ch, Sp, Rd with chars x X # s c b. | 2 |
| 14-foot-hat | HH plus Hf (foot = hatPedal); a legend says F is a floor tom in the fill system. | 2 |
| 15-ambiguous-F-and-C | Both an F and an FT line and no legend: F is the hi-hat foot (rule 1.2); C is the crash. | 2 |
| 16-tom-fill-systems | Fill system with only SD T1 T2 FT BD rows (no hats); rows omitted per system. | 2 |
| 17-letter-as-hit | Each row writes its own label letter as the hit (H on H, S on S, K on K). | 1 |
| 18-legend-overrides | Legend inverts the usual hat reading: o closed, x open on the HH line. | 1 |
| 19-clap-cowbell-tamb | Cowbell, tambourine, clap and kick rows. | 1 |
| 20-32nd-fill | One 32-char bar (32nds) with double-kick burst; merge pairs to 16ths with a warning. | 1 |
| 21-triplet-shuffle-12 | 12 chars per bar with a trip-let count line: triplet grid shuffle. | 1 |
| 22-12-8-slow-blues | Header 12/8 with 12-char bars, then a 24-char variant bar (16th resolution). | 2 |
| 23-odd-meter-7-8 | 7/8 bars of 14 chars (2+2+3) then a 5/4 bar of 20 chars; bar lengths differ per section. | 2 |
| 24-beat-grouped-bars | Each 16-step bar written as four 4-char beat groups split by |; || separates bars. | 1 |
| 25-space-separated-grid | Grid with a space between every step (x - x - ...), 16 steps per bar. | 1 |
| 26-no-bar-lines | Rows of 48 chars with no | at all (3 bars of 16). | 1 |
| 27-mixed-resolution | Three bars, three grids: 8 chars (8ths), 16 chars (16ths fill), 12 chars (triplet). | 3 |
| 28-repeat-variants | Four repeat styles: header x4, (x2) after system, repeat 3 times, and |: :|. | 4 |
| 29-repeat-bracket-and-endings | Repeat bar with first/second endings above the staff: |: A |1. B :|2. C plays A B A C. | 1 |
| 30-same-as-above | Chorus header says same as verse and has no tab; verse system is duplicated. | 3 |
| 31-sections-timestamps | Headers [Intro], Verse 1 (0:23), Pre-Chorus, Chorus x2, Solo, Outro; lyrics between systems; tempo q=96. | 6 |
| 32-legend-header-block | Metadata block, key/legend, numbered notes, trailing copyright text around two systems. | 2 |
| 33-wrapped-systems | A 3-bar system hard-wrapped mid-bar after 12 chars of bar 2; the second block repeats the labels. | 2 |
| 34-misaligned-lines | SD bar 2 is one char short (15), BD bar 3 one char long (17). | 1 |
| 35-missing-labels-and-bars | Second system has no labels (inferred HH/SD/BD from system 1 order); trailing/leading bars missing; an extra Wb row is dropped. | 2 |
| 36-unicode-and-crlf | Clean basic rock beat damaged by BOM, CRLF, en/em/minus dashes, box-drawing bars, NBSP, zero-width space and tabs. | 1 |
| 37-forum-paste-noise | BBCode [code] wrapper, > quote prefix, leading line numbers, trailing inline comment, prose around. | 2 |
| 38-stray-characters | Stray characters: ? and ~ as rests, . as rest, * on the snare as accent. | 1 |
| 39-guitar-tab-pasted | Ordinary 6-string guitar tab with fret numbers: not a drum tab, must be rejected. | reject |
| 40-two-tabs-one-paste | Two unrelated songs pasted together: different label sets, resolutions (16 vs 12) and tempos. | 4 |

## Holdout fixtures (41–46)
Written by the lead *after* the parser was built, without the parser author seeing them, to check that the
parser generalises beyond the 40 planned cases. They exposed three bugs (rows with no rest characters were not
recognised; `x x x x` inside bars treated spaces as rests; quoted titles were missed), which were fixed.
Keep adding unseen real-world-style cases here when the importer misreads a pasted tab.
