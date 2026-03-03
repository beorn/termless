# Peekaboo Tests

Tests for the peekaboo backend require a real terminal environment and are SLOW.

## Running

```bash
bun vitest run vendor/beorn-termless/packages/peekaboo/tests/
```

## Test categories

- `backend.slow.test.ts` — Data layer tests (PTY + xterm.js delegation). Requires Bun PTY support.
- Visual tests require a running terminal app (Ghostty, iTerm2, etc.) and macOS screencapture.
