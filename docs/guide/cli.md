# CLI & MCP Server

The `@termless/cli` package provides a command-line tool for terminal capture and an MCP server for AI agent integration.

## Installation

::: code-group

```bash [npm]
npm install @termless/cli
```

```bash [bun]
bun add @termless/cli
```

```bash [pnpm]
pnpm add @termless/cli
```

```bash [yarn]
yarn add @termless/cli
```

:::

Or run directly:

```bash
bunx termless capture --command "ls -la" --text
```

## Backend Management

Manage backend installation with Playwright-inspired CLI commands. Backend versions are pinned in `backends.json` -- upgrading termless upgrades all backends together.

### `termless backends`

List all available backends with their type, install status, and version.

```bash
termless backends
```

Example output:

```
Backend                Upstream                   Version       Status
─────────────────────  ─────────────────────────  ────────────  ────────────────────
xtermjs (js)           npm:@xterm/headless        5.5.0         installed (default)
ghostty (wasm)         npm:ghostty-web            0.4.0         installed (default)
vt100 (js)             npm:@termless/vt100        0.3.0         installed (default)
alacritty (native)     crate:alacritty_terminal   0.26.0        installed
wezterm (native)       crate:tattoy-wezterm-term  0.1.0-fork.5  installed
peekaboo (os)          npm:peekaboo               0.7.0         installed
vt100-rust (native)    crate:vt100                0.15.0        installed
libvterm (wasm)        github:neovim/libvterm     0.3.0         installed
ghostty-native (native) github:ghostty-org/ghostty 1.3.1        available
kitty (native)         github:kovidgoyal/kitty    0.40.0        available
```

### `termless install`

Install backends. With no arguments, installs the default set (xtermjs, ghostty, vt100).

```bash
# Install default backends
termless install

# Install a specific backend
termless install ghostty

# Install all backends
termless install --all
```

### `termless upgrade`

Upgrade installed backends to match the versions in `backends.json`.

```bash
termless upgrade
```

### `termless doctor`

Check installation health: verify installed backends load correctly, detect version mismatches, and report missing dependencies.

```bash
termless doctor
```

### `termless update`

Check upstream registries (npm, crates.io, GitHub) for newer backend versions. Compares against the versions pinned in `backends.json`.

```bash
# Check for updates (dry run)
termless update

# Apply updates to backends.json
termless update --apply
```

## `termless capture`

One-shot terminal capture: start a process, optionally send keypresses, capture text and/or screenshot (SVG or PNG).

```bash
termless capture --command "ls -la" --text
termless capture --command "my-app" --keys "j,j,Enter" --screenshot /tmp/out.svg --text
termless capture --command "my-app" --keys "j,j,Enter" --screenshot /tmp/out.png      # PNG
```

### Options

| Option                | Description                                           | Default     |
| --------------------- | ----------------------------------------------------- | ----------- |
| `--command <cmd>`     | Command to run (required, split on spaces)            | --          |
| `--keys <keys>`       | Comma-separated key names to press after startup      | --          |
| `--wait-for <text>`   | Wait for this text before pressing keys               | any content |
| `--screenshot <path>` | Save screenshot (SVG or PNG, detected from extension) | --          |
| `--text`              | Print terminal text to stdout                         | off         |
| `--cols <n>`          | Terminal columns                                      | `120`       |
| `--rows <n>`          | Terminal rows                                         | `40`        |
| `--timeout <ms>`      | Wait timeout in milliseconds                          | `5000`      |

### Examples

```bash
# Capture text output of a command
termless capture --command "ls -la" --wait-for "total" --text

# Screenshot a TUI app after navigation (SVG)
termless capture --command "bun km view /path" \
  --keys "j,j,Enter" \
  --screenshot /tmp/km.svg

# Screenshot as PNG (detected from .png extension)
termless capture --command "bun km view /path" \
  --keys "j,j,Enter" \
  --screenshot /tmp/km.png

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

| Option                 | Description                                | Default                 |
| ---------------------- | ------------------------------------------ | ----------------------- |
| `--command <cmd>`      | Command to run (required, split on spaces) | --                      |
| `--cols <n>`           | Terminal columns                           | `120`                   |
| `--rows <n>`           | Terminal rows                              | `40`                    |
| `--interval <ms>`      | Capture interval in milliseconds           | `100`                   |
| `--duration <seconds>` | Stop after N seconds                       | --                      |
| `--output-dir <path>`  | Output directory or file path              | `./termless-recording/` |
| `--format <type>`      | Output format: `frames` or `html`          | `frames`                |

## `termless mcp`

Start a stdio MCP server for AI agents (Claude Code, etc.). The server manages terminal sessions -- AI agents can spawn processes, send input, read output, and take screenshots.

```bash
termless mcp
```

The MCP server exposes tools for:

- Creating terminal sessions with spawned processes
- Sending keypresses and typed text
- Reading terminal text
- Taking SVG or PNG screenshots
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
import { createSessionManager } from "@termless/cli"

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

| Option    | Type                              | Default     | Description                  |
| --------- | --------------------------------- | ----------- | ---------------------------- |
| `command` | `string[]`                        | --          | Command to spawn             |
| `env`     | `Record<string, string>`          | --          | Additional env vars          |
| `cwd`     | `string`                          | --          | Working directory            |
| `cols`    | `number`                          | `120`       | Terminal columns             |
| `rows`    | `number`                          | `40`        | Terminal rows                |
| `waitFor` | `string \| "content" \| "stable"` | `"content"` | What to wait for after spawn |
| `timeout` | `number`                          | `5000`      | Wait timeout in ms           |

### `getSession(id)`

Get a Terminal instance by session ID. Throws if not found.

### `listSessions()`

Returns array of `{ id, command, cols, rows, alive }` for all sessions.

### `stopSession(id)` / `stopAll()`

Close terminal and kill process for one or all sessions.
