# Changelog

## 0.6.0 - 2026-04-09

### Added

- **Recording themes**: 77 built-in themes (imported from silvery), `Set Theme` in .tape, `--theme` CLI flag
- **SVG chrome**: padding, border radius, window bar, margin options for polished SVG output
- **Asciicast v2 recording/playback**: capture PTY output events with timestamps, play .cast files with real-time streaming
- **GIF output**: generate animated GIFs from terminal recordings
- **Keyboard overlay**: visual key overlay during recording playback
- **Expect command**: assert terminal content during tape execution
- **Play streaming**: real-time asciicast playback with configurable speed
- **Interactive recording**: capture keystrokes and generate .tape files
- **Animation formats**: tape executor/compare tests, VHS tape format support
- **Composable matchers**: `toHaveAttrs` and `toHaveCursor` matchers
- **@termless/vt220 backend**: VT220 emulator backend
- **Glossary**: expanded from 47 to 99 terms, composed from terminfo.dev
- **SEO**: sitemap, robots.txt, OG tags, Twitter cards, JSON-LD breadcrumbs, canonical URLs
- **Footer**: author info and ecosystem cross-links
- **Docs**: Why Termless page, problem summary, navigation submenus, deprecation notices for individual matcher pages

### Changed

- CLI migrated to typed `.argument()` and `.actionMerged()` for commander
- CLI uses `@silvery/commander` typed options
- Renamed `@bearly/vitepress-enrich` to `vitepress-enrich`
- Glossary URLs point to specific terminfo.dev feature pages
- Bjorn → Bjørn in author references
- Removed km references from public docs

### Fixed

- System font loading in resvg (fixes broken font rendering in GIF/PNG output)
- Auto-detect terminal font (Ghostty), moderate SVG defaults
- Zero-dimension crash and empty frame capture in screenshot rendering
- CI: skip silvery theme tests when `@silvery/theme` not available
- CI: use relative imports for standalone compatibility
- `isTerminalReadable` accepts Proxy-based objects
- Various VitePress build and SEO fixes

### Note

Versions 0.3.0 through 0.5.1 were released without changelog entries.

## 0.2.0

- Renamed all packages to `@termless/*` scoped names
- Added `@termless/core` as the published core package (types, Terminal, PTY, SVG/PNG, key mapping, region views)
- Added PNG screenshot support via optional `@resvg/resvg-js`
- Added VitePress documentation site at termless.dev
- Added visual diff, mock timer, and recording/replay APIs
- Improved docs: composable region selectors, Quick Start examples, multi-backend setup
- Renamed internal references from inkx to hightea to silvery

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
