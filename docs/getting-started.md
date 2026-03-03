# Getting Started

## Installation

```bash
bun add termless termless-xtermjs
bun add -d viterm
```

- **termless** -- core library (Terminal, PTY, SVG screenshots, key mapping)
- **termless-xtermjs** -- xterm.js backend (in-process terminal emulation via `@xterm/headless`)
- **viterm** -- Vitest integration (25+ matchers, fixtures, snapshot serializer)

## First Test

Create a test file:

```typescript
// tests/terminal.test.ts
import { describe, test, expect } from "vitest"
import { createTerminalFixture } from "viterm/fixture"
import { createXtermBackend } from "termless-xtermjs"
import "viterm/matchers"

describe("my TUI app", () => {
  test("displays welcome message", () => {
    const term = createTerminalFixture({
      backend: createXtermBackend(),
      cols: 80,
      rows: 24,
    })

    // Feed ANSI data (as if a terminal app wrote it)
    term.feed("Welcome to \x1b[1mMyApp\x1b[0m v1.0")

    // Assert text content
    expect(term).toContainText("Welcome to MyApp v1.0")

    // Assert styling
    expect(term).toBeBoldAt(0, 11) // "M" in "MyApp" is bold
    expect(term).not.toBeBoldAt(0, 0) // "W" in "Welcome" is not

    // No manual cleanup needed -- createTerminalFixture handles it
  })

  test("renders colored status bar", () => {
    const term = createTerminalFixture({
      backend: createXtermBackend(),
      cols: 40,
      rows: 10,
    })

    // Red foreground with truecolor
    term.feed("\x1b[38;2;255;0;0mERROR\x1b[0m: something went wrong")

    expect(term).toContainText("ERROR: something went wrong")
    expect(term).toHaveFgColor(0, 0, "#ff0000")
  })
})
```

## Run It

```bash
bun vitest run tests/terminal.test.ts
```

## Spawning Real Processes

To test a real TUI application with PTY:

```typescript
import { test, expect } from "vitest"
import { createTerminalFixture } from "viterm/fixture"
import { createXtermBackend } from "termless-xtermjs"
import "viterm/matchers"

test("ls output contains files", async () => {
  const term = createTerminalFixture({
    backend: createXtermBackend(),
    cols: 80,
    rows: 24,
  })

  await term.spawn(["ls", "-la"])
  await term.waitFor("total") // Wait for ls output

  expect(term).toContainText("total")
})

test("interactive app responds to keypresses", async () => {
  const term = createTerminalFixture({
    backend: createXtermBackend(),
    cols: 120,
    rows: 40,
  })

  await term.spawn(["my-tui-app"])
  await term.waitFor("ready>")

  term.press("ArrowDown")
  term.press("Enter")
  await term.waitForStable()

  expect(term).toContainText("Selected: item 2")
})
```

## Using `using` for Cleanup

Terminal implements `Symbol.asyncDispose`, so you can use `using` instead of fixtures:

```typescript
import { createTerminal } from "termless"
import { createXtermBackend } from "termless-xtermjs"

test("with explicit cleanup", async () => {
  await using term = createTerminal({
    backend: createXtermBackend(),
    cols: 80,
    rows: 24,
  })

  term.feed("Hello")
  expect(term.getText()).toContain("Hello")
  // term.close() called automatically at end of scope
})
```

## Next Steps

- [Writing Tests](writing-tests.md) -- all matchers and assertion patterns
- [Terminal API](terminal-api.md) -- complete Terminal method reference
- [Screenshots](screenshots.md) -- SVG screenshot capture
- [Multi-Backend Testing](multi-backend.md) -- test against multiple backends
