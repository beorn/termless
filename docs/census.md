# Terminal Census

termless includes a terminal capability census — automated probes that test 61 features across 10 backends, answering "can this terminal do that?"

The full interactive matrix is at **[terminfo.dev](https://terminfo.dev)** — the "caniuse.com for terminal emulators."

## What It Tests

- **SGR styling** — bold, italic, underline variants, colors, strikethrough
- **Cursor** — positioning, visibility, save/restore
- **Modes** — alt screen, bracketed paste, mouse tracking, auto-wrap
- **Text** — wrapping, wide characters, emoji, tabs
- **Scrollback** — accumulation, scroll regions, reverse index
- **Extensions** — Kitty keyboard/graphics, sixel, OSC 8, reflow

## Run Your Own

```bash
# Install termless
npm install -D termless

# Run census probes against all installed backends
bunx termless census run

# Show results
bunx termless census report
```

## Links

- **[terminfo.dev](https://terminfo.dev)** — interactive feature matrix
- **[Backends guide](/guide/backends)** — install and configure backends
- **[GitHub](https://github.com/beorn/termless)** — source code
