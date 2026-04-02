---
title: Recipes
description: Real-world Termless testing patterns for Go, Rust, Python TUI apps, CI integration, and visual regression testing.
---

# Recipes

Real-world testing patterns for common scenarios.

## Testing a Go TUI App (Bubbletea)

Spawn the compiled binary and interact via PTY:

```typescript
import { test, expect } from "vitest"
import { createTestTerminal } from "@termless/test"

test("bubbletea app navigates list", async () => {
  const term = createTestTerminal({ cols: 80, rows: 24 })
  await term.spawn(["./my-bubbletea-app"])

  await expect(term.screen).toContainText("Welcome", { timeout: 5000 })

  term.press("ArrowDown")
  term.press("ArrowDown")
  term.press("Enter")

  await expect(term.screen).toContainText("Selected: item 3", { timeout: 5000 })

  term.press("q")
  await expect(term).not.toBeInMode("altScreen", { timeout: 3000 })
})
```

## Testing a Rust TUI App (Ratatui)

Same pattern -- spawn the release binary and drive it with keypresses:

```typescript
test("ratatui dashboard renders", async () => {
  const term = createTestTerminal({ cols: 120, rows: 40 })
  await term.spawn(["cargo", "run", "--release"])

  await expect(term.screen).toContainText("Dashboard", { timeout: 15000 })
  expect(term).toBeInMode("altScreen")

  // Navigate tabs
  term.press("Tab")
  await expect(term.screen).toContainText("Settings", { timeout: 5000 })
})
```

::: tip Build time
Rust builds can be slow. Use `cargo build --release` in a setup step and spawn the binary directly to avoid rebuilding on every test run.
:::

## Testing a Python TUI App (Textual)

Spawn with `python -m`:

```typescript
test("textual app shows form", async () => {
  const term = createTestTerminal({ cols: 100, rows: 30 })
  await term.spawn(["python", "-m", "myapp"])

  await expect(term.screen).toContainText("Submit", { timeout: 10000 })

  // Tab to input field, type text
  term.press("Tab")
  term.type("hello@example.com")

  await expect(term.screen).toContainText("hello@example.com", { timeout: 3000 })
})
```

## Testing a React TUI App (Silvery)

Silvery provides its own test integration that renders components directly into a Termless terminal -- no process spawning needed:

```typescript
import { test, expect } from "vitest"
import { createTermless } from "@silvery/test"
import { run } from "@silvery/ag-term"
import { App } from "./App.tsx"

test("app renders dashboard", async () => {
  using term = createTermless({ cols: 80, rows: 24 })
  await run(<App />, term)

  expect(term.screen).toContainText("Dashboard")
  expect(term.cell(0, 0)).toBeBold()
})
```

This is in-process and deterministic -- no PTY, no timing issues.

## Testing Color Themes

Use `term.cell(r, c)` to verify foreground and background colors:

```typescript
test("error messages render in red", () => {
  const term = createTestTerminal({ cols: 80, rows: 24 })
  term.feed("\x1b[38;2;255;0;0mError:\x1b[0m file not found")

  expect(term.cell(0, 0)).toHaveFg("#ff0000")
  expect(term.cell(0, 0)).not.toBeBold()
})

test("dark theme background", () => {
  const term = createTestTerminal({ cols: 80, rows: 24 })
  term.feed("\x1b[48;2;30;30;30m\x1b[38;2;200;200;200m Dark Mode \x1b[0m")

  expect(term.cell(0, 1)).toHaveBg({ r: 30, g: 30, b: 30 })
  expect(term.cell(0, 1)).toHaveFg({ r: 200, g: 200, b: 200 })
})
```

## Testing Responsive Layouts

Resize the terminal and re-assert:

```typescript
test("layout adapts to narrow terminal", () => {
  const term = createTestTerminal({ cols: 120, rows: 40 })
  term.feed("Wide layout: sidebar | content")

  expect(term.screen).toContainText("sidebar | content")

  // Resize to narrow
  term.resize(40, 24)
  term.feed("\x1b[2J\x1b[H") // Clear screen (simulate app redraw)
  term.feed("Narrow layout:\nsidebar\ncontent")

  expect(term.row(1)).toContainText("sidebar")
  expect(term.row(2)).toContainText("content")
})
```

For PTY apps that respond to `SIGWINCH`:

```typescript
test("app reflows on resize", async () => {
  const term = createTestTerminal({ cols: 120, rows: 40 })
  await term.spawn(["./my-tui-app"])

  await expect(term.screen).toContainText("wide mode", { timeout: 5000 })

  term.resize(40, 24)
  await expect(term.screen).toContainText("compact mode", { timeout: 5000 })
})
```

## CI Integration

Termless runs headless with no display dependencies. Add it to any CI pipeline:

::: code-group

```yaml [GitHub Actions]
name: Terminal Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun vitest run
        # No display needed -- Termless runs headless
```

```yaml [GitLab CI]
terminal-tests:
  image: oven/bun:latest
  script:
    - bun install
    - bun vitest run
```

:::

No `xvfb`, no `DISPLAY` variable, no Docker-in-Docker. Tests run anywhere Bun or Node.js runs.

## Screenshot Regression Testing

Capture terminal state as SVG snapshots for visual regression testing:

```typescript
import { terminalSerializer, terminalSnapshot } from "@termless/test"

expect.addSnapshotSerializer(terminalSerializer)

test("renders header correctly", () => {
  const term = createTestTerminal({ cols: 60, rows: 10 })
  term.feed("\x1b[1mMy App\x1b[0m v2.1.0\r\n\x1b[2m" + "─".repeat(60) + "\x1b[0m")

  expect(terminalSnapshot(term)).toMatchSnapshot()
})
```

Or save SVG files for manual review:

```typescript
import { writeFileSync } from "node:fs"

test("generate screenshot", () => {
  const term = createTestTerminal({ cols: 80, rows: 24 })
  term.feed("Hello, World!")

  const svg = term.screenshotSvg()
  writeFileSync("test-output/hello.svg", svg)
})
```

## Testing Scrollback

Verify content that has scrolled off-screen:

```typescript
test("scrollback preserves history", () => {
  const term = createTestTerminal({ cols: 80, rows: 5 })

  // Feed more lines than the screen can hold
  for (let i = 0; i < 20; i++) {
    term.feed(`Line ${i}\r\n`)
  }

  // Screen shows the last 5 lines
  expect(term.screen).toContainText("Line 19")
  expect(term.screen).not.toContainText("Line 0")

  // Scrollback has the history
  expect(term.scrollback).toContainText("Line 0")

  // Buffer has everything
  expect(term.buffer).toContainText("Line 0")
  expect(term.buffer).toContainText("Line 19")
})
```

## Testing Cursor State

Assert on cursor position, visibility, and style:

```typescript
test("cursor follows input", () => {
  const term = createTestTerminal({ cols: 80, rows: 24 })

  term.feed("Hello")
  expect(term).toHaveCursorAt(5, 0)

  term.feed("\r\nWorld")
  expect(term).toHaveCursorAt(5, 1)
})

test("app hides cursor", async () => {
  const term = createTestTerminal({ cols: 80, rows: 24 })
  await term.spawn(["./my-tui-app"])

  await expect(term).toHaveCursorHidden({ timeout: 5000 })
})
```
