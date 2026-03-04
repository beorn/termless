# Changelog

## 0.1.0

Initial release.

### termless (core)

- Terminal abstraction with pluggable backends
- PTY support (Bun PTY) for spawning real processes
- SVG screenshots with customizable themes
- Key mapping and encoding (Playwright key format)
- Text search (find, findAll)
- Wait conditions (waitFor text, waitForStable)

### @termless/xtermjs

- xterm.js backend using @xterm/headless
- Full TerminalBackend implementation (~18 methods)
- True color, 256-color palette support
- Terminal mode detection

### @termless/ghostty

- Ghostty backend via ghostty-web WASM
- Full TerminalBackend implementation (text, styles, colors, cursor, modes, scrollback, key encoding)
- 35 backend-specific tests + 47 cross-backend conformance tests

### @termless/test

- 25 Vitest matchers for terminal assertions
- Terminal fixture with automatic cleanup
- Snapshot serializer for terminal state

### @termless/vt100

- Pure TypeScript VT100 emulator (zero native dependencies)
- Full SGR support: 16/256/truecolor colors, all underline styles
- Terminal modes: alt screen, bracketed paste, mouse tracking, auto wrap
- OSC 2 title, wide character detection, scroll regions
- 53 backend tests passing in 22ms

### @termless/alacritty

- Alacritty backend via `alacritty_terminal` crate + napi-rs
- Full Rust native bindings (~350 lines) + TypeScript wrapper
- 35 backend tests (skip gracefully without Rust toolchain)
- Requires: `cd native && cargo build --release`

### @termless/wezterm

- WezTerm backend via `tattoy-wezterm-term` crate + napi-rs
- Full Rust native bindings + TypeScript wrapper
- 35 backend tests (skip gracefully without Rust toolchain)
- Requires: `cd native && cargo build --release`

### @termless/peekaboo

- Dual-layer backend: xterm.js for data + real terminal app for visual
- OS-level automation via MCP peekaboo tools
- Screenshot capture, command spawning, key injection
- 14 integration tests

### @termless/cli

- CLI: `termless capture` for one-shot terminal operations
- MCP server: `termless mcp` for AI agent integration
- SVG screenshots (no Chromium required)
