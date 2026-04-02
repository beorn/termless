---
title: CLI & MCP Server
description: Use the Termless CLI for recording, playback, backend management, and the MCP server for AI agent integration.
---

# CLI & MCP Server

The `@termless/cli` package provides a command-line tool for recording terminal sessions, playing back tape files, managing backends, and an MCP server for AI agent integration.

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
$ bunx termless record -o demo.tape ls -la
```

## `termless record` {#record}

Record terminal sessions as `.tape` files, screenshots, or animated output. Alias: `termless rec`.

```bash
# Interactive recording — exit the command to stop
$ termless record -o demo.tape ls -la

# Scripted recording with inline tape commands
$ termless rec -t 'Type "hello"\nEnter\nScreenshot' bash

# Record + render animated GIF
$ termless record -o demo.gif my-app

# Record to asciicast format
$ termless record -o demo.cast my-app

# Multiple outputs in one pass
$ termless record -o demo.tape -o demo.gif my-app

# Capture mode: run command, press keys, take screenshot
$ termless record --keys j,j,Enter --screenshot /tmp/out.svg bun km view /path
```

### Options

| Option                   | Description                                    | Default   |
| ------------------------ | ---------------------------------------------- | --------- |
| `-o, --output <path...>` | Output file(s), format detected from extension | stdout    |
| `-t, --tape <commands>`  | Inline tape commands (scripted mode)           | --        |
| `--fmt <format>`         | Output format for stdout: `tape`, `cast`       | `tape`    |
| `-b, --backend <name>`   | Backend for scripted mode                      | vterm     |
| `--cols <n>`             | Terminal columns                               | `80`      |
| `--rows <n>`             | Terminal rows                                  | `24`      |
| `--timeout <ms>`         | Wait timeout in ms                             | `5000`    |
| `--keys <keys>`          | Comma-separated key names to press             | --        |
| `--screenshot <path>`    | Save screenshot (SVG or PNG by extension)      | --        |
| `--wait-for <text>`      | Wait for text before pressing keys             | `content` |
| `--text`                 | Print terminal text to stdout                  | off       |

See [Recording & Playback](/guide/recording) for detailed usage.

## `termless play` {#play}

Play back `.tape` or `.cast` files against any backend. Produce screenshots or cross-terminal comparisons.

```bash
# Play a tape file (prints terminal text)
$ termless play demo.tape

# Play an asciicast file
$ termless play demo.cast

# Generate an animated GIF
$ termless play -o demo.gif demo.tape

# Generate an animated SVG
$ termless play -o demo.svg demo.tape

# Multi-backend comparison
$ termless play -b vterm,ghostty --compare side-by-side demo.tape
```

### Options

| Option                 | Description                                                 | Default |
| ---------------------- | ----------------------------------------------------------- | ------- |
| `-o, --output <path>`  | Output file, format detected from extension                 | --      |
| `-b, --backend <name>` | Backend(s), comma-separated                                 | vterm   |
| `--compare <mode>`     | Comparison mode: `separate`, `side-by-side`, `grid`, `diff` | --      |
| `--cols <n>`           | Override terminal columns                                   | --      |
| `--rows <n>`           | Override terminal rows                                      | --      |

See [Recording & Playback](/guide/recording) for detailed usage and comparison modes.

## Backend Management {#backends}

Manage backend installation with Playwright-inspired CLI commands. Backend versions are pinned in `backends.json` -- upgrading termless upgrades all backends together.

### `termless backends`

List all available backends with their type, install status, and version:

```bash
$ termless backends
```

### `termless backends list`

Same as `termless backends` -- list all backends.

### `termless backends install`

Install backends. With no arguments, installs the default set (xtermjs, ghostty, vt100).

```bash
# Install default backends
$ termless backends install

# Install a specific backend
$ termless backends install ghostty

# Install multiple backends
$ termless backends install ghostty alacritty
```

### `termless backends update`

Check upstream registries (npm, crates.io, GitHub) for newer backend versions. Compares against the versions pinned in `backends.json`.

```bash
# Check for updates (dry run)
$ termless backends update

# Apply updates to backends.json
$ termless backends update --apply
```

## `termless doctor` {#doctor}

Check installation health: verify installed backends load correctly, detect version mismatches, and report missing dependencies.

```bash
$ termless doctor
```

## `termless mcp` {#mcp}

Start a stdio MCP server for AI agents (Claude Code, etc.). The server manages terminal sessions -- AI agents can spawn processes, send input, read output, and take screenshots.

```bash
$ termless mcp
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

## Key Names

Keys use the same format as `terminal.press()`:

- Single characters: `a`, `1`, `/`
- Named keys: `Enter`, `Tab`, `Backspace`, `Delete`, `Escape`, `Space`
- Arrow keys: `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`
- Navigation: `Home`, `End`, `PageUp`, `PageDown`
- Function keys: `F1` through `F12`
- With modifiers: `Ctrl+c`, `Shift+Tab`, `Alt+x`
