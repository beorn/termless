# Termless

Headless terminal testing library. Like Playwright, but for terminal apps.

Terminal apps are hard to test because the terminal is a black box — you can see text on screen but can't programmatically inspect colors, cursor position, scrollback history, terminal modes, or cell attributes. Termless opens up the entire terminal buffer for structured testing, and runs the same tests against multiple terminal emulators to catch cross-terminal compatibility issues.

Built alongside [silvery](https://silvery.dev), a React TUI framework, but works with any terminal app.

- **Full terminal internals** -- access scrollback, cursor state, cell colors, terminal modes, alt screen, resize behavior — everything that's invisible to string matching
- **Cross-terminal conformance** -- run the same tests against xterm.js, Ghostty, Alacritty, WezTerm, vt100, and Peekaboo to find where terminals disagree
- **Composable region selectors** -- `term.screen`, `term.scrollback`, `term.cell(r, c)`, `term.row(n)` for precise assertions
- **24+ Vitest matchers** -- text, cell style, cursor, mode, scrollback, visibility, and snapshot matchers
- **SVG & PNG screenshots** -- no Chromium, no native deps (PNG via optional `@resvg/resvg-js`)
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
term.screen.getText() // "● API online"
term.cell(0, 0).fg // { r: 0, g: 255, b: 0 } — the color getText() can't see

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
const png = await term.screenshotPng() // requires: bun add -d @resvg/resvg-js
await term.close()
```

### Write tests

```typescript
import { test, expect } from "vitest"
import { createTerminalFixture } from "@termless/test"

// ANSI helpers — real apps use silvery or chalk, these are just for test data
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

None of this is possible with `expect(output).toContain("text")`. String matching can't see colors, can't inspect scrollback, can't verify cursor position, can't test resize behavior, and can't query terminal capabilities. Termless gives you the full terminal state machine.

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

| Matcher                 | Description                                              | Auto-retry |
| ----------------------- | -------------------------------------------------------- | ---------- |
| `toContainText(text)`   | Region contains text as substring                        | yes        |
| `toHaveText(text)`      | Region text matches exactly (trimmed)                    | yes        |
| `toMatchLines(lines[])` | Lines match expected array (trailing whitespace trimmed) | yes        |
| `toHaveTextCount(text, n)`  | Region contains text exactly N times                     | yes        |

### Cell Style Matchers (on CellView)

| Matcher                   | Description                                                                                   | Auto-retry |
| ------------------------- | --------------------------------------------------------------------------------------------- | ---------- |
| `toBeBold()`              | Cell is bold                                                                                  | no         |
| `toBeItalic()`            | Cell is italic                                                                                | no         |
| `toBeDim()`               | Cell is dim                                                                                   | no         |
| `toBeStrikethrough()`     | Cell has strikethrough                                                                        | no         |
| `toBeInverse()`           | Cell has inverse video                                                                        | no         |
| `toBeWide()`              | Cell is double-width (CJK, emoji)                                                             | no         |
| `toHaveUnderline(style?)` | Cell has underline; optional style: `"single"`, `"double"`, `"curly"`, `"dotted"`, `"dashed"` | no         |
| `toHaveFg(color)`         | Foreground color (`"#rrggbb"` or `{ r, g, b }`)                                               | no         |
| `toHaveBg(color)`         | Background color (`"#rrggbb"` or `{ r, g, b }`)                                               | no         |

### Terminal Matchers (on TerminalReadable)

| Matcher                      | Description                                      | Auto-retry |
| ---------------------------- | ------------------------------------------------ | ---------- |
| `toHaveCursorAt(x, y)`       | Cursor at position                               | yes        |
| `toHaveCursorVisible()`      | Cursor is visible                                | yes        |
| `toHaveCursorHidden()`       | Cursor is hidden                                 | yes        |
| `toHaveCursorStyle(style)`   | Cursor style: `"block"`, `"underline"`, `"beam"` | yes        |
| `toBeInMode(mode)`           | Terminal mode is enabled                         | yes        |
| `toHaveTitle(title)`         | OSC 2 title matches                              | yes        |
| `toHaveScrollbackLines(n)`   | Scrollback has N total lines                     | yes        |
| `toBeAtBottomOfScrollback()` | Viewport at bottom (no scroll offset)            | yes        |
| `toHaveVisibleText(text)`    | Text is on the current screen                    | yes        |
| `toHaveHiddenText(text)`     | Text is in scrollback but not on screen          | yes        |
| `toMatchTerminalSnapshot()`  | Vitest snapshot of terminal state                | no         |

## Auto-Retry Matchers (Playwright-Style)

Terminal views (`term.screen`, `term.scrollback`, etc.) are **lazy evaluators** — like Playwright locators, they re-query the terminal on each access. When you `await` a matcher, it auto-retries until the assertion passes or the timeout expires:

```typescript
// Playwright: locator is lazy, assertion retries until DOM updates
await expect(page.locator(".status")).toContainText("ready")

// Termless: terminal view is lazy, assertion retries until terminal updates
await expect(term.screen).toContainText("ready")
```

**Sync** (no `await`) — runs once, passes or fails immediately:

```typescript
expect(term.screen).toContainText("Hello") // sync — single check
```

**Async** (`await`) — retries up to 5 seconds (default):

```typescript
await expect(term.screen).toContainText("Hello") // async — retries until pass or timeout
```

Configure timeout globally or per-assertion:

```typescript
import { configureTerminalMatchers } from "@termless/test/matchers"

configureTerminalMatchers({ timeout: 10_000 }) // global default
await expect(term.screen).toContainText("slow", { timeout: 15_000 }) // per-call override
```

All text matchers (`toContainText`, `toHaveText`, `toMatchLines`) and terminal matchers (`toHaveCursorAt`, `toBeInMode`, etc.) support auto-retry. Cell matchers are always sync — cells are point-in-time snapshots, not live views.

### Why This Matters

Terminal apps are asynchronous. Output arrives over time — a shell prompt appears, then a command runs, then results stream in. Testing with `setTimeout` + manual polling is fragile and slow. Auto-retry matchers let you write natural assertions that wait for the right moment:

```typescript
// Instead of this fragile pattern:
await new Promise((r) => setTimeout(r, 500))
expect(term.screen.getText()).toContain("ready")

// Write this — retries automatically:
await expect(term.screen).toContainText("ready")
```

### Custom Error Messages

Like Playwright's `expect(locator, "context")`, you can add context to assertion errors:

```typescript
// Add context to assertion errors (like Playwright's second argument)
await expect(term.screen).toContainText("ready", {
  timeout: 10_000,
  message: "App should finish loading",
})
// Error: App should finish loading
//
// Expected region to contain "ready"
// Content: Loading...
//
// (retried for 10000ms, timed out after 10000ms)
```

### Visibility Matchers

Screen-level text presence — assert what's visible vs what's scrolled off:

```typescript
// Assert text is visible on the current screen (not just scrollback)
await expect(term).toHaveVisibleText("Ready!")
await expect(term).not.toHaveVisibleText("Loading...")

// Assert text has scrolled off screen
await expect(term).toHaveHiddenText("old output")
```

### Occurrence Counting

```typescript
// Assert exact number of occurrences
expect(term.screen).toHaveTextCount("error", 0)
await expect(term.screen).toHaveTextCount("item", 5)
```

### pollFor — Retry Assertion Blocks

When you need multiple assertions to pass together, use `pollFor` to retry the entire block:

```typescript
import { pollFor } from "@termless/test"

// Retry a block of assertions until all pass
await pollFor(() => {
  expect(term.screen).toContainText("ready")
  expect(term).toHaveCursorAt(0, 5)
})

// With timeout and context message
await pollFor(
  () => {
    expect(term.screen).toContainText("loaded")
  },
  { timeout: 10_000, message: "Dashboard should load" },
)
```

### Vitest Built-ins

Vitest's own async assertion utilities work with termless matchers:

```typescript
// expect.poll — Vitest built-in, works with termless
await expect.poll(() => term.screen.containsText("ready")).toBe(true)

// expect.soft — non-fatal assertions, collect all failures
expect.soft(term.screen).toContainText("header")
expect.soft(term.screen).toContainText("footer")
```

## Installation

```bash
npm install -D @termless/test               # Vitest matchers + fixtures (includes xterm.js backend)
npm install -D @resvg/resvg-js              # Optional: PNG screenshot support
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

Your tests use `globalThis.createBackend()` and run against every configured backend automatically. `vitest` runs the entire test suite once per workspace entry — same tests, different terminal emulators. See [docs/guide/multi-backend.md](docs/guide/multi-backend.md).

## CLI

```bash
# Capture terminal output as text
termless capture --command "ls -la" --wait-for "total" --text

# Capture as SVG screenshot
termless capture --command "vim file.txt" --keys "i,Hello,Escape,:,w,q,Enter" --screenshot /tmp/vim.svg

# Capture as PNG screenshot (detected from .png extension)
termless capture --command "vim file.txt" --keys "i,Hello,Escape,:,w,q,Enter" --screenshot /tmp/vim.png

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
bun vitest run tests/cross-backend.test.ts
```

## MCP Server

For AI agents (Claude Code, etc.) -- start a stdio MCP server that exposes terminal session management:

```bash
termless mcp
```

## Packages

| Package                                   | Description                                                         |
| ----------------------------------------- | ------------------------------------------------------------------- |
| [termless](.)                             | Core: Terminal, PTY, SVG/PNG screenshots, key mapping, region views |
| [@termless/xtermjs](packages/xtermjs)     | xterm.js backend (`@xterm/headless`)                                |
| [@termless/ghostty](packages/ghostty)     | Ghostty backend (`ghostty-web` WASM)                                |
| [@termless/vt100](packages/vt100)         | Pure TypeScript VT100 emulator (zero native deps)                   |
| [@termless/alacritty](packages/alacritty) | Alacritty backend (`alacritty_terminal` via napi-rs)                |
| [@termless/wezterm](packages/wezterm)     | WezTerm backend (`wezterm-term` via napi-rs)                        |
| [@termless/peekaboo](packages/peekaboo)   | OS-level terminal automation (xterm.js + real app)                  |
| [@termless/test](packages/viterm)         | Vitest matchers, fixtures, and snapshot serializer                  |
| [@termless/cli](packages/cli)             | CLI (`termless capture`) + MCP server (`termless mcp`)              |

## How Termless Compares

Termless is the **only** headless terminal testing library that supports multi-backend testing with composable matchers:

| Feature                   | Termless                                 | Playwright + xterm.js   | TUI Test         | ttytest2     | pexpect | Textual | Ink |
| ------------------------- | ---------------------------------------- | ----------------------- | ---------------- | ------------ | ------- | ------- | --- |
| **Terminal internals**    | ✅ scrollback, cursor, modes, cell attrs | ⚠️ xterm.js buffer only | ❌               | ❌           | ❌      | ⚠️      | ❌  |
| **Multi-backend**         | ✅ 6 backends                            | ❌ xterm.js only        | ❌ xterm.js only | ❌ tmux only | ❌      | ❌      | ❌  |
| **Composable selectors**  | ✅ 8 types                               | ❌                      | ❌               | ❌           | ❌      | ⚠️      | ❌  |
| **Visual matchers**       | ✅ 24+                                   | ❌ DIY                  | ⚠️               | ❌           | ❌      | ⚠️      | ❌  |
| **Protocol capabilities** | ✅ Kitty, sixel, OSC 8, reflow           | ❌ xterm.js subset      | ❌               | ❌           | ❌      | ❌      | ❌  |
| **SVG & PNG screenshots** | ✅                                       | ❌                      | ❌               | ❌           | ❌      | ❌      | ❌  |
| **No browser/Chromium**   | ✅                                       | ❌ needs Chromium       | ✅               | ✅           | ✅      | ✅      | ✅  |
| **Framework-agnostic**    | ✅                                       | ✅                      | ✅               | ✅           | ✅      | ❌      | ❌  |
| **TypeScript**            | ✅                                       | ✅                      | ✅               | ❌           | ❌      | ❌      | ✅  |

## Documentation

**[Full documentation site](https://termless.dev/)**

- [Getting Started](https://termless.dev/guide/getting-started) -- install, first test, run it
- [Writing Tests](https://termless.dev/guide/writing-tests) -- matchers, fixtures, assertion patterns
- [Terminal API](https://termless.dev/api/terminal) -- `createTerminal()` and all Terminal methods
- [Screenshots](https://termless.dev/guide/screenshots) -- SVG & PNG screenshots, themes, custom fonts
- [Multi-Backend Testing](https://termless.dev/guide/multi-backend) -- test against any backend
- [CLI & MCP](https://termless.dev/guide/cli) -- CLI usage and MCP server
- **API Reference**: [Terminal](https://termless.dev/api/terminal) | [Backend](https://termless.dev/api/backend) | [Cell & Types](https://termless.dev/api/cell) | [Matchers](https://termless.dev/api/matchers)

## See Also

**[silvery](https://silvery.dev)** -- if Termless is for _testing_ terminal apps, silvery is for _building_ them. A React TUI framework that fully leverages modern terminal features (truecolor, Kitty keyboard protocol, mouse events, images, scroll regions) and generates all the ANSI codes automatically. Write terminal UIs in familiar React/JSX — silvery handles the terminal complexity. Use `@termless/test` to verify your silvery app renders correctly across terminals.

## License

MIT
