# Beat text notation

Beat Editor's **Text** panel lets you type a pattern instead of tapping it. **Spaces separate steps; letters written together sound together.** `kh . sh .` is a step with kick + closed hat, a rest, a step with snare + closed hat, and a rest.

Parsing is done by `parseBeatText` in `src/domain/notation.ts`; `formatBeatText` writes a pattern back out as text. The grid is always 16ths (4 squares per beat, **Straight**) or triplets (3 squares per beat, **Triplet**); a pattern is a loop of N beats (1 to 32). Whether one step is a quarter, an 8th or a 16th depends on how many steps you write (see *Resolution*).

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
- Maximum 32 beats.
- `+` is **not supported**: use letters together (`kh`, not `k+h`). The error says so.
- One-word, one-character-per-square patterns (like typeabeat's `skxkskxk`) are **not supported**; separate the steps with spaces.

## Resolution (you need not type every rest)

Let T be the number of steps in the text, N the pattern's current number of beats and S its squares per beat (4 Straight, 3 Triplet). The text may be written with **d steps per beat** for any d that divides S:

| Feel | d | Written as | Squares between steps |
|------|---|-----------|------------------------|
| Straight | 4 | 16ths | 0 |
| Straight | 2 | 8ths | 1 empty square |
| Straight | 1 | quarters | 3 empty squares |
| Triplet | 3 | triplets | 0 |
| Triplet | 1 | quarters | 2 empty squares |

Step *i* lands on square *i · S/d*. The reading is chosen like this:

1. If T = N × d for an allowed d, that d is used and the beat count stays N (so 8 steps at 4 beats are 8ths, 16 steps at 4 beats are 16ths, 16 steps at 8 beats are 8ths).
2. Otherwise the text is read at full resolution (d = S) and the beat count follows the text: N becomes ceil(T / S), the last beat is padded with rests and a warning says so. More than 32 beats is an error.
3. Empty text keeps the current length.

Applying text can therefore change the beat count. The status line reports the choice, e.g. `✓ 4 beats · read as 8ths`.

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

Rock beat in 8ths (4 beats, 2 steps per beat):

```
kh h  sh h  kh kh  sh h |
```

Eight beats in 16ths with a ghost note and an accent (a line per four beats, cosmetic):

```
Kh h h h  sh h (s) h  kh h kh h  Sh h h h |
kh h h h  sh h h h    kh h kh h  Sh h o h |
```

Repeat with a comment:

```
# four on the floor
[ kh h ]*4 |        # 8ths: kick on every beat
```

## Round trip

`formatBeatText` writes the pattern at the **coarsest resolution that represents every note exactly**: an 8th-note groove prints 2 steps per beat (`kh h  sh h  kh kh  sh h |`), a pattern with 16ths prints 4, a triplet one 3, and a quarter-note one a single step per beat. There is one space between steps, two between beats (one when each beat is a single step), a line break after every four beats, and each line ends with ` |`. Hits in a step are written together in sound order with canonical letters, accents uppercase, ghosts in parentheses. Because the formatted text always has T = N × d, parsing it gives the same pattern back (`parse(format(p)) = p`). Notes that do not sit on the current grid cannot be written as text; the Text panel warns when applying would drop them.
