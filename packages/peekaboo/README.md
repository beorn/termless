# @termless/peekaboo

Peekaboo backend for termless -- OS-level terminal control via real terminal apps.

## What is this?

A termless backend that combines:
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

| App | ID | Notes |
|-----|------|-------|
| Ghostty | `ghostty` | Default. Uses `--command` flag |
| iTerm2 | `iterm2` | Uses AppleScript |
| Terminal.app | `terminal` | Uses AppleScript |
| WezTerm | `wezterm` | Uses `wezterm start` |
| kitty | `kitty` | Uses `open -a` |

## Architecture

```
PTY (Bun.spawn with terminal)
  |
  +--> xterm.js backend (headless) --> getText(), getCell(), getCursor(), ...
  |
  +--> Real terminal app (optional) --> takeScreenshot() --> PNG buffer
```

## Requirements

- macOS (uses `screencapture` and AppleScript for window management)
- Bun runtime (for PTY support)
- A terminal app installed (if using visual mode)
