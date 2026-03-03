# CLI & MCP Server

The `termless-cli` package provides a command-line tool for terminal capture and an MCP server for AI agent integration.

## Installation

```bash
bun add termless-cli
```

Or run directly:

```bash
bunx termless capture --command "ls -la" --text
```

## `termless capture`

One-shot terminal capture: start a process, optionally send keypresses, capture text and/or SVG screenshot.

```bash
termless capture --command "ls -la" --text
termless capture --command "my-app" --keys "j,j,Enter" --screenshot /tmp/out.svg --text
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--command <cmd>` | Command to run (required, split on spaces) | -- |
| `--keys <keys>` | Comma-separated key names to press after startup | -- |
| `--wait-for <text>` | Wait for this text before pressing keys | any content |
| `--screenshot <path>` | Save SVG screenshot to this path | -- |
| `--text` | Print terminal text to stdout | off |
| `--cols <n>` | Terminal columns | `120` |
| `--rows <n>` | Terminal rows | `40` |
| `--timeout <ms>` | Wait timeout in milliseconds | `5000` |

### Examples

```bash
# Capture text output of a command
termless capture --command "ls -la" --wait-for "total" --text

# Screenshot a TUI app after navigation
termless capture --command "bun km view /path" \
  --keys "j,j,Enter" \
  --screenshot /tmp/km.svg

# Wide terminal with long timeout
termless capture --command "htop" \
  --cols 200 --rows 50 \
  --timeout 10000 \
  --screenshot /tmp/htop.svg
```

### Key Names

Keys use the same format as `terminal.press()`:

- Single characters: `a`, `1`, `/`
- Named keys: `Enter`, `Tab`, `Backspace`, `Delete`, `Escape`, `Space`
- Arrow keys: `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`
- Navigation: `Home`, `End`, `PageUp`, `PageDown`
- Function keys: `F1` through `F12`
- With modifiers: `Ctrl+c`, `Shift+Tab`, `Alt+x`

## `termless record`

Record a terminal session as SVG frames or an HTML slideshow.

```bash
termless record --command "htop" --duration 5 --format frames
termless record --command "bun km view /path" --format html --output-dir ./demo.html
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--command <cmd>` | Command to run (required, split on spaces) | -- |
| `--cols <n>` | Terminal columns | `120` |
| `--rows <n>` | Terminal rows | `40` |
| `--interval <ms>` | Capture interval in milliseconds | `100` |
| `--duration <seconds>` | Stop after N seconds | -- |
| `--output-dir <path>` | Output directory or file path | `./termless-recording/` |
| `--format <type>` | Output format: `frames` or `html` | `frames` |

## `termless matrix`

Generate a cross-terminal conformance matrix report comparing all available backends.

```bash
termless matrix                              # Print to stdout
termless matrix --output docs/compat-matrix.md  # Save to file
```

Runs a 36-test battery across text rendering, SGR styles, cursor, modes, scrollback, key encoding, unicode, and capabilities. Produces a markdown table showing pass/fail per backend and highlighting differences.

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--output <path>` | Write report to file instead of stdout | -- |

## `termless mcp`

Start a stdio MCP server for AI agents (Claude Code, etc.). The server manages terminal sessions -- AI agents can spawn processes, send input, read output, and take screenshots.

```bash
termless mcp
```

The MCP server exposes tools for:
- Creating terminal sessions with spawned processes
- Sending keypresses and typed text
- Reading terminal text
- Taking SVG screenshots
- Managing multiple concurrent sessions

### Claude Code Integration

Add to your Claude Code MCP configuration:

```json
{
  "mcpServers": {
    "termless": {
      "command": "bunx",
      "args": ["termless", "mcp"]
    }
  }
}
```

## Session Manager (Programmatic)

The session manager is also available as a library:

```typescript
import { createSessionManager } from "termless-cli"

const manager = createSessionManager()

const { id, terminal } = await manager.createSession({
  command: ["my-app"],
  cols: 120,
  rows: 40,
  waitFor: "ready>",
  timeout: 5000,
})

terminal.press("ArrowDown")
await terminal.waitForStable()
console.log(terminal.getText())

await manager.stopSession(id)
// or: await manager.stopAll()
```

### `createSession(options?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `command` | `string[]` | -- | Command to spawn |
| `env` | `Record<string, string>` | -- | Additional env vars |
| `cwd` | `string` | -- | Working directory |
| `cols` | `number` | `120` | Terminal columns |
| `rows` | `number` | `40` | Terminal rows |
| `waitFor` | `string \| "content" \| "stable"` | `"content"` | What to wait for after spawn |
| `timeout` | `number` | `5000` | Wait timeout in ms |

### `getSession(id)`

Get a Terminal instance by session ID. Throws if not found.

### `listSessions()`

Returns array of `{ id, command, cols, rows, alive }` for all sessions.

### `stopSession(id)` / `stopAll()`

Close terminal and kill process for one or all sessions.
