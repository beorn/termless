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

## Requirements

- macOS (uses `screencapture` and AppleScript for window management)
- Bun runtime (for PTY support)
- A terminal app installed (if using visual mode)
