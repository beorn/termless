# @termless/peekaboo

Peekaboo backend for Termless -- OS-level terminal control via real terminal apps.

## What is this?

A Termless backend that combines:

1. **Data layer**: xterm.js headless backend for fast, accurate cell/text data
2. **Visual layer**: Real terminal app (Ghostty, iTerm2, etc.) for screenshot-based visual verification

This enables tests to verify both programmatic output (via xterm.js) AND real terminal rendering (via screenshots of actual terminal apps).

## Usage

```typescript
import { createPeekabooBackend } from "@termless/peekaboo"
import { createTerminal } from "@termless/core"

// Data-only mode (no terminal app launched)
const backend = createPeekabooBackend()
const term = createTerminal({ backend })
await term.spawn(["bun", "my-tui-app"])
console.log(term.getText()) // from xterm.js

// Visual mode (launches a real terminal app)
const visualBackend = createPeekabooBackend({
  visual: true,
  app: "ghostty",
})
visualBackend.init({ cols: 80, rows: 24 })
await visualBackend.spawnCommand(["bun", "my-tui-app"])
const png = await visualBackend.takeScreenshot()
```

## Supported terminal apps (macOS)

| App          | ID         | Notes                          |
| ------------ | ---------- | ------------------------------ |
| Ghostty      | `ghostty`  | Default. Uses `--command` flag |
| iTerm2       | `iterm2`   | Uses AppleScript               |
| Terminal.app | `terminal` | Uses AppleScript               |
| WezTerm      | `wezterm`  | Uses `wezterm start`           |
| kitty        | `kitty`    | Uses `open -a`                 |

## Architecture

```
PTY (Bun.spawn with terminal)
  |
  +--> xterm.js backend (headless) --> getText(), getCell(), getCursor(), ...
  |
  +--> Real terminal app (optional) --> takeScreenshot() --> PNG buffer
```

## Known limitation: dual-process divergence

In visual mode, `spawnCommand()` starts **two independent processes** running the same command:

1. A real terminal app process (for `takeScreenshot()`)
2. A separate PTY feeding xterm.js (for `getText()`, `getCell()`, etc.)

Because these are independent OS processes, their output can diverge at any time due to timing, randomness, or interleaving differences. This means:

- `getText()` content may not match what appears in the screenshot
- Use **either** data methods or screenshots for assertions, not both together
- Visual mode is best for human-in-the-loop verification, not automated cross-referencing
- Data-only mode (`visual: false`) uses a single PTY and is fully consistent

## `compat-screenshot` — real desktop-terminal capture

The peekaboo backend's `takeScreenshot()` captures a window for a backend session. `compatScreenshot()` is the **standalone orchestration tool** for the common "what does my TUI look like in my actual terminal?" question — it owns the full launch → run → capture → cleanup cycle.

```typescript
import { compatScreenshot } from "@termless/peekaboo"

const result = await compatScreenshot({
  cmd: "bun km view ~/Vault",
  terminal: "ghostty", // | "kitty" | "iterm" | "terminal" — auto-detected if omitted
  cols: 140,
  rows: 40,
  waitFor: "ms", // text to wait for before the screenshot
  outputPath: "/tmp/compat.png",
})
// → { path, mimeType: "image/png", terminal: { name, version, font, theme, resized } }
```

CLI form:

```bash
termless compat-screenshot --terminal ghostty --cols 140 --rows 40 \
  --wait-for ms -o /tmp/compat.png -- bun km view ~/Vault
```

MCP form: the `compat-screenshot` tool of `termless mcp`.

### How it works (8 steps)

1. Resolve the target terminal app — auto-detect order is **ghostty > kitty > iterm > terminal**.
2. Generate a `.command` wrapper script that `cd`s into the working dir and runs the command.
3. Spawn the terminal app pointed at the script (`open -na <App> …`).
4. Request the window size — kitty and Ghostty honor a cell-count override; iTerm and Terminal.app are resized best-effort via AppleScript afterward.
5. Wait for first paint — poll the window's Accessibility text until `waitFor` appears (or any text).
6. `screencapture` the window region.
7. Close the spawned window (unless `keep: true`).
8. Return the PNG path plus a metadata object naming the terminal version / font / theme that was captured.

The wrapper script ends with `exec /bin/bash --login` so the window **stays open** after the TUI command exits — without that keep-alive the window can close before the screenshot lands.

### When to use this vs the canvas renderer

`compat-screenshot` is **slow, macOS-only, and pops a real window**. Use it only for terminal-specific compat questions ("does this look right in Ghostty 1.3 with my Tokyo Night theme?"). For routine visual iteration, regression snapshots, and any CI/headless context, use the canvas renderer (`Terminal.screenshot()`) — it is fast, cross-platform, and Chromium-free.

### Failure modes

`compatScreenshot()` (and `assertCompatCapable()`) fail with a clear, actionable message when:

- **Not macOS** — Linux/Windows have no `screencapture`; a sibling Linux path (`grim` / `gnome-screenshot`) is tracked separately.
- **No GUI session** — e.g. SSH'd in without a console session; no window server to capture.
- **No Screen Recording permission** — grant it under System Settings → Privacy & Security → Screen Recording.

## Window cleanup

Every window peekaboo opens is registered with a process-wide tracker and a single SIGINT/SIGTERM/exit handler. When your script:

- Calls `backend.destroy()` — the window closes immediately via an AppleScript id-targeted `close` (survives the user activating another window between launch and close).
- Crashes or is Ctrl-C'd — the exit handler synchronously closes every still-tracked window.
- Forgets to call destroy — same as above; the exit handler is the safety net.

For iTerm2 and Terminal.app, peekaboo captures the new window's AppleScript id at launch time, so it can target that specific window for close. For Ghostty / WezTerm / kitty (which spawn via `open -a` and don't expose a window id), peekaboo falls back to `close front window` — usually fine because there's typically only one window remaining at exit, but if you have multiple peekaboo windows from those apps open simultaneously, the wrong one could close. Use iTerm2 or Terminal.app if you need precise multi-window cleanup.

If you find leaked terminal windows after a peekaboo run, that's a bug — file it on the termless repo with the app, script that reproduced it, and what kind of exit (Ctrl-C / crash / clean shutdown).

## Requirements

- macOS (uses `screencapture` and AppleScript for window management)
- Bun runtime (for PTY support)
- A terminal app installed (if using visual mode)
