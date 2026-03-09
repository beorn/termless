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
  - title: Terminal Internals
    details: "Access scrollback, cursor state, cell colors, terminal modes, alt screen, resize behavior — everything that's invisible to string matching."
  - title: Cross-Terminal Conformance
    details: "Run the same tests against 6 backends. Find where xterm.js and Ghostty disagree on emoji width, color palettes, key encoding, and scroll behavior."
  - title: Fast
    details: "Pure in-process terminal emulation. ~1ms per test, not ~100ms. No Chromium, no subprocesses, no flakiness."
  - title: Composable Selectors
    details: "screen, scrollback, buffer, viewport, row, cell, range. Separate WHERE to look from WHAT to assert. 21+ matchers for text, style, cursor, modes."
  - title: SVG & PNG Screenshots
    details: "Generate terminal screenshots as SVG or PNG. No Chromium, no native dependencies. Colors, bold, italic, cursor — all rendered. PNG via optional @resvg/resvg-js."
  - title: CLI + MCP
    details: "termless capture for scripts, termless mcp for AI agents. Automate terminal interaction from the command line."
---

## Quick Start

::: code-group

```bash [npm]
npm install -D @termless/test
```

```bash [bun]
bun add -d @termless/test
```

```bash [pnpm]
pnpm add -D @termless/test
```

```bash [yarn]
yarn add -D @termless/test
```

:::

```typescript
import { test, expect } from "vitest"
import { createTerminalFixture } from "@termless/test"

// ANSI helpers — real apps use @silvery/term or @silvery/ansi, these are just for test data
const BOLD = (s: string) => `\x1b[1m${s}\x1b[0m`
const GREEN = (s: string) => `\x1b[38;2;0;255;0m${s}\x1b[0m`

test("inspect what string matching can't see", () => {
  // Creates an xterm.js terminal by default. Ghostty, Alacritty, WezTerm, vt100,
  // and Peekaboo backends are also available — see Multi-Backend Testing below.
  const term = createTerminalFixture({ cols: 40, rows: 3 })

  // Simulate a build pipeline — 4 lines overflow a 3-row terminal
  term.feed("Step 1: install\r\n")
  term.feed(`Step 2: ${GREEN("build ok")}\r\n`)
  term.feed(`Step 3: ${BOLD("test")}\r\n`)
  term.feed("Step 4: deploy")

  // Region selectors — screen, scrollback, buffer
  expect(term.scrollback).toContainText("install") // scrolled off, still in history
  expect(term.screen).toContainText("deploy") // visible area
  expect(term.buffer).toContainText("install") // everything (scrollback + screen)
  expect(term.row(0)).toHaveText("Step 2: build ok") // specific row

  // Cell styles — colors that getText() can't see
  expect(term.cell(0, 8)).toHaveFg("#00ff00") // "build ok" is green
  expect(term.cell(1, 8)).toBeBold() // "test" is bold

  // Scroll up, then assert on viewport
  term.backend.scrollViewport(1)
  expect(term.viewport).toContainText("install")

  // Resize — verify content survives
  term.resize(20, 3)
  expect(term.screen).toContainText("deploy")

  // Terminal state — window title, cursor, modes
  term.feed("\x1b]2;Build Pipeline\x07") // OSC 2 — set window title
  expect(term).toHaveTitle("Build Pipeline")
  expect(term).toHaveCursorAt(14, 2) // after "Step 4: deploy"
  expect(term).toBeInMode("autoWrap") // default mode
  expect(term).not.toBeInMode("altScreen") // not in alternate screen
})
```

## Why Not Just Assert on Strings?

String assertions on terminal output break constantly:

- **ANSI codes** make string matching fragile (`\x1b[1m` litters your test)
- **Trailing whitespace** differs between terminals and runs
- **Wide characters** (emoji, CJK) occupy 2 columns but 1 string position
- **Colors** are invisible in `getText()` — a red error looks the same as a green success

Termless gives you **structured access** to the terminal buffer. Assert on what matters:

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

| Package               | Description                                                             |
| --------------------- | ----------------------------------------------------------------------- |
| `termless`            | Core: Terminal API, PTY, SVG/PNG screenshots, key mapping, region views |
| `@termless/xtermjs`   | xterm.js backend via `@xterm/headless`                                  |
| `@termless/ghostty`   | Ghostty backend via `ghostty-web` WASM                                  |
| `@termless/vt100`     | Pure TypeScript VT100 emulator, zero native deps                        |
| `@termless/alacritty` | Alacritty backend via `alacritty_terminal` (napi-rs)                    |
| `@termless/wezterm`   | WezTerm backend via `wezterm-term` (napi-rs)                            |
| `@termless/peekaboo`  | OS-level terminal automation (xterm.js + real app)                      |
| `@termless/test`      | Vitest integration: 25+ matchers, fixtures, snapshot serializer         |
| `@termless/cli`       | CLI tools + MCP server for AI agents                                    |

## How It Compares

| Feature               | Termless                              | Manual string testing | Playwright     |
| --------------------- | ------------------------------------- | --------------------- | -------------- |
| Speed                 | ~1ms/test                             | ~1ms/test             | ~100ms+/test   |
| Terminal internals    | Scrollback, cursor, modes, cell attrs | None                  | N/A            |
| ANSI awareness        | Full (colors, bold, cursor)           | None                  | N/A            |
| Multi-backend         | 6 terminal emulators                  | N/A                   | 3 browsers     |
| Protocol capabilities | Kitty, sixel, OSC 8, reflow           | None                  | N/A            |
| Wide char support     | Cell-level width tracking             | Broken                | N/A            |
| Screenshots           | SVG + PNG (no Chromium)               | None                  | PNG (Chromium) |
| PTY support           | Spawn real processes                  | Manual                | N/A            |
| AI integration        | MCP server                            | None                  | None           |

<style>
:root {
  --vp-home-hero-name-color: transparent;
  --vp-home-hero-name-background: -webkit-linear-gradient(120deg, #41d1ff 30%, #bd34fe 100%);
}
</style>
