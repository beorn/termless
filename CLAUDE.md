# Termless - Headless Terminal Library

Pluggable headless terminal library for cross-terminal TUI testing. Composable region selectors + matchers. Write tests once, run against any backend.

## Documentation Site

VitePress docs at `docs/` — deployed to termless.dev via GitHub Pages.

- **Source**: `docs/` (edit files here)
- **Config**: `docs/.vitepress/config.ts`
- **Build**: `bun run docs:build` (runs `vitepress build docs`)
- **Build output**: `docs/.vitepress/dist/` (gitignored)
- **Logo**: `docs/public/logo.svg`
- **CI**: `.github/workflows/docs.yml` — auto-deploys on push to main

**Do NOT create or edit `docs/site/`** — docs live directly in `docs/`.

## Packages

| Package               | Description                                                                | Runtime       | Status           |
| --------------------- | -------------------------------------------------------------------------- | ------------- | ---------------- |
| `@termless/core`      | Core: types, Terminal, PTY, SVG/PNG screenshots, key mapping, region views | Bun + Node.js | Active           |
| `@termless/xtermjs`   | xterm.js backend (@xterm/headless)                                         | Bun + Node.js | Active           |
| `@termless/ghostty`   | Ghostty backend (ghostty-web WASM)                                         | Bun + Node.js | Active           |
| `@termless/vt100`     | Pure TypeScript VT100 emulator (zero native deps)                          | Bun + Node.js | Active           |
| `@termless/alacritty` | Alacritty backend (alacritty_terminal via napi-rs)                         | Bun + Node.js | Needs Rust build |
| `@termless/wezterm`   | WezTerm backend (wezterm-term via napi-rs)                                 | Bun + Node.js | Needs Rust build |
| `@termless/peekaboo`  | OS-level terminal automation (xterm.js + real app)                         | Bun + Node.js | Active (macOS)   |
| `@termless/test`      | Vitest integration: matchers, fixtures, snapshots                          | Bun + Node.js | Active           |
| `@termless/cli`       | CLI + MCP server                                                           | Bun + Node.js | Active           |

### Runtime Notes

- **PTY support** (`spawnPty` / `terminal.spawn()`) uses Bun's native PTY on Bun, and `node-pty` on Node.js. On Node.js, install `node-pty` as a peer dependency: `npm install node-pty`.
- **Peekaboo** uses OS automation (osascript, screencapture) — macOS only on both runtimes.
- **Pure backends** (xtermjs, ghostty, vt100) have zero runtime-specific dependencies and work on both Bun and Node.js.
- **napi-rs backends** (alacritty, wezterm) load native `.node` binaries — work on any runtime that supports N-API.

## Architecture

```
@termless/test (Vitest matchers + fixtures)
  └── @termless/core (TerminalBackend interface + PTY + SVG/PNG + region views)
        ├── @termless/xtermjs (@xterm/headless)
        ├── @termless/ghostty (ghostty-web WASM)
        ├── @termless/vt100 (pure TypeScript)
        ├── @termless/alacritty (Rust napi-rs)
        ├── @termless/wezterm (Rust napi-rs)
        └── @termless/peekaboo (xterm.js + OS automation)
```

## Commands

```bash
bun test   # Run all tests
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

## Buffer Diff

```typescript
import { diffBuffers } from "@termless/core"

const changes = diffBuffers(oldBuffer, newBuffer)
// Array of { row, col, oldCell, newCell } — only changed cells
```

## Mock Timer

```typescript
import { createMockTimer } from "@termless/core"

const timer = createMockTimer()
timer.setTimeout(fn, 1000)
timer.advanceTime(1000) // Fires the callback synchronously
timer.advanceTime(500) // Partial advance
```

## Recording & Replay

```typescript
import { startRecording, replayRecording } from "@termless/core"

// Record a terminal session
const recording = startRecording(terminal)
// ... interact with terminal ...
const data = recording.stop() // JSON-serializable

// Replay
await replayRecording(terminal, data)
```
