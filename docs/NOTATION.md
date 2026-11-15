# Beat text notation

Beat Lab's **Text** panel lets you type a pattern instead of tapping it. One character is (usually) one step on the grid, so `k-s-k-s-` is a kick on steps 1 and 5 and a snare on steps 3 and 7 of an 8-step bar.

Parsing is done by `parseBeatText` in `src/domain/notation.ts`; `formatBeatText` writes a pattern back out as text. The text is interpreted against the pattern's current **beats** per bar and **steps** per beat (1 = quarters, 2 = 8ths, 3 = triplets, 4 = 16ths), so the same text means different rhythms at 8ths vs 16ths.

## Grammar

```
text      = { item }
item      = rest | hitgroup | barline | repeat
rest      = "-" | "."
hitgroup  = hit { "+" hit }
hit       = letter | "(" letter ")"
barline   = "|"
repeat    = "[" { rest | hitgroup | barline } "]" "*" number
comment   = "#" … end of line          (ignored)
```

- **Whitespace is ignored** everywhere (spaces, tabs, newlines). Use it freely to group beats.
- Each `rest` or `hitgroup` is **one step**.
- A **bar line** `|` is optional. When present, the bar before it must contain exactly the number of steps in a bar (`numerator × steps per beat`), otherwise you get an error such as `Bar 1 has 7 steps, expected 8`. Without bar lines, steps are simply chopped into bars; an incomplete last bar is padded with rests (a warning is shown).
- Maximum 8 bars. Repeats do not nest; the count is 1 to 64.

## Velocity

| Written | Meaning |
|---------|---------|
| `k`     | normal hit |
| `K`     | **accent** (uppercase) |
| `(k)`   | **ghost** note |

If the same sound appears twice in one hit group, the loudest wins.

## Combining hits

`+` joins sounds on the same step: `k+x` is kick and closed hat together; `K+(x)` is an accented kick with a ghost hat.

## Repeats

`[ k-s- ]*2` expands to `k-s-k-s-`. Repeats can contain bar lines: `[ k-s-k-s- | ]*2` is two bars.

## Letters

| Letter | Sound | Notes |
|--------|-------|-------|
| `k` | Kick | alias `b` |
| `s` | Snare | |
| `j` | Side stick | |
| `l` | Clap | |
| `x` | Hi-hat closed | |
| `d` | Hi-hat pedal | |
| `o` | Hi-hat **open** | alias `h`; in typeabeat `o` meant closed hat, here it is open |
| `r` | Ride | |
| `e` | Ride bell | |
| `c` | Crash | |
| `i` | Crash 2 | |
| `t` | High tom | |
| `m` | Mid tom | |
| `f` | Floor tom | |
| `z` | Tambourine | |
| `w` | Cowbell | |

Letters are case-insensitive except that uppercase means accent.

## Errors

Errors are reported with line and column (1-based, counted over the raw text including spaces), e.g. `Line 2, col 3: Unknown sound 'q'`. At most 20 errors are listed. Nothing is applied until the text parses without errors.

## Examples

Rock beat in 8ths (4 beats × 2 steps):

```
k+x x  s+x x  k+x k+x  s+x x |
```

Two-bar pattern in 16ths with a ghost note and an accent:

```
K+x x x x  s+x x (s) x  k+x x k+x x  S+x x x x |
k+x x x x  s+x x x x    k+x x k+x x  S+x x o x |
```

Repeat with a comment:

```
# four on the floor
[ k+x x ]*4 |        # 8ths: kick on every beat
```

### typeabeat compatibility

Strings written for typeabeat paste straight in, one character per step, with whitespace and `|` optional:

```
skxkskxkskxks-k-
```

(16 steps: 4 beats with 4 steps each.) The only difference to be aware of is that `o` is the **open** hi-hat here, not a closed one; use `x` for closed hat.

## Round trip

`formatBeatText` writes one line per bar, a space between steps, two spaces between beats, and ends each bar with ` |`. Accents are uppercase, ghosts are in parentheses. Notes that do not sit on the current grid (for example for patterns saved before steps were quantized) cannot be written as text; the Text panel warns when applying would drop them.
