# Getting Started

## Installation

::: code-group

```bash [npm]
npm install -D @termless/test
```

```bash [bun]
bun add -d @termless/test
```

```bash [pnpm]
pnpm add -D @termless/test
```

```bash [yarn]
yarn add -D @termless/test
```

:::

- **@termless/test** -- Vitest integration (21+ matchers, fixtures, snapshot serializer). Installs `@termless/core` and `@termless/xtermjs` (xterm.js backend) as dependencies.

### Which Package Do I Need?

| You want to...                                  | Install                                                   |
| ----------------------------------------------- | --------------------------------------------------------- |
| Test a terminal UI in Vitest                    | `@termless/test` (includes xterm.js backend)              |
| Use the core Terminal API without test matchers | `@termless/core` + a backend (`@termless/xtermjs`, etc.)  |
| Test against Ghostty's VT parser                | `@termless/ghostty`                                       |
| Test with a zero-dependency emulator            | `@termless/vt100`                                         |
| Take SVG/PNG screenshots                        | Built into `@termless/core` (PNG needs `@resvg/resvg-js`) |
| Automate a real terminal app (OS-level)         | `@termless/peekaboo`                                      |
| Use the CLI or MCP server                       | `@termless/cli`                                           |

Most users only need `@termless/test`. To add extra backends, use the CLI:

```bash
# See all available backends
bunx termless backends

# Install additional backends (e.g., Ghostty)
bunx termless install ghostty
```

See [Backend Capabilities](/guide/backends) for a full comparison of all backends.

## First Test

Create a test file:

```typescript
// tests/terminal.test.ts
import { describe, test, expect } from "vitest"
import { createTestTerminal } from "@termless/test"

// ANSI helpers — real apps use @silvery/term or @silvery/ansi, these are just for test data
const BOLD = (s: string) => `\x1b[1m${s}\x1b[0m`
const RED = (s: string) => `\x1b[38;2;255;0;0m${s}\x1b[0m`

describe("my TUI app", () => {
  test("displays welcome message", () => {
    const term = createTestTerminal({ cols: 80, rows: 24 })

    term.feed(`Welcome to ${BOLD("MyApp")} v1.0`)

    expect(term.screen).toContainText("Welcome to MyApp v1.0")
    expect(term.cell(0, 11)).toBeBold() // "M" in "MyApp" is bold
    expect(term.cell(0, 0)).not.toBeBold() // "W" in "Welcome" is not
  })

  test("renders colored status", () => {
    const term = createTestTerminal({ cols: 40, rows: 10 })

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
import { createTestTerminal } from "@termless/test"

test("ls output contains files", async () => {
  const term = createTestTerminal({
    cols: 80,
    rows: 24,
  })

  await term.spawn(["ls", "-la"])

  // Auto-retry matchers wait for content to appear (default timeout: 5s)
  await expect(term.screen).toContainText("total")
})

test("interactive app responds to keypresses", async () => {
  const term = createTestTerminal({
    cols: 120,
    rows: 40,
  })

  await term.spawn(["my-tui-app"])
  await expect(term.screen).toContainText("ready>")

  term.press("ArrowDown")
  term.press("Enter")

  // All text and terminal matchers accept { timeout } for slow operations
  await expect(term.screen).toContainText("Selected: item 2", { timeout: 10000 })
})

test("mouse interaction", async () => {
  const term = createTestTerminal({
    cols: 120,
    rows: 40,
  })

  await term.spawn(["my-tui-app"])
  await expect(term.screen).toContainText("ready>")

  term.click(10, 5) // Click at column 10, row 5
  await expect(term.screen).toContainText("clicked")

  await term.dblclick(10, 5) // Double-click (async)
  await expect(term.screen).toContainText("selected")
})
```

## Using `using` for Cleanup

Terminal implements `Symbol.asyncDispose`, so you can use `using` instead of fixtures:

```typescript
import { createTerminal } from "@termless/core"
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
- [Screenshots](/guide/screenshots) -- SVG & PNG screenshot capture
- [Best Practices](/guide/best-practices) -- avoiding flaky tests, PTY timing, selector tips
- [Multi-Backend Testing](/guide/multi-backend) -- test against multiple backends
- [Backend Capabilities](/guide/backends) -- which backends support which features
- [Terminal API](/api/terminal) -- complete Terminal method reference
