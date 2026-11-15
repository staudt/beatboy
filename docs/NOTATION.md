# Beat text notation

Beat Lab's **Text** panel lets you type a pattern instead of tapping it. One token is one square, or one beat, or one 8th, depending on how coarsely you write it (see *Resolution* below), so `k-s-k-s-` is a kick on 1 and 3 and a snare on 2 and 4 of a 4-beat loop written in 8ths.

Parsing is done by `parseBeatText` in `src/domain/notation.ts`; `formatBeatText` writes a pattern back out as text. The grid is always 16ths (4 squares per beat, **Straight**) or triplets (3 squares per beat, **Triplet**); a pattern is a loop of N beats (1 to 32).

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
- Each `rest` or `hitgroup` is **one token**.
- The **bar line** `|` is purely cosmetic and ignored like whitespace (the formatter ends each line of four beats with one).
- Maximum 32 beats. Repeats do not nest; the count is 1 to 64.

## Resolution (you need not type every rest)

Let T be the number of tokens in the text, N the pattern's current number of beats and S its squares per beat (4 Straight, 3 Triplet). The text may be written with **d tokens per beat** for any d that divides S:

| Feel | d | Written as | Squares between tokens |
|------|---|-----------|------------------------|
| Straight | 4 | 16ths | 0 |
| Straight | 2 | 8ths | 1 empty square |
| Straight | 1 | quarters | 3 empty squares |
| Triplet | 3 | triplets | 0 |
| Triplet | 1 | quarters | 2 empty squares |

Token *i* lands on square *i · S/d*. The reading is chosen like this:

1. If T = N × d for an allowed d, that d is used and the beat count stays N (so 8 tokens at 4 beats are 8ths, 16 tokens at 4 beats are 16ths, 16 tokens at 8 beats are 8ths).
2. Otherwise the text is read at full resolution (d = S) and the beat count follows the text: N becomes ceil(T / S), the last beat is padded with rests and a warning says so. More than 32 beats is an error.
3. Empty text keeps the current length.

Applying text can therefore change the beat count. The status line reports the choice, e.g. `✓ 4 beats · read as 8ths` (`quarters`, `8ths`, `16ths` or `triplets`).

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

Rock beat in 8ths (4 beats, 2 tokens per beat):

```
k+x x  s+x x  k+x k+x  s+x x |
```

Eight beats in 16ths with a ghost note and an accent (a line per four beats, cosmetic):

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

Strings written for typeabeat paste straight in, one character per square, with whitespace and `|` optional:

```
skxkskxkskxks-k-
```

(16 tokens: 4 beats of 16ths.) The only difference to be aware of is that `o` is the **open** hi-hat here, not a closed one; use `x` for closed hat.

## Round trip

`formatBeatText` writes the pattern at the **coarsest resolution that represents every note exactly**: an 8th-note groove prints 2 tokens per beat (`k+x x  s+x x  k+x k+x  s+x x |`), a pattern with 16ths prints 4, a triplet one 3, and a quarter-note one a single token per beat. There is a space between tokens, two between beats (one when each beat is a single token), a line break after every four beats, and each line ends with ` |`. Accents are uppercase, ghosts are in parentheses. Because the formatted text always has T = N × d, parsing it gives the same pattern back (`parse(format(p)) = p`). Notes that do not sit on the current grid (for example from before notes were quantized) cannot be written as text; the Text panel warns when applying would drop them.
