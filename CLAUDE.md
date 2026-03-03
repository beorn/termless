# termless - Headless Terminal Library

Pluggable headless terminal library for cross-terminal TUI testing. Composable region selectors + matchers. Write tests once, run against Ghostty and xterm.js.

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| `termless` | Core: types, Terminal, PTY, SVG screenshots, key mapping, region views | Active |
| `termless-xtermjs` | xterm.js backend (@xterm/headless) | Active |
| `termless-ghostty` | Ghostty backend (ghostty-web WASM) | Active |
| `viterm` | Vitest integration: matchers, fixtures, snapshots | Active |
| `termless-cli` | CLI + MCP server | Active |

## Architecture

```
viterm (Vitest matchers + fixtures)
  └── termless (TerminalBackend interface + PTY + SVG + region views)
        ├── termless-xtermjs (@xterm/headless)
        └── termless-ghostty (ghostty-web WASM)
```

## Commands

```bash
bun vitest run vendor/beorn-termless/   # Run all tests
```

## Code Style

Factory functions, `using` cleanup, no classes, no globals. Same conventions as km.

## Key Types

- `TerminalBackend` -- interface all backends implement (~18 methods)
- `TerminalReadable` -- read protocol for backends (getText, getTextRange, getCell, getLine, getLines, getCursor, getMode, getTitle, getScrollback)
- `Terminal` -- high-level API: backend + optional PTY + search + screenshots + region selectors
- `RegionView` -- a region of the terminal with getText(), getLines(), containsText()
- `CellView` -- a single cell with positional context (row, col, fg, bg, bold, italic, etc.)
- `RowView` -- a row (extends RegionView) with row number and cellAt(col) access
- `Cell` -- single terminal cell with text, colors, and style flags

## Composable API Pattern

```
WHERE (region selector)     +  WHAT (matcher)
─────────────────────────      ──────────────
term.screen                    toContainText("x")
term.cell(r, c)                toBeBold()
term (TerminalReadable)        toHaveCursorAt(x, y)
```

Region selectors: `term.screen`, `term.scrollback`, `term.buffer`, `term.viewport`, `term.row(n)`, `term.cell(r, c)`, `term.range(r1, c1, r2, c2)`, `term.firstRow()`, `term.lastRow()`.
