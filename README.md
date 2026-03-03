# termless

Headless terminal testing library. Like Playwright, but for terminal apps.

- **Write tests once** -- run against xterm.js, Ghostty (coming soon), or any backend
- **25+ Vitest matchers** -- `toBeBoldAt`, `toHaveFgColor`, `toContainText`, and more
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
console.log(term.getText()) // "Hello, termless!"
await term.close()
```

### Spawn a real process

```typescript
const term = createTerminal({ backend: createXtermBackend(), cols: 120, rows: 40 })
await term.spawn(["ls", "-la"])
await term.waitFor("total")

console.log(term.getText())
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

  expect(term).toContainText("Error")
  expect(term).toBeBoldAt(0, 0)
  expect(term).toHaveFgColor(0, 0, "#ff0000")
})
```

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
  // Phase 2:
  // {
  //   test: { name: "ghostty", setupFiles: ["./test/setup-ghostty.ts"] },
  // },
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
| [termless](.) | Core: Terminal, PTY, SVG screenshots, key mapping |
| [termless-xtermjs](packages/xtermjs) | xterm.js backend (`@xterm/headless`) |
| [termless-ghostty](packages/ghostty) | Ghostty backend (Phase 2 -- not yet implemented) |
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
