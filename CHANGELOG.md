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

### termless-xtermjs
- xterm.js backend using @xterm/headless
- Full TerminalBackend implementation (~18 methods)
- True color, 256-color palette support
- Terminal mode detection

### termless-ghostty
- Ghostty backend (stub — planned for Phase 2)

### viterm
- 25 Vitest matchers for terminal assertions
- Terminal fixture with automatic cleanup
- Snapshot serializer for terminal state

### termless-cli
- CLI: `termless capture` for one-shot terminal operations
- MCP server: `termless mcp` for AI agent integration
- SVG screenshots (no Chromium required)
