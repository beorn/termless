# termless - Headless Terminal Library

Pluggable headless terminal library for cross-terminal TUI testing. Write tests once, run against Ghostty and xterm.js.

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| `termless` | Core: types, Terminal, PTY, SVG screenshots, key mapping | Active |
| `termless-xtermjs` | xterm.js backend (@xterm/headless) | Active |
| `termless-ghostty` | Ghostty backend (N-API/Zig) | Stub (Phase 2) |
| `viterm` | Vitest integration: matchers, fixtures, snapshots | Active |
| `termless-cli` | CLI + MCP server | Active |

## Architecture

```
viterm (Vitest matchers + fixtures)
  └── termless (TerminalBackend interface + PTY + SVG)
        ├── termless-xtermjs (@xterm/headless)
        └── termless-ghostty (libghostty-vt, future)
```

## Commands

```bash
bun vitest run vendor/beorn-termless/   # Run all tests
```

## Code Style

Factory functions, `using` cleanup, no classes, no globals. Same conventions as km.

## Key Types

- `TerminalBackend` — interface all backends implement (~18 methods)
- `TerminalReadable` — subset for matchers (getText, getCell, getCursor, getMode)
- `Terminal` — high-level API: backend + optional PTY + search + screenshots
- `Cell` — single terminal cell with text, colors, and style flags
