# Drum tab formats in the wild: catalogue, parser strategy, fixture plan

Purpose: a precise list of the conventions a "paste a drum tab, get a song" importer must tolerate, a proposed parser strategy, and a plan for a fixture corpus.

Copyright note: published tabs are copyrighted transcriptions. This document contains no real tab. Every snippet below was written for this document (generic beats). URLs are cited only as places where a convention was observed.

## How to read the "how common" column

There is no standard for ASCII drum tab (Wikipedia's ASCII tab article says the format is "not strictly defined", and Aered's import docs say they cannot support "the huge variety of tab notations"). Frequency ratings are judgement calls from the pages consulted plus general knowledge of the genre. Ratings: **very common**, **common**, **occasional**, **rare**. Where a rating is knowledge rather than something seen in a consulted page, it is marked (est.). The web research could not fetch Ultimate Guitar tab bodies, e-chords (HTTP 403), Reddit threads, or OLGA-era archives, so those are covered by estimate only. A real corpus sample (by hand, from sources the maintainers are allowed to read) should be used to recalibrate the ratings before the parser is tuned.

---

## 1. Instrument line labels

Labels sit at the left of each line, usually 1 to 3 characters, followed by `|` (or `:`, or a space).

### 1.1 Label variants

| Instrument | Variants seen | How common | Sources |
|---|---|---|---|
| Crash | `CC`, `C`, `Cr`, `CR`, `Cy`, `C1`, `C2`, `C3`, `Cym` | CC and C very common; C1/C2 common when two crashes | [4][5][6][7][9][11] |
| China | `Ch`, `CH`, `Chi`; also a hit char `c` on the cymbal line | occasional | [4][11] |
| Splash | `Sp`, `SP`, `Spl`; also hit char `s` on cymbal line | occasional | [4][11] |
| Ride | `R`, `Rd`, `RD`, `Ri`, `RC`, `Rid` | R, Rd, RD common | [3][4][5][6][7][9][11] |
| Ride bell | usually the ride line with a different char (`b`, `B`); rarely its own line `RB`, `Bell` | occasional | [3][11] |
| Hi-hat | `HH`, `H`, `Hh`, `hh`, `HiH`, `Hat`, `HC` | HH and H very common | [3][4][5][6][7][8][9] |
| Hi-hat foot / pedal | `HF`, `Hf`, `FH`, `fH`, `HP`, `Hp`, `PH`, `P`, `F` (rare) | Hf most common; occasional overall | [3][6][10][11] |
| Open hi-hat as its own line | `HO`, `OH`, `HHO` | rare (est.) | [2] (note: wikibooks legend lists `HH` as open and `HF` as closed, the reverse of the usual reading) |
| Snare | `S`, `SD`, `Sn`, `SN`, `Sd`, `Sna` | S, SD, SN very common | [3][4][5][6][7][8][9] |
| Rimshot / sidestick | usually a char on the snare line (`@`, `r`, `x`); rarely own line `RS`, `SS`, `Rim`, `Stk` | occasional | [3] |
| Toms (generic) | `T`, `TT`, `Tom` | common in 5-line tabs | [2][8] |
| Toms (numbered) | `T1`, `T2`, `T3` (high to low) | very common | [4][8][9][11] |
| Toms (named) | `HT`, `MT`, `LT`, `FT`, `Ft`, `St`, `Mt` | common | [9] |
| Floor tom | `FT`, `Ft`, `F`, `F1`, `F2`, `FL`, `FlT`, `T3` | FT very common | [4][6][9][11] |
| Bass drum / kick | `B`, `BD`, `Bd`, `K`, `KD`, `Kick`, `Bass`, `B2` (double pedal) | B, BD very common; K occasional | [3][4][5][6][7][9][11] |
| Cowbell | `Cb`, `CB`, `Cow` (also a char `c` on a percussion line) | occasional | [11] |
| Tambourine | `Ta`, `Tamb`, `Tmb` (also a char `t`) | occasional | [11] |
| Woodblock / other | `Wb`, `P1`, `P2`, `E`, `E1` | rare | [11][12] |
| Clap | `Cl`, `Clap`, `HC` (hand clap) | rare (est.) | none consulted |

Label case varies freely (`HH`, `Hh`, `hh`, `hH`). Parser must lowercase for lookup but keep the original case for the ambiguity rules in 1.2, because case sometimes distinguishes tom sizes (a tab consulted [12] uses `t` for the small tom and `T` for the next one, `f` and `F` for floor toms).

### 1.2 Ambiguities and recommended interpretation

| Label | Possible meanings | Recommended interpretation |
|---|---|---|
| `F` | floor tom; hi-hat foot | Floor tom, unless the system also has an `FT` line or a legend line says foot/pedal, or the line contains hit chars that only make sense for hat pedal and a distinct `T`/`FT` exists. Warn. |
| `B` | bass drum; ride bell (rare); "both" | Bass drum. |
| `C` | crash; cowbell (rare); the general cymbal line in 5-line tabs ("C" = cymbals, [8]) | Crash. If the tab is 5-line (C H T S B) treat the C line as "cymbals": crash unless a legend or `r` hit chars say ride. |
| `R` | ride; roll (not as a label) | Ride. |
| `H` | hi-hat; sometimes "high tom" (rare) | Hi-hat. |
| `HH` | closed hat (common reading); open hat ([2], rare) | Hat line. Open/closed decided per hit char, not per label. |
| `T` | any tom; low tom ([2]) | If only one tom line: tomMid. If `T` plus `T1..T3`: treat `T` as generic and map to tomMid with a warning. |
| `S` | snare; splash (when the legend uses `S` for 10" splash, [12]) | Snare. |
| `Sp` | splash | Splash maps to crash2 (no splash sound) with a note. |
| `P`, `P1` | pedal hat; percussion | Percussion `P1/P2` with no legend: ignore, warn. `P` alone with an `HH` line present: hat pedal. |
| `T1/T2/T3` | high/mid/low toms in most tabs; in 8-line TablEdit layout T1=high, T2=mid, T3=floor ([13]) | T1=tomHigh, T2=tomMid, T3=tomFloor. If only `T1`,`T2` plus an `FT`: T1 high, T2 mid. If only `T1`,`T2` and no other tom lines: tomHigh, tomMid. |
| `Hf` / `FH` | foot hat | hatPedal. |
| `Ch` | china; "Chimes" | china maps to crash2. |

Rule of thumb for the parser: normalise label (lowercase, strip trailing digits for family, remember the digit), then look up in a family table. Prefer a legend in the same paste over any default (see 4.4).

### 1.3 Label punctuation / geometry

| Variant | Example | How common |
|---|---|---|
| `LL|` label directly touching the first bar line | `HH|x-x-|` | very common |
| `LL |` space before bar line | `HH |x-x-|` | common |
| `L|` single-char label, often right-aligned with a leading space | ` S|----` | common |
| `LL:` or `LL -` colon / dash after label | `HH: x-x-` | occasional |
| label plus no bar line: `HH x-x-x-x-` | | occasional (est.) |
| long-form words: `Hi-Hat |`, `Snare |`, `Bass Drum |` | | occasional |
| tab-character between label and line | | occasional (pasted from some editors) |
| labels only in the first system; later systems unlabelled | | occasional |

Aered's importer requires the label to start before the 5th character and uses `|` to delimit bars; treat that as the strictest reasonable baseline [11].

---

## 2. Hit characters

### 2.1 Meaning by character

The same character means different things depending on the line. A character mapping must therefore be per instrument family.

| Char | Hat line | Snare / drum line | Cymbal (crash, ride) line | Kick line | How common | Sources |
|---|---|---|---|---|---|---|
| `x` | closed hit | hit (some authors use x for all lines) | hit | hit (some authors) | very common on hat/cymbals; common elsewhere | [3][4][6][8][11] |
| `X` | accented closed, or "loose" (half-open) hat | accent | accent / hard hit | accent | common | [3][11] |
| `o` | open hat | normal hit | rare | normal hit | very common on drums; common (ambiguous) on hats | [3][4][8][11] |
| `O` | accented open hat | accent | | accent | common | [3][11] |
| `+` | closed hat (paired with `o` for open), or foot-closed | | | | occasional | est. |
| `@` | | rimshot / rim | | | occasional | [3] |
| `g` | | ghost note | ghost (rare) | | very common for ghost | [3][11] |
| `(o)` or `(x)` or `(g)` | ghost (parenthesised; spans 3 chars and shifts alignment) | ghost | | | occasional | est. + standard-notation convention |
| `f` | flam | flam | flam | | common | [3][11] |
| `d` | drag | drag | | | occasional | [3][11] |
| `b` | | soft one-handed roll [3] / double buzz [11]; or "both" | ride bell (`b`, [3]) | | occasional, conflicting meanings | [3][11] |
| `B` | | accented roll [3] | ride bell [11] | | rare | |
| `r` | roll (rare) | ruff / roll [11] | | | rare | [11] |
| `s` | splash | | splash [3][11] | | occasional | |
| `c` | | | china [3] / cowbell on percussion line [11] | | occasional | |
| `C` | | | accented china [11] (ambiguous) | | rare | |
| `#` | choke | choke | choke [3] | | occasional | [3] |
| `*` | accent or open (varies) | accent | crash marker | | occasional | est. |
| `>` | accent mark (often on its own line above) | accent | | | occasional | [one how-to guide says `>` means ghost; that is almost certainly wrong, treat as accent] |
| `^` | accent | accent | | | rare | est. |
| `1`-`9` | rare | hit count (flam/roll) or tom number | | | rare | est. |
| `\` after `f` | flam notation `f\` | | | | rare | [6] |
| `-` | rest | rest | rest | rest | universal | all |
| `.` | rest | rest | rest | rest | occasional | est. |
| ` ` (space) | rest (when line is not dash-filled) | | | | occasional | est. |
| `_` or `~` | rest or tie/sustain | | | | rare | est. |
| `\|` | bar line | | | | universal | all |
| `:` | inside `\|:` / `:\|` repeat marker | | | | occasional | est. |
| A letter equal to the label (e.g. `S` on the S line, `K` on kick) | hit | hit | hit | hit | occasional ("some writers put the drum's abbreviation in place of a symbol", [5]) | [5] |

Notes:
- Capital letter = accent is the most common dynamic convention (x/X, o/O) [3][7][11].
- Open vs closed hat is the biggest per-tab variance. "x closed, o open" is the dominant reading [3][7][11]. Some tabs use `x` for all hat hits and mark opens with `o` on a separate `OH` line, or with `+` closed / `o` open.
- Per-line resolution rule: on a hat line, if the line contains both `x` and `o`, then `o` is open. If the line contains only `o` (and no `x`/`X`), the author is using `o` as the generic hit; treat as closed. If the line contains `X` and `x`, `X` is accent.

### 2.2 Mapping to Beatboy sounds (proposed)

Beatboy has: kick, snare, sidestick, clap, hatClosed, hatPedal, hatOpen, ride, rideBell, crash, crash2, tomHigh, tomMid, tomFloor, tambourine, cowbell. One sample each; velocities ghost / normal / accent.

| Label family | Hit char | Beatboy sound | Velocity |
|---|---|---|---|
| kick | `o x X O` and abbreviation letter | kick | lowercase normal, uppercase accent, `g` ghost |
| snare | `o x O X` | snare | normal / accent |
| snare | `g`, `(o)`, `(x)` | snare | ghost |
| snare | `@`, rim words | sidestick | normal |
| snare | `f` | snare (flam collapsed to one hit, warn) | normal |
| snare | `d`, `r`, `b` | snare, one hit, warn "roll/drag simplified" | normal |
| hat | `x`, `+` | hatClosed | normal |
| hat | `X` | hatClosed | accent |
| hat | `o`, `O` (when `x` present on same line or legend says open) | hatOpen | normal / accent |
| hat | `g` | hatClosed | ghost |
| hat | `#` | hatClosed (choke) | normal |
| hat foot | any hit | hatPedal | normal |
| ride | `x`, `o`, `X` | ride | normal / accent |
| ride | `b`, `B` | rideBell | normal / accent |
| crash | any hit | crash | normal / accent for `X`,`O` |
| crash 2 / `C2` / china / splash | any hit | crash2 | |
| tom lines | any hit | tomHigh / tomMid / tomFloor per 1.2 | |
| cowbell, tambourine lines | any hit | cowbell / tambourine | |
| `Cl` / clap | any hit | clap | |

Unmappable chars (digits, `?`, unknown letters) on a recognised line: treat as a normal hit if alphanumeric and warn once per tab; treat as rest if punctuation.

---

## 3. Timing and grid

### 3.1 Resolution (characters per beat)

| Layout | Chars per bar in 4/4 | How common | Notes |
|---|---|---|---|
| 16ths (one char = 1/16) | 16 | very common; the standard guide says "most tabs use 4/4 with 16 positions per bar" [5] | counted `1 e & a 2 e & a ...` |
| 8ths | 8 | common, especially simple rock tabs and tabs using `1 + 2 + 3 + 4 +` [3][4] | |
| 32nds | 32 | occasional (fast double-bass, fills, metal) | Aered table lists 32 and 64 [11] |
| 16ths written with a space between each (`x - x - ...`) | 32 characters but 16 steps | common in some archives (est.) | must detect space-separated grids |
| 16ths in two half-bars separated by `\|` or `\|\|` | e.g. `\|x-x-x-x-\|\|x-x-x-x-\|` for one bar | common: a `\|\|` or `\|` per beat/half-bar inside one real bar [6] | see 3.4 |
| Triplet 8ths (12 per 4/4 bar, or 3 per beat) | 12 | occasional | |
| 12/8 or 6/8 | 12 or 6 (8ths), 24 or 12 (16ths) | occasional | |
| Quarter notes | 4 | rare | |
| Mixed resolutions inside one tab | | occasional; common in fills | |

Aered's inference table gives a useful baseline: bar widths 2, 3, 4 = quarter notes; 6, 9, 12 = quarter-triplets in 2/4, 3/4, 4/4; 8/16/32/64 = 4/4; 14, 28, 36, 44, 52 = odd meters (7/4, 7/4, 9/4, 11/4, 13/4); 15, 18, 27 = triplets (5/4, 6/4, 9/4); 20, 24, 40 = 16ths (5/4, 6/4, 10/4) [11]. Bars of unlisted length are left blank there; Beatboy should do better.

### 3.2 Count lines

| Form | Example | How common | Meaning |
|---|---|---|---|
| 16th count | `1 e & a 2 e & a 3 e & a 4 e & a` (also `1 e + a`, `1 e n a`, `1 e and a`) | very common | 4 chars per beat |
| 8th count | `1 + 2 + 3 + 4 +`, `1 & 2 & 3 & 4 &` | very common | 2 chars per beat |
| Parenthesised count under each group | `(1 + 2 + 3 + 4 + )` [6][12] | occasional | |
| Triplet counts | `1 trip let 2 trip let`, `1 & a 2 & a`, `1 tl & ...` | occasional; the `tl` notation is accepted by Aered [11] | 3 chars per beat |
| Counting by sixteenth numbers `1 2 3 4 5 ... 16` | | rare | |
| Count only above the tab, or only on first system | | common | |
| Count with irregular spacing, not aligned to grid | | common (broken) | |
| Mixed markers inside one tab | `+`, `e`, `a`, `tl` mixed [12] | occasional | |

Count lines are a hint, never ground truth. Their character set is `0-9 e & a + n d t l r i p` and spaces; they contain no `x`, `o`, `-`, `|`.

### 3.3 Time signature and tempo

- Time signatures: `4/4`, `6/8`, `12/8`, `3/4`, `5/4`, `7/8`, `9/8` written in prose before a section or in a header [12]. Occasionally in parentheses after a section name.
- Tempo: `Tempo: 120`, `BPM 96`, `bpm=100`, `q=120`, `♩=120`, `120 bpm`, `Tempo: ~ 90`. Aered documents `Tempo` as a header key and `Song`, `Band`, `Album` [11]. Tempo is very commonly absent.
- Bars with 12, 24, or 6 chars are very likely triplet/shuffle or 12/8; it is wrong to assume 4/4 with 16ths.

### 3.4 Bar lines and bars of unequal width

| Variant | How common | Parser reading |
|---|---|---|
| `\|` at start and end of each line, `\|` between bars | very common | bars |
| `\|\|` doubled bar line after each group of 4 or 8 chars (beat or half-bar groups) | common [6] | See below |
| trailing `\|\|` or `\|\|\|` at the very end only (section end) | common | end of system |
| missing leading `\|` | common | line starts right after label |
| missing trailing `\|` | common | |
| no bar lines at all, just dashes | occasional | split by detected resolution or system width |
| bar lines misaligned between lines (one line shorter or longer) | common | see 5 |
| bars of different length in the same system (e.g. a 16-char bar then a 12-char bar) | occasional; intentional in odd-meter tabs [12] | per-bar grid |
| bar written as two 8-char halves joined by `\|` | common | ambiguity with 8-step bars |

Ambiguity: `|x-x-|x-x-|x-x-|x-x-|` is either four 4-step bars (4/4 of quarter notes, rare) or one 16-step bar written as four beat groups (very common). Recommended rule: group consecutive bar-line-delimited cells into a "bar" until the sum reaches 8, 12, 16, 24 or 32 steps, preferring 16. Use the count line, system length, and repetition across systems to confirm. Use `||` as a stronger separator than `|` when both occur in one line (if `||` occurs at regular intervals, `||` is the true bar line and `|` is beat grouping).

### 3.5 Repeat notation

| Variant | Example | How common | Sources |
|---|---|---|---|
| `x2`, `x4` after the system or section header | `Chorus x2`, `(x4)`, `[x4]` | very common | [5][6][11] |
| `2x`, `4x`, `repeat 4 times`, `play 4x`, `repeat x7`, `Repeat 5x` | | very common | [5][6][11] |
| Repeat count in a line above the staff with bracket `\|--- 4x ---\|` aligned to bar lines | | occasional; formal in Aered [6][11] | [6][11] |
| `\|: ... :\|` or `\|\|: ... :\|\|` repeat signs | | occasional (est.) | |
| `:x4`, `: x4` | | occasional | e-chords search snippet |
| Repeat count placed after the last bar: `\|x-x-\| x4` | | common | |
| "Same as above", "(repeat)", "as before", "ditto", "same as verse" | | common | est. |
| `1.` / `2.` first and second endings above the staff | | rare; documented in Aered [11] | [11] |
| `play 2x` as a free-text note, with the bars duplicated in the paste instead | | occasional | [12] |
| Number only: `x 2`, `X2`, `X 2` | | common | |
| Nested repeats | | rare | |
| "D.C.", "D.S.", "Coda" | | rare | est. |

Semantic trap: `x4` normally means play 4 times total, not 4 additional times ("Repeat 5x" = 6 plays in Aered's reading? Aered says "Repeat 5x", "Play 6x", "x6" all mean played six times total [11]; the how-to guide says `repeat x7` means 7 plays [5]). Conclusion: take N as the total plays, with `repeat 1x` (seen in [5] for a single play) as a warning that a few authors mean extra repeats. Treat "repeat N" as total N unless N is 1.

---

## 4. Layout

### 4.1 Systems

A *system* is a block of consecutive instrument lines. Typically 3 to 8 lines, from top to bottom ordered by height: crash, ride, hat, hat-foot, toms high to low, snare, kick. Order is not guaranteed [8]. A tab usually contains many systems separated by a blank line or by a count line.

| Layout feature | How common |
|---|---|
| Blank line between systems | very common |
| Section header line before the system (see 4.2) | very common |
| Count line directly under the system (included in block) | common |
| Count line above | occasional |
| Repeat line above (bracket) | occasional |
| Different instrument sets per system (rows omitted if unused) [6] | common |
| Lines for the same system wrapped across two text blocks when the text width is narrow (continuation) | occasional; common when pasted from mobile or narrow forums |
| System with only some labelled lines; the rest follow the same order | occasional |
| Systems with different row order | rare |
| Several bars per system | very common (2 to 4) |
| One bar per system | common |
| Many bars (8+) per line, extremely wide | occasional |
| Fill system appended to a groove system with `\|` joining | occasional |

### 4.2 Section headers

Observed: `INTRO`, `VERSE 1`, `PRE VERSE`, `CHORUS 1`, `BRIDGE 1`, `GUITAR SOLO 1`, `OUTRO` [6]; also `Verse`, `Pre-Chorus`, `Chorus`, `Solo`, `Fill`, `Breakdown`, `Interlude`, `Main riff`, `Ending`, `Part A`, `[Verse]`, `[Chorus 2]`, `--- Verse ---`, `*** Chorus ***`, `Verse (0:23)`, `Chorus - 1:12`, `Intro (only guitar and bass until 0:29)` [12], `Fill (bar 8)`, lyric cues in quotation marks [6]. Performance notes in parentheses. Meter noted in header, e.g. `(5/8 and 7/8)` [12].

Detection: a non-tab line (not matching an instrument line pattern) of short length (under ~50 chars) that sits immediately before a system and contains one of a keyword list, optionally followed by a number/letter, optional `x4`, optional timestamp. Case-insensitive; surrounding `[]`, `()`, `-`, `*`, `=`, `:` stripped.

### 4.3 Non-tab content interleaved

| Content | How common | Handling |
|---|---|---|
| Song/artist/tabber header block (`Band:`, `Song:`, `Album:`, `Drummer:`, `Tabbed by:`) | very common [6] | read tempo if present; rest ignored |
| Numbered notes list | occasional [6] | ignore |
| Lyrics lines between systems | occasional | ignore |
| Guitar chord names above systems | rare | ignore |
| Dynamics brackets `/-- Crescendo --\` [6] | occasional | ignore |
| Trailing comments after a line (`HH\|x-x-\| <- open on the and`) | occasional | strip anything after the last `\|`, warn |
| "Tabbed by", copyright, URLs | common | ignore |
| Web site chrome pasted along (breadcrumbs, "Rating", "Highlighted", "Chords") [12] | common when pasted from sites | ignore |
| Timestamps `[0:23]`, `(1:05)` | occasional | store as section hint only |
| Leading line numbers on each line (`1:`, `12 `, `03\|`) | occasional (editor/forum pastes) | strip if a consistent leading number column appears on all tab lines |
| Reply quoting (`> `) | rare | strip common prefix |

### 4.4 Legend / key blocks

Format: a block before the first system listing symbols. Observed forms: `x = closed hi-hat`, `o = open hi-hat`, `X = accent`, `g = ghost`, `f = flam`, `# = choke` [3][6]; label table: `CC = crash`, `HH = hi-hat`, `Hf = hi-hat foot`, `T2 = or floor tom 1` [6]; long alias lines. Separators: `=`, `-`, `:`, `->`, `...`. Several entries on one line separated by `,` or `;` or wide spaces.

Legend parsing is high-value and high-risk: legends can contradict the default reading (hat `HH`=open [2]; `x` used twice [3][6]; `S` splash [12]). Rule: a legend line matches `^\s*(\S{1,3})\s*(=|:|-|->)\s*(.+)$` and the right-hand side contains an instrument word. When a legend and the default disagree, the legend wins for that character/label only, and a warning is emitted. Never apply a legend learnt from a different paste.

### 4.5 Whitespace, encoding, copy-paste artefacts

| Artefact | How common | Handling |
|---|---|---|
| Windows `\r\n`, lone `\r` | common in old `.txt` archives | normalise |
| Tab characters instead of spaces | occasional | expand to 4 (or to 8 if the file looks like OLGA-era); if tabs fall inside the grid, warn |
| Non-breaking space `U+00A0`, zero-width chars | common from web copy | convert to space / delete |
| Unicode dashes `–` `—` `−` `‑` `─` `━` `_` in place of `-` | occasional (word processors, mobile keyboards) | treat as rest |
| Box-drawing bars `│` `┃` `¦` `︱` `｜` (fullwidth) in place of `\|` | occasional | normalise to `\|` |
| Smart quotes, `…` in notes | common | ignore |
| Fullwidth letters in labels | rare | NFKC normalise |
| Proportional font paste loses alignment (misaligned columns) | common | rely on token order not column position where possible |
| Trailing whitespace | common | trim |
| Markdown or BBCode wrappers (`[code]`, `[tab]`, backticks) | common from forums | strip |
| HTML entities (`&gt;`, `&amp;`) | occasional | decode |
| Hard-wrapped systems (line wraps at 60-80 columns mid-bar) | occasional | see 5.5 |
| Very long unwrapped lines | occasional | fine |
| BOM | rare | strip |

---

## 5. Common breakage

| Breakage | Frequency | Recommended handling |
|---|---|---|
| One line a character shorter/longer than others in the system | very common | Use bar-line column positions as primary alignment; if bar lines disagree, align by right edge or left edge against the majority of lines; pad with rests; warn with the line label |
| Bar lines not vertically aligned between rows | very common [6][11][12] | align by bar index (the n-th bar of each line) not by column |
| Row has different bar count than others | common | pad/trim to the majority; warn |
| Missing label on some lines | common | infer from position and previous system; if impossible, skip line and warn |
| Label column width varies (`HH \|` vs `HH\|` vs ` S\|`) | very common | label = text before first `\|`; hit grid begins after it; never use fixed column |
| Label letter-case or aliases change between systems (`FT` vs `F1/F2` [6]) | occasional | resolve per system; carry forward within section |
| Row sets differ by system (row omitted, e.g. T1 in some sections only [6]) | common | each system independent |
| Stray characters (`?`, `*`, `~`, `.`, `;`) inside a grid | common | treat as rest or hit per 2.2, warn |
| Bar length does not match the stated time signature / header [12] | occasional | trust the grid, ignore the claim, warn |
| Mixed resolutions: line with 16 steps beside a 12-step line | occasional | scale to LCM grid; if not integer-compatible, warn and quantise |
| Grid lines contain spaces between steps (`x - x -`) | common in some archives | detect: strip spaces if more than 40% of odd-position chars are spaces |
| Two instruments hit on one cell written `xo` or `x/o` | rare | split into two hits, warn |
| Hit char followed by modifier (`o>`, `x'`) | rare | consume modifier as accent |
| Typos (`l` for `1`, `O` for `0` in counts) | occasional | tolerate in count lines |
| Whole row is pasted twice | rare | dedupe identical consecutive rows |
| Duplicate/partial system | occasional | treat as separate systems |
| Fill / ad-lib in prose ("then fill on toms") | common | ignore, warn |
| Non-drum tab pasted in (guitar tab with numbers on `e B G D A E`) | occasional | detect via labels `e B G D A E` and digits; reject with message |
| Tabs wrapped by a narrow display (system split across two blocks) | occasional | see 5.5 |
| Copyright footer / ads in the middle | common | ignore |

### 5.5 Wrapped systems

If two successive blocks have the same label set in the same order and the first block's rows lack a trailing `\|` (or the last bar is shorter than its siblings), concatenate row by row. Otherwise treat blocks as separate systems.

---

## 6. Guitar Pro / Songsterr / TuxGuitar / editor exports

What could be verified:

- Guitar Pro 8 exports the active track via File > Export > ASCII. The docs say it suits single tracks, mention percussion in general terms, and list a symbol table made mostly of guitar techniques; they say nothing drum-specific [14]. Guitar Pro can also import ASCII where lines are built from dashes [15].
- TuxGuitar can export plain-text tabs (listed as export-only, ASCII `.txt`) [16]. How it renders drum tracks could not be confirmed.
- Songsterr: no text copy for drums found; people download a Guitar Pro file and re-export [15].
- DrumBurp (free open-source drum tab editor) exports ASCII; its exact output format could not be confirmed from the pages reachable [17]. Expect its output to be well-formed (fixed labels, aligned bars), as it generates text from structured data.
- TablEdit has an 8-line layout (`CC RC HH T1 T2 SD T3 BD`) and a 5-line layout (`C H T S B`) [13] but, per search results, no ASCII drum import because there is no percussion-tab standard.
- Aered documents one strict import convention for drum ASCII [11]. It is the best published spec of a "well-formed" dialect and is worth using as the canonical ("clean") form.
- MIDI::Tab (Perl) parses drum ASCII, one line per drum part with a short code (`HH`, `BD`, `SD`, `CYM`) [18]; `cluesurf/beat` and `drumtabconv` are other small projects of this type [18]. Not examined in depth.

Practical consequence: the generated-by-software ASCII is the easy end of the corpus: regular label width, uniform bar width, labels from a fixed set, `x`/`o`/`X`. Hand-typed archive tabs are the hard end. Because we could not obtain a real Guitar Pro or TuxGuitar drum export, the fixture plan includes a "synthetic editor export" fixture the team should replace with a real export once someone generates one from a self-made score.

---

## 7. Parser strategy

Pipeline: normalise, classify lines, group systems, align bars, infer grid, map hits, expand repeats, split sections, dedupe, score.

### 7.1 Normalisation
1. Decode HTML entities, strip BOM, markdown/BBCode wrappers, NFKC fold fullwidth chars.
2. Convert `\r\n`/`\r` to `\n`; expand tabs.
3. Map Unicode dashes to `-`, box-drawing/fullwidth bars to `|`, NBSP/zero-width to space or nothing.
4. Strip leading line-number column if it appears on at least 80% of non-empty lines and is monotonic.
5. Strip common quoting prefix (`> `).
6. Trim trailing whitespace. Keep original line numbers for warnings.

### 7.2 Line classification
For each line decide: `tab-row`, `count-row`, `repeat-row`, `header`, `legend`, `text`, `blank`.

`tab-row` test (tolerant):
- Optional label: `^\s*([A-Za-z][A-Za-z0-9]{0,3}|[A-Za-z][A-Za-z\- ]{2,12})\s*[|:]?` followed by a body.
- Body (after label) has at least 4 characters from the grid alphabet `[-xXoO@gGfFdDbBrRcCsS#*+.()>^ _|:~0-9]` and at least 60% of the body characters are `-` or `|` or hit chars, and it contains at least one `|` or at least 6 consecutive grid characters.
- Reject if the label looks like a guitar string (`e B G D A E` with digits in the body) or if the body contains words.
- Accept lines that lack a label only if they sit inside a system whose neighbours are `tab-row`s (infer label by row index).

`count-row`: body chars are digits, `e & a + n d t l` and spaces with at least 4 digit tokens or 4 `+/&` tokens, and no `x o -` runs.
`repeat-row`: matches `x\s*\d+|\d+\s*x|repeat|play` possibly with `|` and `-`; or lies directly above a system.
`header`: see 4.2. `legend`: see 4.4.

### 7.3 System grouping
A system is a maximal run of consecutive `tab-row` lines (allow at most one interleaved count-row or comment line). A blank line ends a system unless the next block has the same labels and the previous block's rows were un-terminated (wrapped, 5.5). Attach the nearest preceding header to the system; attach `count-row` and `repeat-row` found directly above or below.

### 7.4 Bar alignment
1. For each row, split the body on `|` (and `||`). Keep empty segments at the ends as boundaries, not bars.
2. If every row has the same number of bars, align by bar index.
3. Otherwise compute the bar-line column sets; use the row with the most bars as reference; match other rows' bar lines by nearest column (tolerance of 2); rows that still disagree: align by bar index and pad/truncate to the median bar length, with a warning.
4. If no bar lines at all: if row lengths differ by at most 2, treat as one bar per row-length class split by detected resolution (16/12/8/32); otherwise single bar.
5. Pad short rows with rests at the end.
6. Merge beat groups into bars per 3.4 (target 8/12/16/24/32 steps, prefer 16; `||` stronger than `|`).

### 7.5 Grid inference
Step count of a bar N → candidates:

| N | Default reading | Override by |
|---|---|---|
| 4 | 4/4 quarters (or 1 bar of 8ths when joined) | count line |
| 6 | 2 beats of triplet 8ths (or 6/8) | count line |
| 8 | 4/4 8ths | count line `1 e & a` implies 16ths half-bar |
| 12 | 4/4 triplet 8ths (shuffle) or 12/8 | header says 12/8 or 6/8 means 4 groups of 3 |
| 16 | 4/4 16ths | count line |
| 24 | 4/4 triplet 16ths, or 12/8 with 16ths | header |
| 32 | 4/4 32nds (play at 2x grid) | count line |
| 10, 14, 15, 18, 20, 28 and others | odd meter, Aered table [11]: 14 = 7/4 8ths or 7/8 16ths, 20 = 5/4 16ths, 15 = 5/4 triplets | header, otherwise warn and take N steps of 16th each |
| Not in table | 16ths (N steps), warn "odd bar length" | |

Count line wins when present and consistent: tokens per beat = chars per beat (2, 3, 4, 6). Space-separated grids: collapse first. Mixed resolutions across bars: keep each bar's own resolution; Beatboy must be able to take a bar with a per-bar step count, or the parser resamples all bars to a common LCM grid (for example 48 steps per bar covers 8ths, 16ths, triplets) and then reports the grid as "simplified" if it cannot be expressed. Decision for the app, not this document.

Tempo: use header if present, otherwise leave unset (UI default 100 or 120) and warn.

### 7.6 Instrument and hit mapping
1. Resolve the label to a family (1.2); legend overrides.
2. Per row, derive the hat/cymbal reading from the row's character population (2.1 notes).
3. Map each non-rest cell to (sound, velocity) per 2.2. Parenthesised ghosts `(o)` are pre-collapsed to a single ghost cell before alignment (replace `(o)` with `g` plus two placeholder rests removed, i.e. remove the parens and mark the cell ghost) because the parens otherwise shift columns.
4. Simultaneous hits across rows in the same column become one step with several sounds.
5. Multiple rows resolving to the same sound (two kick rows `B`,`B2`): merge.
6. Beatboy has no splash/china/ride-foot: map to crash2 / crash and note.

### 7.7 Repeat expansion
1. Parse repeat markers from the repeat line, the header suffix, or a trailing `xN` after the last bar.
2. A repeat attached to a system repeats that system; attached to a header repeats the whole section; attached to a bar bracket repeats only the bracketed bars.
3. `|: :|` repeats the enclosed bars. First/second endings `1.` / `2.`: play bars under `1.` on the first pass and `2.` on the second.
4. Total plays = N (see 3.5 caveat). Cap expansion at a sane maximum (for example 32 plays or 256 bars) and warn.
5. "Same as above" phrases: duplicate previous system (warn).

### 7.8 Sections
Each header starts a section. Systems with no header before the first header go into "Main". Section type from keyword list (intro, verse, pre-chorus, chorus, bridge, solo, outro, fill, breakdown, interlude); number suffix kept as a label (Verse 2). If no headers at all: one section per run of systems; split at a change of groove only if the user asks. Timestamps are kept as metadata, not timing.

### 7.9 Dedupe into grooves
After expansion, hash each bar's normalised content (sound x step x velocity at the bar's resolution). Identical bars map to one groove (pattern); a section becomes an ordered list of groove ids with repeat counts. Two bars equal except for the last 1 to 2 steps get flagged as "fill variant of groove X" (offer a separate groove, not a merge). Runs of the same groove are run-length encoded into `groove x N`.

### 7.10 Confidence and warnings
Per tab produce a score from 0 to 1 and a warning list. Suggested deductions: unresolved label (-0.15 each), legend conflict (-0.05), bars padded or truncated (-0.05 each, capped), odd bar length (-0.05), unmapped hit char (-0.02), resolution guessed with no count line and ambiguous N (-0.1), no tempo (-0.02), repeat assumption (-0.03), non-drum content rejected. Offer the UI three outcomes: import (score 0.8 and up), import with review banner (0.5 to 0.8), show the parsed grid for manual fix (below 0.5). Every warning carries the source line number so the UI can highlight it.

Never throw on bad input: the worst case is an empty result plus "no drum tab found".

---

## 8. Fixture plan

Fixture format suggestion: `fixtures/tabs/NN-name.txt` plus `NN-name.expected.json` (sections, grooves, steps, warnings). Each fixture is 1 to 4 systems, written by us. Short illustrative snippets are inline where useful.

### Clean and well-formed
1. **01-basic-rock-16th**: HH/SD/BD, 16 chars per bar, `|` at both ends, 1e&a count line. Expected: one groove, 8th-note hats on... (hat on every second step), snare on beats 2 and 4, kick on 1 and 3.
   ```
   HH|x-x-x-x-x-x-x-x-|
   SD|----o-------o---|
   BD|o-------o-------|
   ```
2. **02-basic-rock-8th**: same beat at 8 chars per bar with `1 + 2 + 3 + 4 +` count. Expected: same pattern as 01 (resolution-independent).
3. **03-aered-canonical**: strict Aered-style: header (Song/Tempo), `|` aligned, repeat bracket `|- x4 -|`, `S/B/H/C/Hf` labels. Expected: tempo read, 4 repeats expanded.
4. **04-editor-export-synthetic**: software-generated style with long labels (`Crash`, `Hi-Hat`, `Snare`, `Bass Drum`), aligned bars, 4 bars per system. Expected: all long names resolved.
5. **05-five-line-tab**: `C H T S B` labels only. Expected: C=crash, H=hat, T=tomMid, S=snare, B=kick.
6. **06-eight-line-tablelike**: `CC RC HH T1 T2 SD T3 BD`. Expected: tomHigh/tomMid/tomFloor mapping, ride vs crash separated.

### Label and character variants
7. **07-label-case-and-width**: `hh|`, ` S|`, `Bd |`, `SN:` mixed within one system. Expected: all four recognised, grid starts after the label punctuation.
8. **08-open-closed-hat**: `x` closed, `o` open on the HH line, `X` accented. Expected: hatClosed/hatOpen/accent velocities.
9. **09-o-as-generic-hit-on-hat**: HH line only uses `o` (no `x`). Expected: hatClosed, with a low-severity warning.
10. **10-ghost-g-and-accent**: snare with `g` ghosts and `O` accents. Expected: ghost, accent velocities.
11. **11-ghost-parens**: snare with `(o)` ghosts, which shifts alignment against other rows. Expected: ghost notes at the right steps; no misalignment warning beyond info.
12. **12-flam-drag-roll**: snare `f`, `d`, `b`, `r`. Expected: single snare hits, "simplified" warning.
13. **13-cymbal-zoo**: lines `CC`, `C2`, `Ch`, `Sp`, `Rd` with `x`, `X`, `#`, `s`, `c`, `b` (ride bell). Expected: crash, crash2 for china/splash, rideBell for `b`, choke treated as normal hit.
14. **14-foot-hat**: `HH` plus `Hf` rows (and a variant with `F` that is really a floor tom, using a legend). Expected: hatPedal vs tomFloor decided by legend.
15. **15-ambiguous-F-and-C**: tab with `F` and `C` and no legend and a separate `FT`. Expected: F is a foot, per the rule in 1.2, with a warning. (Decide the rule, then lock it.)
16. **16-tom-fill-systems**: fill system with T1/T2/FT rows only (rows omitted). Expected: tom lines mapped, missing rows fine.
17. **17-letter-as-hit**: hits written as the label letter (`S`, `K`, `H` on their own rows). Expected: hits recognised.
18. **18-legend-overrides**: legend says `o = closed hat, x = open hat` (inverse of default), and `HH = open hi-hat`. Expected: legend respected, conflict warning.
19. **19-clap-cowbell-tamb**: `Cb`, `Ta`, `Cl` rows. Expected: cowbell, tambourine, clap.

### Timing and grid
20. **20-32nd-fill**: 32-char bar of double kick. Expected: 32nds; either accepted or flagged "dense grid".
21. **21-triplet-shuffle-12**: 12-char bars with `1 trip let 2 trip let ...` count line. Expected: triplet grid, shuffle feel.
22. **22-12-8-slow-blues**: header `12/8`, 12 chars per bar plus 24-char variant. Expected: 12/8 groups of 3.
23. **23-odd-meter-7-8**: header `7/8`, bars of 14 chars and a `5/4` bar of 20 chars. Expected: odd meter honoured; bar lengths differ per bar.
24. **24-beat-grouped-bars**: one 16-step bar written as `|x-x-|x-x-|x---|x-x-|` and `||` every 8 chars. Expected: a single bar of 16 steps, not four 4-step bars.
25. **25-space-separated-grid**: `x - x - x - x - ...` style. Expected: spaces collapsed, 16 steps.
26. **26-no-bar-lines**: dashes and hits only, no `|`. Expected: bars from detected resolution, warning.
27. **27-mixed-resolution**: one bar at 8th resolution then a fill at 16ths, plus a 12-step triplet bar. Expected: per-bar grids or resampled, warned.

### Repeats, sections, layout
28. **28-repeat-variants**: one tab with `x4` after header, `(x2)` after system, `repeat 3 times` and `|: :|`. Expected: totals 4, 2, 3, and loop repeat.
29. **29-repeat-bracket-and-endings**: bracket repeat line aligned to bars with first and second endings `1.` `2.`. Expected: ending 1 on pass one, ending 2 on pass two.
30. **30-same-as-above**: section header "Chorus (same as verse)". Expected: duplicates the verse system with warning.
31. **31-sections-timestamps**: headers `[Intro]`, `Verse 1 (0:23)`, `Pre-Chorus`, `Chorus x2`, `Solo`, `Outro`; lyrics between systems; tempo `q=96`. Expected: 6 sections, tempo 96, lyrics ignored.
32. **32-legend-header-block**: top metadata (`Band/Song/Tabbed by`), legend of `x = ...` lines, numbered notes, trailing copyright text. Expected: legend parsed, metadata ignored.
33. **33-wrapped-systems**: each system hard-wrapped at ~40 columns with the second half starting below. Expected: halves rejoined into one bar run.

### Breakage and encoding
34. **34-misaligned-lines**: one row a char short, another a char long, bar lines off by one column. Expected: bars aligned by index, rows padded, warnings naming the line.
35. **35-missing-labels-and-bars**: some rows lack a label, some lack leading or trailing `|`. Expected: labels inferred from row order where possible, others dropped with warning.
36. **36-unicode-and-crlf**: CRLF line endings, `–` and `—` dashes, `│` bars, NBSP, BOM, tab characters between label and grid. Expected: identical result to a clean ASCII version.
37. **37-forum-paste-noise**: BBCode `[code]` wrappers, `> ` quote prefix, leading line numbers (`01`, `02`), inline trailing comments after bars. Expected: noise stripped, comments ignored.
38. **38-stray-characters**: grids with `?`, `~`, `.` and `*`. Expected: `.` as rest, others per mapping with warnings.
39. **39-guitar-tab-pasted**: ordinary 6-string guitar tab with fret numbers. Expected: rejected, "not a drum tab".
40. **40-two-tabs-one-paste**: two different songs separated by headers with different label sets and resolutions. Expected: either two songs or one song with two section groups; decide behaviour, then lock.

Each fixture's `expected.json` should include the confidence band (clean at 0.9 and up, noisy at 0.5 to 0.8, rejected below 0.5), so the scoring in 7.10 is regression-tested too.

---

## 9. References

Consulted (some only via search snippets as marked; none reproduced):

1. Wikipedia, Drum tablature: https://en.wikipedia.org/wiki/Drum_tablature
2. Wikibooks, Tablature/Drums (undeveloped draft; legend with `HH` = open, `HF` = closed): https://en.wikibooks.org/wiki/Tablature/Drums
3. Wikipedia mirror of the drum tab symbol table (labels CC HH Rd SN T1 T2 FT BD Hf; symbols x X o # s c b O g f d @): https://en.wikipedia.org/wiki/Drum_tablature (same text as [1]; see also https://Www.wikipedia.org/wiki/Drum_tab)
4. Tigerbill, drum tabs primer: https://tigerbill.com/drumtabs.htm
5. Electronic Drum Advisor, How to Read Drum Tabs: https://www.electronicdrumadvisor.com/?p=4096
6. A guitartabs.cc drum tab page (formatting study only: legend, `||` per beat, `4x` brackets, misaligned rows, F1/F2 vs FT): https://www.guitartabs.cc/tabs/a/ac_dc/riff_raff_drum.html
7. Drum Center NH, How to read drum tabs quickly: https://drumcenternh.com/blogs/news/how-to-read-drum-tabs-quickly-a-beginners-guide
8. TablEdit help, drum tabs (5-line and 8-line layouts): https://tabledit.com/help/english/drum_tabs.shtml
9. ProducerHive, How to read drum notation/tabs: https://producerhive.com/?p=41982
10. WikiHow mirror, Read Drum Tabs (fetch failed; search snippet only): https://wiki.gameproshop.net/content/wikihow_en_maxi_2023-03/Read-Drum-Tabs
11. Aerodrums Aered tab import syntax (best published spec of a strict dialect): https://aerodrums.com/aered/aered-tab-import-syntax
12. A guitartabs.cc drum tab for an odd-meter song (formatting study only: mixed meters, `tl` counts, mismatched bar lengths, mixed count markers): https://www.guitartabs.cc/tabs/t/tool/schism_drum.html
13. TablEdit help, drum tabs (same as [8]): https://tabledit.com/help/english/drum_tabs.shtml
14. Guitar Pro 8, Exporting ASCII: https://www.guitar-pro.com/docs/gp8/import-export/export/export-ascii
15. Customsforge / Guitar Pro ASCII import discussion (search snippets only): https://customsforge.com/topic/49425-is-it-possible-to-export-just-the-drum-track-of-a-song-to-my-pc and https://forum.singularsound.com/t/can-i-export-drum-midi-files-from-songsterr-to-bb-software/264
16. Wikipedia, TuxGuitar (ASCII export listed): https://en.wikipedia.org/wiki/TuxGuitar
17. DrumBurp: https://github.com/lsrzj/DrumBurp
18. Related parsers (not examined in depth): https://web.do.metacpan.org/pod/MIDI::Tab , https://github.com/cluesurf/beat , https://sourceforge.net/projects/drumtabconv/
19. Wikipedia, ASCII tab (no strict standard; barlines, rhythm, lyrics unpredictable): https://en.wikipedia.org/wiki/ASCII_tab
20. Soundslice drum tab help (MIDI-number tab, not ASCII; confirms the sound list): https://www.soundslice.com/help/en/creating/tablature/75/drum-tab/
21. Wikibooks Learn to Play Drums, drum tabs: https://en.wikibooks.org/wiki/Learn_to_Play_Drums/Starting_Out/Reading_Sheet_Music
22. Percussion Deconstruction, The Myth of Drum Tab (standard notation vs tab): https://percussiondeconstruction.blogspot.com/2013/08/the-myth-of-drum-tab.html
23. h2g2, Drum Tablatures (fetch blocked, search listing only): https://h2g2.com/entry/A2981216
24. e-chords drum tabs (fetch blocked; search listing showed `:x4`, `HH Sd Bd Cc` labels): https://www.e-chords.com/drums/nirvana/aneurysm
25. Ultimate Guitar drum tab page (body not retrievable; search listing showed a legend and `Chorus One`): https://tabs.ultimate-guitar.com/tab/godsmack/1000hp-drums-2796202

Gaps to close before tuning: a real Reddit r/drums thread, OLGA/old-archive `.txt` samples, a real TuxGuitar/Guitar Pro drum export, and DrumBurp's actual ASCII output. All could not be reached or verified in this research pass.
