# termless

Headless terminal testing library. Like Playwright, but for terminal apps.

- **Write tests once** -- run against xterm.js, Ghostty (coming soon), or any backend
- **Composable region selectors** -- `term.screen`, `term.cell(r, c)`, `term.row(n)` for precise assertions
- **21 Vitest matchers** -- text, cell style, cursor, mode, scrollback, and snapshot matchers
- **SVG screenshots** -- no Chromium, no native deps
- **PTY support** -- spawn real processes, send keypresses, wait for output
- **CLI + MCP** -- `termless capture` for scripts, `termless mcp` for AI agents

## Quick Start

```typescript
import { createTerminal } from "termless"
import { createXtermBackend } from "termless-xtermjs"

// Feed data directly
const term = createTerminal({ backend: createXtermBackend(), cols: 80, rows: 24 })
term.feed("\x1b[1mHello\x1b[0m, termless!")
console.log(term.screen.getText()) // "Hello, termless!"
await term.close()
```

### Spawn a real process

```typescript
const term = createTerminal({ backend: createXtermBackend(), cols: 120, rows: 40 })
await term.spawn(["ls", "-la"])
await term.waitFor("total")

console.log(term.screen.getText())
const svg = term.screenshotSvg()

await term.close()
```

### Write tests with Vitest matchers

```typescript
import { describe, test, expect } from "vitest"
import { createTerminalFixture } from "viterm/fixture"
import { createXtermBackend } from "termless-xtermjs"
import "viterm/matchers"

test("renders bold red text", () => {
  const term = createTerminalFixture({ backend: createXtermBackend() })
  term.feed("\x1b[1;38;2;255;0;0mError\x1b[0m")

  expect(term.screen).toContainText("Error")
  expect(term.cell(0, 0)).toBeBold()
  expect(term.cell(0, 0)).toHaveFg("#ff0000")
})
```

## Region Selectors

The composable API separates **where** to look from **what** to assert:

```typescript
// Region selectors (getter properties — no parens)
term.screen      // the rows x cols visible area
term.scrollback  // history above screen
term.buffer      // everything (scrollback + screen)
term.viewport    // current scroll position view

// Region selectors (methods with args)
term.row(n)                      // screen row (negative from bottom)
term.cell(row, col)              // single cell
term.range(r1, c1, r2, c2)      // rectangular region
term.firstRow()                  // first screen row
term.lastRow()                   // last screen row
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

| Matcher | Description |
|---------|-------------|
| `toContainText(text)` | Region contains text as substring |
| `toHaveText(text)` | Region text matches exactly (trimmed) |
| `toMatchLines(lines[])` | Lines match expected array (trailing whitespace trimmed) |

### Cell Style Matchers (on CellView)

| Matcher | Description |
|---------|-------------|
| `toBeBold()` | Cell is bold |
| `toBeItalic()` | Cell is italic |
| `toBeFaint()` | Cell is faint/dim |
| `toBeStrikethrough()` | Cell has strikethrough |
| `toBeInverse()` | Cell has inverse video |
| `toBeWide()` | Cell is double-width (CJK, emoji) |
| `toHaveUnderline(style?)` | Cell has underline; optional style: `"single"`, `"double"`, `"curly"`, `"dotted"`, `"dashed"` |
| `toHaveFg(color)` | Foreground color (`"#rrggbb"` or `{ r, g, b }`) |
| `toHaveBg(color)` | Background color (`"#rrggbb"` or `{ r, g, b }`) |

### Terminal Matchers (on TerminalReadable)

| Matcher | Description |
|---------|-------------|
| `toHaveCursorAt(x, y)` | Cursor at position |
| `toHaveCursorVisible()` | Cursor is visible |
| `toHaveCursorHidden()` | Cursor is hidden |
| `toHaveCursorStyle(style)` | Cursor style: `"block"`, `"underline"`, `"beam"` |
| `toBeInMode(mode)` | Terminal mode is enabled |
| `toHaveTitle(title)` | OSC 2 title matches |
| `toHaveScrollbackLines(n)` | Scrollback has N total lines |
| `toBeAtBottomOfScrollback()` | Viewport at bottom (no scroll offset) |
| `toMatchTerminalSnapshot()` | Vitest snapshot of terminal state |

## Installation

```bash
bun add termless termless-xtermjs   # Core + xterm.js backend
bun add -d viterm                   # Vitest matchers + fixtures
```

## Multi-Backend Testing

Test your TUI against multiple terminal emulators with a single test suite. Write tests once, configure backends via vitest workspace:

```typescript
// vitest.workspace.ts
export default [
  {
    test: { name: "xterm", setupFiles: ["./test/setup-xterm.ts"] },
  },
  {
    test: { name: "ghostty", setupFiles: ["./test/setup-ghostty.ts"] },
  },
]
```

```typescript
// test/setup-xterm.ts
import { createXtermBackend } from "termless-xtermjs"
globalThis.createBackend = () => createXtermBackend()
```

Your tests use `globalThis.createBackend()` and run against every configured backend automatically. See [docs/multi-backend.md](docs/multi-backend.md).

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

## MCP Server

For AI agents (Claude Code, etc.) -- start a stdio MCP server that exposes terminal session management:

```bash
termless mcp
```

## Packages

| Package | Description |
|---------|-------------|
| [termless](.) | Core: Terminal, PTY, SVG screenshots, key mapping, region views |
| [termless-xtermjs](packages/xtermjs) | xterm.js backend (`@xterm/headless`) |
| [termless-ghostty](packages/ghostty) | Ghostty backend (`ghostty-web` WASM) |
| [viterm](packages/viterm) | Vitest matchers, fixtures, and snapshot serializer |
| [termless-cli](packages/cli) | CLI (`termless capture`) + MCP server (`termless mcp`) |

## Documentation

- [Getting Started](docs/getting-started.md) -- install, first test, run it
- [Writing Tests](docs/writing-tests.md) -- matchers, fixtures, assertion patterns
- [Terminal API](docs/terminal-api.md) -- `createTerminal()` and all Terminal methods
- [Screenshots](docs/screenshots.md) -- SVG screenshots, themes, custom fonts
- [Multi-Backend Testing](docs/multi-backend.md) -- test against xterm.js + Ghostty
- [CLI](docs/cli.md) -- CLI usage and MCP server
- **API Reference**: [Terminal](docs/api/terminal.md) | [Backend](docs/api/backend.md) | [Cell](docs/api/cell.md) | [Matchers](docs/api/matchers.md)

## License

MIT
