# Getting Started

## Installation

```bash
bun add -d @termless/test
```

- **@termless/test** -- Vitest integration (25+ matchers, fixtures, snapshot serializer). Installs `termless` (core) and `@termless/xtermjs` (xterm.js backend) as dependencies.

## First Test

Create a test file:

```typescript
// tests/terminal.test.ts
import { describe, test, expect } from "vitest"
import { createTerminalFixture } from "@termless/test"

// ANSI helpers — real apps use inkx or chalk, these are just for test data
const BOLD = (s: string) => `\x1b[1m${s}\x1b[0m`
const RED = (s: string) => `\x1b[38;2;255;0;0m${s}\x1b[0m`

describe("my TUI app", () => {
  test("displays welcome message", () => {
    const term = createTerminalFixture({ cols: 80, rows: 24 })

    term.feed(`Welcome to ${BOLD("MyApp")} v1.0`)

    expect(term.screen).toContainText("Welcome to MyApp v1.0")
    expect(term.cell(0, 11)).toBeBold() // "M" in "MyApp" is bold
    expect(term.cell(0, 0)).not.toBeBold() // "W" in "Welcome" is not
  })

  test("renders colored status", () => {
    const term = createTerminalFixture({ cols: 40, rows: 10 })

    term.feed(`${RED("ERROR")}: something went wrong`)

    expect(term.screen).toContainText("ERROR: something went wrong")
    expect(term.cell(0, 0)).toHaveFg("#ff0000")
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
import { createTerminalFixture } from "@termless/test"

test("ls output contains files", async () => {
  const term = createTerminalFixture({
    cols: 80,
    rows: 24,
  })

  await term.spawn(["ls", "-la"])
  await term.waitFor("total") // Wait for ls output

  expect(term).toContainText("total")
})

test("interactive app responds to keypresses", async () => {
  const term = createTerminalFixture({
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
import { createTerminal } from "@termless/monorepo"
import { createXtermBackend } from "@termless/xtermjs"

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

- [Writing Tests](/guide/writing-tests) -- all matchers and assertion patterns
- [Terminal API](/api/terminal) -- complete Terminal method reference
- [Screenshots](/guide/screenshots) -- SVG & PNG screenshot capture
- [Multi-Backend Testing](/guide/multi-backend) -- test against multiple backends
