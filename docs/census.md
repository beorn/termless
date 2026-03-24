# Terminal Census

<div style="text-align: center; padding: 2em 0;">
  <h2 style="font-size: 1.8em; margin-bottom: 0.5em;">
    <a href="https://terminfo.dev" style="text-decoration: none;">Terminfo.dev →</a>
  </h2>
  <p style="font-size: 1.1em; color: var(--vp-c-text-2);">
    Can your terminal do that?<br/>
    Feature support tables for terminal emulators.
  </p>
</div>

**[Terminfo.dev](https://terminfo.dev)** is a "caniuse.com for terminals" — an interactive matrix showing which terminal features are supported by each backend, powered by automated Termless census probes.

## What It Tests

61+ features across 10 backends:

- **SGR styling** — bold, italic, underline (5 variants), colors (256 + truecolor), strikethrough, blink
- **Cursor** — absolute/relative movement, save/restore, visibility, home
- **Modes** — alternate screen, bracketed paste, mouse tracking, focus tracking, auto-wrap
- **Text** — wrapping, wide characters (CJK, emoji), tabs, overwrite
- **Scrollback** — accumulation, scroll regions, reverse index
- **Erase** — line erase (left/right/all), screen erase (below/all)
- **Extensions** — Kitty keyboard/graphics, sixel, OSC 8 hyperlinks, OSC 2 title, semantic prompts, text reflow
- **Reset** — SGR reset, full terminal reset (RIS)

## Backends

| Backend | Type | Engine |
|---------|------|--------|
| xterm.js | JS (headless) | @xterm/headless |
| vt100 | JS | Pure TypeScript ([vt100.js](https://www.npmjs.com/package/vt100.js)) |
| Ghostty Native | Native (Zig) | libghostty-vt |
| Alacritty | Native (Rust) | alacritty_terminal |
| WezTerm | Native (Rust) | tattoy-wezterm-term |
| vt100-rust | Native (Rust) | vt100 crate |
| Kitty | Subprocess | kitty via Python bridge |
| libvterm | WASM (C) | neovim/libvterm |

::: tip
These test headless library implementations, not the terminal applications themselves. A backend scoring lower doesn't mean the real terminal is less capable — it may just not expose all features through its headless API. See [Terminfo.dev](https://terminfo.dev) for details.
:::

## View the Matrix

Visit **[terminfo.dev](https://terminfo.dev)** for the full interactive matrix with hover tooltips, category filters, and backend comparison.
