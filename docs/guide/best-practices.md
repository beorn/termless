---
title: Best Practices
description: Tips for writing reliable, fast, and maintainable terminal tests with Termless -- in-memory vs PTY, timeouts, and determinism.
---

# Best Practices

Tips for writing reliable, fast, and maintainable terminal tests.

## Prefer In-Memory Tests Over PTY

In-memory tests (feed ANSI data, assert on terminal state) are synchronous, deterministic, and typically run in under 1ms. PTY tests spawn real processes and are inherently slower and more timing-sensitive.

**Use in-memory tests** when you control the ANSI output (e.g., testing a rendering library or verifying escape sequence handling):

```typescript
// Fast, deterministic — no process, no timing
const term = createTestTerminal({ cols: 80, rows: 24 })
term.feed("\x1b[1mBold\x1b[0m Normal")
expect(term.cell(0, 0)).toBeBold()
```

**Use PTY tests** when you need to test a real application end-to-end:

```typescript
// Slower, but tests the real thing
const term = createTestTerminal({ cols: 80, rows: 24 })
await term.spawn(["my-tui-app"])
await expect(term.screen).toContainText("ready>", { timeout: 10000 })
```

## Avoiding Flaky Async Tests

### Use auto-retry matchers instead of `waitFor()`

All text and terminal matchers auto-retry when `await`ed (Playwright-style). Views are lazy — they re-read from the terminal on every poll. Use these instead of `waitFor()`:

```typescript
// Best — auto-retry with lazy views, great error messages
await term.spawn(["my-app"])
await expect(term.screen).toContainText("ready", { timeout: 10000 })

// Avoid — waitFor() is deprecated, no diff on failure
await term.spawn(["my-app"])
await term.waitFor("ready", 10000)

// Bad — brittle timing
await term.spawn(["my-app"])
await new Promise((r) => setTimeout(r, 500))
expect(term.screen).toContainText("ready")
```

The `timeout` option (default: 5000ms) controls how long auto-retry polls:

```typescript
// Wait up to 15s for slow startup
await expect(term.screen).toContainText("loaded", { timeout: 15000 })

// Quick assertion (sync or 5s default)
await expect(term.screen).toContainText("prompt>")
```

### Use `waitForStable()` after keypresses

After sending input, use `waitForStable()` to wait for the terminal to settle:

```typescript
term.press("ArrowDown")
await term.waitForStable()
expect(term.screen).toContainText("item 2")
```

## Mouse Interaction

### `click()` and `dblclick()`

Send SGR mouse events to the PTY (requires the app to enable mouse tracking):

```typescript
// Single click at (col, row) — 0-based coordinates
term.click(10, 5)

// Double-click (Playwright-style) — sends two clicks with configurable delay
await term.dblclick(10, 5)
await term.dblclick(10, 5, { delay: 100 }) // 100ms between clicks

// Modifier keys
term.click(10, 5, { ctrl: true })
await term.dblclick(10, 5, { shift: true })
```

### Click on found text

Use `find()` to locate text, then click relative to it:

```typescript
const pos = term.find("Submit")
if (pos) {
  term.click(pos.col, pos.row)
}
```

## PTY Timing Considerations

PTY tests involve real process I/O and are subject to system load, startup time, and buffering. Keep these in mind:

- **Startup time varies.** An app that starts in 100ms on your machine may take 500ms in CI. Always use auto-retry matchers rather than assuming timing.
- **Output may arrive in chunks.** Terminal output is buffered by the PTY layer. A single `feed()` in-memory becomes multiple write events over PTY. Don't assert on intermediate states unless you explicitly wait for them.
- **Process cleanup matters.** Always close terminals after tests. Use `createTestTerminal()` (auto-cleanup) or `using` declarations to avoid leaked processes.
- **CI environments are slower.** Consider marking PTY-heavy tests as slow (`.slow.test.ts`) so they can run separately from your fast unit tests.

## Cross-Backend Testing Strategies

### Start with one backend, expand later

Most projects should start with the default xterm.js backend via `@termless/test`. Add multi-backend testing when you need cross-terminal conformance verification.

### Backend-specific assertions

Some behaviors differ between backends (see the [Backend Capability Matrix](/guide/backends)). Use `term.backend.capabilities` to skip tests that don't apply:

```typescript
test("kitty keyboard protocol", () => {
  const term = createTestTerminal()
  if (!term.backend.capabilities.kittyKeyboard) {
    return // Skip on backends without Kitty keyboard support
  }
  // ...test kitty keyboard behavior
})
```

### Known cross-backend differences

- **Emoji width**: xterm.js headless may not report emoji as wide characters
- **Color palette mapping**: Backends may map ANSI palette colors differently
- **Reflow on resize**: Not all backends support text reflow when the terminal is resized
- **Key encoding**: Modifier key encoding varies between backends

For a comprehensive interactive feature matrix across all backends, visit [terminfo.dev](https://terminfo.dev).

## Selector Best Practices

### Use the narrowest region

Assert on the most specific region that covers your test case:

```typescript
// Too broad — could match text anywhere on screen
expect(term.screen).toContainText("Error")

// Better — asserts on the specific row
expect(term.row(0)).toContainText("Error")

// Best — asserts on exact cell style
expect(term.cell(0, 0)).toHaveFg("#ff0000")
```

### Use `toHaveText()` for exact matches, `toContainText()` for substrings

```typescript
// Exact match (trimmed) — verifies the full row content
expect(term.row(0)).toHaveText("Status: OK")

// Substring match — more resilient to layout changes
expect(term.screen).toContainText("Status: OK")
```

### Use `toMatchLines()` for multi-line assertions

```typescript
expect(term.screen).toMatchLines(["Header", "─────────", "Item 1", "Item 2"])
```

## Screenshot Determinism

SVG and PNG screenshots are deterministic for the same terminal state — same input produces the same output. To keep screenshot-based tests stable:

- **Pin terminal dimensions.** Always specify `cols` and `rows` explicitly.
- **Use consistent themes.** Pass an explicit `theme` to `screenshotSvg()` / `screenshotPng()` rather than relying on defaults.
- **Avoid timestamps or dynamic content** in the terminal output being screenshotted, or replace them before comparison.
- **Use Vitest snapshots** for screenshot regression testing:

```typescript
const svg = term.screenshotSvg({ theme: myTheme })
expect(svg).toMatchSnapshot()
```

## Test Organization

### Group by feature, not by backend

```
tests/
  rendering.test.ts      # Text, colors, styles
  scrollback.test.ts     # Scrollback behavior
  resize.test.ts         # Resize and reflow
  pty.test.ts            # PTY/process tests (slower)
```

### Separate fast and slow tests

In-memory tests run in milliseconds. PTY tests may take seconds. Use file naming conventions (e.g., `.slow.test.ts`) to run them separately:

```bash
bun vitest run tests/          # Fast tests only
bun vitest run tests/*.slow.*  # Slow PTY tests
```
