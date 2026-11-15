# Beat text notation

Beat Editor's **Text** panel lets you type a pattern instead of tapping it. **Spaces separate steps; letters written together sound together.** `kh . sh .` is a step with kick + closed hat, a rest, a step with snare + closed hat, and a rest.

Parsing is done by `parseBeatText` in `src/domain/notation.ts`; `formatBeatText` writes a pattern back out as text. **Every step is exactly one square of the grid**: a 16th when the pattern's feel is **Straight** (4 squares per beat), one triplet step when it is **Triplet** (3 per beat). **The loop is exactly as long as the steps you type**, with no padding to whole beats and no guessing of 8ths or quarters: `kh h hs h` is 4 steps (one beat), `s k s` is a 3-step loop (three quarters of a beat), `kh . h . sh . h .` is 8 steps (two beats, an 8th feel). Write a `.` for every square you want silent. The longest loop is 32 beats' worth (128 straight / 96 triplet steps).

## Grammar

```
text     = { item }
item     = step | barline | repeat
step     = rest | hit { hit }          (no whitespace inside a step)
rest     = "." | "-"
hit      = letter | "(" letter ")"
barline  = "|"
repeat   = "[" { step | barline } "]" "*" number
comment  = "#" … end of line           (ignored)
```

- **Whitespace** (spaces, tabs, newlines) separates steps. Several spaces count as one; the formatter uses two between beats purely for readability.
- A step is either **one rest** or **one or more hits written together**. `k.` (rest and hit in one step) is an error, so is `k---`: write `k . . .`.
- The **bar line** `|` is cosmetic and ignored. It may stand alone or touch steps (`kh|`).
- `[` and `]` may touch steps: `[kh . sh .]*2`. Repeats do not nest; the count is 1 to 64.
- Maximum 128 steps (Straight) or 96 steps (Triplet), i.e. 32 beats.
- `+` is **not supported**: use letters together (`kh`, not `k+h`). The error says so.
- One-word, one-character-per-square patterns (like typeabeat's `skxkskxk`) are **not supported**; separate the steps with spaces.

## Timing (each step is one square)

Step *i* (counting from 0) lands on square *i*: tick `i × 120` when Straight, `i × 160` when Triplet. The loop length is the number of steps (repeats expanded, bar lines ignored).

| Text | Feel | Steps | Loop |
|------|------|-------|------|
| `kh h hs h` | Straight | 4 | 1 beat of 16ths |
| `s k s` | Straight | 3 | 360 ticks: plays 3 squares, then starts over |
| `kh . h .  sh . h .` | Straight | 8 | 2 beats (8th-note feel: rests fill the odd squares) |
| `k . . s . . k . . s . .` | Triplet | 12 | 4 beats of triplets |

Applying text sets the pattern's length to exactly that many steps (so the beat count can change); empty text clears the notes and keeps the length. In a song's section field an empty text is an error ("Type at least one step"). The status line reports e.g. `✓ 4 steps · 1 beat`, `✓ 3 steps`, `✓ 12 steps · 4 beats (triplets)`.

## Velocity

| Written | Meaning |
|---------|---------|
| `k`     | normal hit |
| `K`     | **accent** (uppercase) |
| `(k)`   | **ghost** note |

If the same sound appears twice in one step, the loudest wins. Mix freely inside a step: `Kh` is an accented kick with a hat, `k(s)` a kick with a ghost snare.

## Repeats

`[ k . s . ]*2` expands to `k . s . k . s .`. Repeats can contain bar lines: `[ k . s . k . s . | ]*2`.

## Letters

| Letter | Sound | Notes |
|--------|-------|-------|
| `k` | Kick | alias `b` |
| `s` | Snare | |
| `j` | Side stick | |
| `l` | Clap | |
| `h` | Hi-hat **closed** | alias `x` |
| `d` | Hi-hat pedal | |
| `o` | Hi-hat **open** | |
| `r` | Ride | |
| `e` | Ride bell | |
| `c` | Crash | |
| `i` | Crash 2 | |
| `t` | High tom | |
| `m` | Mid tom | |
| `f` | Floor tom | |
| `z` | Tambourine | |
| `w` | Cowbell | |

Lookup is case-insensitive; uppercase means accent.

## Errors

Errors are reported with line and column (1-based, counted over the raw text including spaces), e.g. `Line 2, col 3: Unknown sound 'q'`. At most 20 errors are listed. Nothing is applied until the text parses without errors.

## Examples

Rock beat in 8ths (4 beats, an empty square between every two hits):

```
kh . h .  sh . h .  kh . kh .  sh . h . |
```

A 3-step loop (snare, kick, snare), one beat of 16ths, and a kick-snare 8th groove:

```
s k s
kh h hs h
k . . .  s . . .
```

Eight beats in 16ths with a ghost note and an accent (a line per four beats, cosmetic):

```
Kh h h h  sh h (s) h  kh h kh h  Sh h h h |
kh h h h  sh h h h    kh h kh h  Sh h o h |
```

Repeat with a comment:

```
# four on the floor
[ kh . h . ]*4 |        # 4 steps x 4 = 16 steps = 4 beats
```

## Round trip

`formatBeatText` always writes **one token per square** (rests are `.`), a space between tokens and two between beats; a partial last beat just has fewer tokens (`s k s . . . .` is not produced for a 3-step loop: it prints `s k s`). A line break after every four beats, each line ending in ` |` (the song section field uses one line without bar lines). Hits in a step are written together in sound order with canonical letters, accents uppercase, ghosts in parentheses. Because every token is a square, `parse(format(p)) = p` (notes and length). Notes that do not sit on the current grid cannot be written as text; the Text panel warns when applying would drop them.
