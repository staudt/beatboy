# Beatboy

A super metronome and drummer for guitarists, with a pocket drum-machine Beat Editor.

**Play it:** https://staudt.github.io/beatboy/

- **Drummer** — songs made of sections (intro, verse, chorus…), each playing a groove a number of times.
  Press play and it follows the arrangement; NEXT / FILL / BREAK / LOOP, number keys and
  PageUp/PageDown (footswitches) while playing.
- **Beat Editor** — tap pads and steps, or type beats as text (`k+x x s+x x`, compatible with the old
  [typeabeat](https://github.com/staudt/typeabeat) strings). Switching tabs on the same beat is seamless.

Everything is saved in your browser (IndexedDB); no account, no server. Works on phones and desktop.

## Commands

```sh
pnpm install     # install dependencies
pnpm dev         # start the Vite dev server
pnpm test        # unit tests (Vitest)
pnpm test:e2e    # build in test mode, then Playwright end-to-end tests
pnpm build       # notices + typecheck + production build in dist/
```

See `docs/ARCHITECTURE.md` (timing and scheduling) and `docs/NOTATION.md` (beat text).

## Deployment

Pushes to `main` deploy to GitHub Pages via `.github/workflows/deploy.yml`.

## Credits & licenses

- Code: MIT (see `LICENSE`).
- Drum samples: [Virtuosity Drums](https://github.com/sfzinstruments/virtuosity_drums) by Versilian Studios and a
  clap from [Phazite Sounds](https://github.com/august-byrne/phazite-sounds) (from VCSL) — all CC0 1.0.
  Exact sources and processing: `ASSET_LICENSES.md`.
- Font: JetBrains Mono (SIL OFL 1.1); bundled libraries: Preact, Preact Signals (MIT), idb (ISC).
  Full texts: `public/licenses/THIRD_PARTY_NOTICES.txt` (also served with the site).
