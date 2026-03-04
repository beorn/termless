# termless

Headless terminal testing library. Like Playwright, but for terminal apps.

Terminal apps are hard to test because the terminal is a black box — you can see text on screen but can't programmatically inspect colors, cursor position, scrollback history, terminal modes, or cell attributes. termless opens up the entire terminal buffer for structured testing, and runs the same tests against multiple terminal emulators to catch cross-terminal compatibility issues.

Built alongside [inkx](https://github.com/beorn/inkx), a React TUI framework, but works with any terminal app.

- **Full terminal internals** -- access scrollback, cursor state, cell colors, terminal modes, alt screen, resize behavior — everything that's invisible to string matching
- **Cross-terminal conformance** -- run the same tests against xterm.js, Ghostty, Alacritty, WezTerm, vt100, and Peekaboo to find where terminals disagree
- **Composable region selectors** -- `term.screen`, `term.scrollback`, `term.cell(r, c)`, `term.row(n)` for precise assertions
- **21+ Vitest matchers** -- text, cell style, cursor, mode, scrollback, and snapshot matchers
- **SVG screenshots** -- no Chromium, no native deps
- **PTY support** -- spawn real processes, send keypresses, wait for output
- **CLI + MCP** -- `termless capture` for scripts, `termless mcp` for AI agents

## Quick Start

```typescript
import { createTerminal } from "@termless/core"
import { createXtermBackend } from "@termless/xtermjs"

const GREEN = (s: string) => `\x1b[38;2;0;255;0m${s}\x1b[0m`

const term = createTerminal({ backend: createXtermBackend(), cols: 80, rows: 24 })
term.feed(GREEN("● API online"))

// String matching sees text. termless sees everything.
term.screen.getText()  // "● API online"
term.cell(0, 0).fg     // { r: 0, g: 255, b: 0 } — the color getText() can't see

await term.close()
```

### Spawn a real process

```typescript
const term = createTerminal({ backend: createXtermBackend(), cols: 120, rows: 40 })
await term.spawn(["ls", "-la"])
await term.waitFor("total")

// Region selectors — inspect specific parts of the terminal
console.log(term.screen.getText()) // visible area
console.log(term.scrollback.getText()) // history above screen
console.log(term.row(0).getText()) // first row
console.log(term.lastRow().getText()) // last row

const svg = term.screenshotSvg()
await term.close()
```

### Write tests

```typescript
import { test, expect } from "vitest"
import { createTerminalFixture } from "@termless/test"

// ANSI helpers — real apps use inkx or chalk, these are just for test data
const BOLD = (s: string) => `\x1b[1m${s}\x1b[0m`
const GREEN = (s: string) => `\x1b[38;2;0;255;0m${s}\x1b[0m`

test("inspect what string matching can't see", () => {
  const term = createTerminalFixture({ cols: 40, rows: 3 })

  // Simulate a build pipeline — 4 lines overflow a 3-row terminal
  term.feed("Step 1: install\r\n")
  term.feed(`Step 2: ${GREEN("build ok")}\r\n`)
  term.feed(`Step 3: ${BOLD("test")}\r\n`)
  term.feed("Step 4: deploy")

  // Region selectors — screen, scrollback, buffer
  expect(term.scrollback).toContainText("install")  // scrolled off, still in history
  expect(term.screen).toContainText("deploy")        // visible area
  expect(term.buffer).toContainText("install")       // everything (scrollback + screen)
  expect(term.row(0)).toHaveText("Step 2: build ok") // specific row

  // Cell styles — colors that getText() can't see
  expect(term.cell(0, 8)).toHaveFg("#00ff00") // "build ok" is green
  expect(term.cell(1, 8)).toBeBold()          // "test" is bold

  // Scroll up, then assert on viewport
  term.backend.scrollViewport(1)
  expect(term.viewport).toContainText("install")

  // Resize — verify content survives
  term.resize(20, 3)
  expect(term.screen).toContainText("deploy")
})
```

None of this is possible with `expect(output).toContain("text")`. String matching can't see colors, can't inspect scrollback, can't verify cursor position, can't test resize behavior, and can't query terminal capabilities. termless gives you the full terminal state machine.

**Cross-terminal differences are real.** Emoji width, color palette mapping, scroll region behavior, key encoding, Kitty keyboard protocol support, and hyperlink handling all differ between terminals. Run the same test against xterm.js and Ghostty and you'll find them. The `cross-backend.test.ts` suite runs 120+ conformance tests across all backends, catching differences automatically in CI.

## Region Selectors

The composable API separates **where** to look from **what** to assert:

```typescript
// Region selectors (getter properties — no parens)
term.screen // the rows x cols visible area
term.scrollback // history above screen
term.buffer // everything (scrollback + screen)
term.viewport // current scroll position view

// Region selectors (methods with args)
term.row(n) // screen row (negative from bottom)
term.cell(row, col) // single cell
term.range(r1, c1, r2, c2) // rectangular region
term.firstRow() // first screen row
term.lastRow() // last screen row
```

Then assert using the appropriate matchers for each view type:

```typescript
// Text matchers work on RegionView (screen, scrollback, buffer, viewport, row, range)
expect(term.screen).toContainText("Hello")
expect(term.row(0)).toHaveText("Title")
expect(term.screen).toMatchLines(["Line 1", "Line 2"])

// Style matchers work on CellView
expect(term.cell(0, 0)).toBeBold()
expect(term.cell(0, 0)).toHaveFg("#ff0000")
expect(term.cell(2, 5)).toHaveUnderline("curly")

// Terminal matchers work on the terminal itself
expect(term).toHaveCursorAt(5, 0)
expect(term).toBeInMode("altScreen")
expect(term).toHaveTitle("My App")
```

## Matchers Reference

### Text Matchers (on RegionView / RowView)

| Matcher                 | Description                                              |
| ----------------------- | -------------------------------------------------------- |
| `toContainText(text)`   | Region contains text as substring                        |
| `toHaveText(text)`      | Region text matches exactly (trimmed)                    |
| `toMatchLines(lines[])` | Lines match expected array (trailing whitespace trimmed) |

### Cell Style Matchers (on CellView)

| Matcher                   | Description                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `toBeBold()`              | Cell is bold                                                                                  |
| `toBeItalic()`            | Cell is italic                                                                                |
| `toBeFaint()`             | Cell is faint/dim                                                                             |
| `toBeStrikethrough()`     | Cell has strikethrough                                                                        |
| `toBeInverse()`           | Cell has inverse video                                                                        |
| `toBeWide()`              | Cell is double-width (CJK, emoji)                                                             |
| `toHaveUnderline(style?)` | Cell has underline; optional style: `"single"`, `"double"`, `"curly"`, `"dotted"`, `"dashed"` |
| `toHaveFg(color)`         | Foreground color (`"#rrggbb"` or `{ r, g, b }`)                                               |
| `toHaveBg(color)`         | Background color (`"#rrggbb"` or `{ r, g, b }`)                                               |

### Terminal Matchers (on TerminalReadable)

| Matcher                      | Description                                      |
| ---------------------------- | ------------------------------------------------ |
| `toHaveCursorAt(x, y)`       | Cursor at position                               |
| `toHaveCursorVisible()`      | Cursor is visible                                |
| `toHaveCursorHidden()`       | Cursor is hidden                                 |
| `toHaveCursorStyle(style)`   | Cursor style: `"block"`, `"underline"`, `"beam"` |
| `toBeInMode(mode)`           | Terminal mode is enabled                         |
| `toHaveTitle(title)`         | OSC 2 title matches                              |
| `toHaveScrollbackLines(n)`   | Scrollback has N total lines                     |
| `toBeAtBottomOfScrollback()` | Viewport at bottom (no scroll offset)            |
| `toMatchTerminalSnapshot()`  | Vitest snapshot of terminal state                |

## Installation

```bash
bun add -d @termless/test                   # Vitest matchers + fixtures (includes xterm.js backend)
```

## Multi-Backend Testing

Test your TUI against multiple terminal emulators with a single test suite. Write tests once, configure backends via vitest workspace:

```typescript
// vitest.workspace.ts — add as many backends as you want
export default [
  { test: { name: "xterm", setupFiles: ["./test/setup-xterm.ts"] } },
  { test: { name: "ghostty", setupFiles: ["./test/setup-ghostty.ts"] } },
  { test: { name: "vt100", setupFiles: ["./test/setup-vt100.ts"] } },
  // Also available: alacritty, wezterm (require Rust build), peekaboo (OS-level)
]
```

```typescript
// test/setup-xterm.ts                         // test/setup-ghostty.ts
import { createXtermBackend }                  import { createGhosttyBackend }
  from "@termless/xtermjs"                       from "@termless/ghostty"
globalThis.createBackend =                     globalThis.createBackend =
  () => createXtermBackend()                     () => createGhosttyBackend()

// test/setup-vt100.ts — pure TypeScript, zero native deps
import { createVt100Backend } from "@termless/vt100"
globalThis.createBackend = () => createVt100Backend()
```

Your tests use `globalThis.createBackend()` and run against every configured backend automatically. `vitest` runs the entire test suite once per workspace entry — same tests, different terminal emulators. See [docs/multi-backend.md](docs/multi-backend.md).

## CLI

```bash
# Capture terminal output as text
termless capture --command "ls -la" --wait-for "total" --text

# Capture with keypresses and SVG screenshot
termless capture --command "vim file.txt" --keys "i,Hello,Escape,:,w,q,Enter" --screenshot /tmp/vim.svg

# Options
termless capture --command "my-app" \
  --keys "j,j,Enter"        \
  --wait-for "ready"         \
  --screenshot /tmp/out.svg  \
  --text                     \
  --cols 120 --rows 40       \
  --timeout 5000
```

## Cross-Backend Conformance

All backends are tested for conformance via `cross-backend.test.ts` — text rendering, SGR styles, cursor positioning, modes, scrollback, capabilities, key encoding, unicode, and cross-backend output comparison. Run with:

```bash
bun vitest run vendor/beorn-termless/tests/cross-backend.test.ts --project vendor
```

## MCP Server

For AI agents (Claude Code, etc.) -- start a stdio MCP server that exposes terminal session management:

```bash
termless mcp
```

## Packages

| Package                                   | Description                                                     |
| ----------------------------------------- | --------------------------------------------------------------- |
| [termless](.)                             | Core: Terminal, PTY, SVG screenshots, key mapping, region views |
| [@termless/xtermjs](packages/xtermjs)     | xterm.js backend (`@xterm/headless`)                            |
| [@termless/ghostty](packages/ghostty)     | Ghostty backend (`ghostty-web` WASM)                            |
| [@termless/vt100](packages/vt100)         | Pure TypeScript VT100 emulator (zero native deps)               |
| [@termless/alacritty](packages/alacritty) | Alacritty backend (`alacritty_terminal` via napi-rs)            |
| [@termless/wezterm](packages/wezterm)     | WezTerm backend (`wezterm-term` via napi-rs)                    |
| [@termless/peekaboo](packages/peekaboo)   | OS-level terminal automation (xterm.js + real app)              |
| [@termless/test](packages/viterm)         | Vitest matchers, fixtures, and snapshot serializer              |
| [@termless/cli](packages/cli)             | CLI (`termless capture`) + MCP server (`termless mcp`)          |

## How termless Compares

termless is the **only** headless terminal testing library that supports multi-backend testing with composable matchers:

| Feature                   | termless                                 | Playwright + xterm.js   | TUI Test         | ttytest2     | pexpect | Textual | Ink |
| ------------------------- | ---------------------------------------- | ----------------------- | ---------------- | ------------ | ------- | ------- | --- |
| **Terminal internals**    | ✅ scrollback, cursor, modes, cell attrs | ⚠️ xterm.js buffer only | ❌               | ❌           | ❌      | ⚠️      | ❌  |
| **Multi-backend**         | ✅ 6 backends                            | ❌ xterm.js only        | ❌ xterm.js only | ❌ tmux only | ❌      | ❌      | ❌  |
| **Composable selectors**  | ✅ 8 types                               | ❌                      | ❌               | ❌           | ❌      | ⚠️      | ❌  |
| **Visual matchers**       | ✅ 21+                                   | ❌ DIY                  | ⚠️               | ❌           | ❌      | ⚠️      | ❌  |
| **Protocol capabilities** | ✅ Kitty, sixel, OSC 8, reflow           | ❌ xterm.js subset      | ❌               | ❌           | ❌      | ❌      | ❌  |
| **SVG screenshots**       | ✅                                       | ❌                      | ❌               | ❌           | ❌      | ❌      | ❌  |
| **No browser/Chromium**   | ✅                                       | ❌ needs Chromium       | ✅               | ✅           | ✅      | ✅      | ✅  |
| **Framework-agnostic**    | ✅                                       | ✅                      | ✅               | ✅           | ✅      | ❌      | ❌  |
| **TypeScript**            | ✅                                       | ✅                      | ✅               | ❌           | ❌      | ❌      | ✅  |

## Documentation

**[Full documentation site](https://beorn.github.io/termless/)**

- [Getting Started](https://beorn.github.io/termless/guide/getting-started) -- install, first test, run it
- [Writing Tests](https://beorn.github.io/termless/guide/writing-tests) -- matchers, fixtures, assertion patterns
- [Terminal API](https://beorn.github.io/termless/api/terminal) -- `createTerminal()` and all Terminal methods
- [Screenshots](https://beorn.github.io/termless/guide/screenshots) -- SVG screenshots, themes, custom fonts
- [Multi-Backend Testing](https://beorn.github.io/termless/guide/multi-backend) -- test against any backend
- [CLI & MCP](https://beorn.github.io/termless/guide/cli) -- CLI usage and MCP server
- **API Reference**: [Terminal](https://beorn.github.io/termless/api/terminal) | [Backend](https://beorn.github.io/termless/api/backend) | [Cell & Types](https://beorn.github.io/termless/api/cell) | [Matchers](https://beorn.github.io/termless/api/matchers)

## See Also

**[inkx](https://github.com/beorn/inkx)** -- if termless is for _testing_ terminal apps, inkx is for _building_ them. A React TUI framework that fully leverages modern terminal features (truecolor, Kitty keyboard protocol, mouse events, images, scroll regions) and generates all the ANSI codes automatically. Write terminal UIs in familiar React/JSX — inkx handles the terminal complexity. Use `@termless/test` to verify your inkx app renders correctly across terminals.

## License

MIT
