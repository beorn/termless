---
layout: home

hero:
  name: "termless"
  text: "Headless terminal testing"
  tagline: "Like Playwright, but for terminal apps. Write tests once, run against any backend. ~1ms per test."
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/beorn/termless

features:
  - icon: "\U0001F50D"
    title: Terminal Internals
    details: "Access scrollback, cursor state, cell colors, terminal modes, alt screen, resize behavior — everything that's invisible to string matching."
  - icon: "\U0001F310"
    title: Cross-Terminal Conformance
    details: "Run the same tests against 6 backends. Find where xterm.js and Ghostty disagree on emoji width, color palettes, key encoding, and scroll behavior."
  - icon: "\u26A1"
    title: Fast
    details: "Pure in-process terminal emulation. ~1ms per test, not ~100ms. No Chromium, no subprocesses, no flakiness."
  - icon: "\U0001F50D"
    title: Composable Selectors
    details: "screen, scrollback, buffer, viewport, row, cell, range. Separate WHERE to look from WHAT to assert. 21+ matchers for text, style, cursor, modes."
  - icon: "\U0001F5BC\uFE0F"
    title: SVG Screenshots
    details: "Generate terminal screenshots as SVG. No Chromium, no native dependencies. Colors, bold, italic, cursor — all rendered."
  - icon: "\U0001F527"
    title: CLI + MCP
    details: "termless capture for scripts, termless mcp for AI agents. Automate terminal interaction from the command line."
---

## Quick Start

```bash
bun add -d @termless/test
```

```typescript
import { test, expect } from "vitest"
import { createTerminalFixture } from "@termless/test"

test("inspect what string matching can't see", () => {
  const term = createTerminalFixture({ cols: 60, rows: 10 })

  // Simulate a TUI app: alt screen, window title, styled output
  term.feed("\x1b[?1049h")                              // enter alt screen
  term.feed("\x1b]2;my-app — dashboard\x07")            // set window title
  term.feed("\x1b[1mServer Status\x1b[0m\r\n")
  term.feed("  API:  \x1b[38;2;0;255;0m● online\x1b[0m\r\n")
  term.feed("  DB:   \x1b[38;2;255;0;0m● down\x1b[0m\r\n")
  term.feed("\x1b[4;1H")                                // position cursor

  // Terminal modes, title, cursor — invisible to string assertions
  expect(term).toBeInMode("altScreen")
  expect(term).toHaveTitle("my-app — dashboard")
  expect(term).toHaveCursorAt(0, 3)

  // Region selectors + cell-level styles — colors getText() can't see
  expect(term.row(0)).toHaveText("Server Status")
  expect(term.cell(0, 0)).toBeBold()
  expect(term.cell(1, 8)).toHaveFg("#00ff00")           // green = healthy
  expect(term.cell(2, 8)).toHaveFg("#ff0000")           // red = down

  // Resize — verify content survives terminal resize
  term.resize(30, 10)
  expect(term.screen).toContainText("● online")
  expect(term.screen).toContainText("● down")
})
```

## Why Not Just Assert on Strings?

String assertions on terminal output break constantly:

- **ANSI codes** make string matching fragile (`\x1b[1m` litters your test)
- **Trailing whitespace** differs between terminals and runs
- **Wide characters** (emoji, CJK) occupy 2 columns but 1 string position
- **Colors** are invisible in `getText()` — a red error looks the same as a green success

termless gives you **structured access** to the terminal buffer. Assert on what matters:

```typescript
// Instead of fragile string matching...
expect(output).toContain("\x1b[1;31mError\x1b[0m")

// ...assert on terminal state
expect(term.screen).toContainText("Error")
expect(term.cell(0, 0)).toBeBold()
expect(term.cell(0, 0)).toHaveFg("#ff0000")
expect(term).toBeInMode("altScreen")
expect(term).toHaveTitle("my-app")
```

## Packages

| Package | Description |
|---------|-------------|
| `termless` | Core: Terminal API, PTY, SVG screenshots, key mapping, region views |
| `@termless/xtermjs` | xterm.js backend via `@xterm/headless` |
| `@termless/ghostty` | Ghostty backend via `ghostty-web` WASM |
| `@termless/vt100` | Pure TypeScript VT100 emulator, zero native deps |
| `@termless/alacritty` | Alacritty backend via `alacritty_terminal` (napi-rs) |
| `@termless/wezterm` | WezTerm backend via `wezterm-term` (napi-rs) |
| `@termless/peekaboo` | OS-level terminal automation (xterm.js + real app) |
| `@termless/test` | Vitest integration: 25+ matchers, fixtures, snapshot serializer |
| `@termless/cli` | CLI tools + MCP server for AI agents |

## How It Compares

| Feature | termless | Manual string testing | Playwright |
|---------|----------|-----------------------|------------|
| Speed | ~1ms/test | ~1ms/test | ~100ms+/test |
| Terminal internals | Scrollback, cursor, modes, cell attrs | None | N/A |
| ANSI awareness | Full (colors, bold, cursor) | None | N/A |
| Multi-backend | 6 terminal emulators | N/A | 3 browsers |
| Protocol capabilities | Kitty, sixel, OSC 8, reflow | None | N/A |
| Wide char support | Cell-level width tracking | Broken | N/A |
| Screenshots | SVG (no deps) | None | PNG (Chromium) |
| PTY support | Spawn real processes | Manual | N/A |
| AI integration | MCP server | None | None |

<style>
:root {
  --vp-home-hero-name-color: transparent;
  --vp-home-hero-name-background: -webkit-linear-gradient(120deg, #41d1ff 30%, #bd34fe 100%);
}
</style>
