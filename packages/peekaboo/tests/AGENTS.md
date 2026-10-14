# Peekaboo Tests

Most peekaboo tests require a real terminal environment and are SLOW. The data
path is the exception — it is pure JS and runs anywhere.

## Running

```bash
bun vitest run packages/peekaboo/tests/
```

## Test categories

- `data-path-vterm.test.ts` — **Fast, and runs everywhere.** `visual: false` means
  no window, no osascript, no screencapture, no PTY, so the data path can be
  asserted on Linux and in CI. Guards that the data path runs vterm, the
  production engine: peekaboo is consulted for what a real terminal app is
  doing, and the xterm adapter used to hardcode cursor shape and visibility.
- `backend.slow.test.ts` — Data layer tests (PTY + backend delegation). Requires
  Bun PTY support.
- Visual tests require a running terminal app (Ghostty, iTerm2, etc.) and macOS screencapture.
