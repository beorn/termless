# Multi-Backend Testing

Termless separates the test API from the terminal emulator. Write tests once, run them against any backend.

::: tip Single-backend testing
If you only need the default xterm.js backend, you don't need any of this. Just use `import { createTestTerminal } from "@termless/test"` -- it handles the backend automatically. (`createTerminalFixture` still works as a deprecated alias.)
:::

## Getting Started

Install the backends you want to test against:

```bash
bunx termless backends                  # See what's available
bunx termless install ghostty vt100     # Install specific backends
```

See [Backend Capabilities](/guide/backends) for the full list of backends, their capabilities, and per-backend usage examples (factory function + string name).

## Three Approaches

### 1. describeBackends (recommended)

The most ergonomic way to run the same tests across all installed backends. Creates a `describe` block per backend with a factory that handles resolution and cleanup:

```typescript
import { describeBackends } from "@termless/test"

describeBackends((ctx) => {
  test("renders bold", async () => {
    const term = await ctx.createTerminal({ cols: 80, rows: 24 })
    term.feed("\x1b[1mBold\x1b[0m")
    expect(term.cell(0, 0)).toBeBold()
  })
})

// Or filter to specific backends:
describeBackends(["ghostty", "vt100"], (ctx) => {
  test("italic works", async () => {
    const term = await ctx.createTerminal()
    term.feed("\x1b[3mI")
    expect(term.cell(0, 0)).toBeItalic()
  })
})
```

### 2. Programmatic (per-test control)

Use `createTestTerminalByName()` to select a specific backend for individual tests:

```typescript
import { createTestTerminalByName } from "@termless/test"

test("works on ghostty", async () => {
  const term = await createTestTerminalByName({ backendName: "ghostty" })
  term.feed("Hello")
  expect(term.screen).toContainText("Hello")
})
```

Or use `backendCases()` to iterate over installed backends manually:

```typescript
import { backendCases } from "@termless/test"

const cases = await backendCases()
for (const { name, createTerminal } of cases) {
  test(`renders correctly on ${name}`, async () => {
    const term = await createTerminal({ cols: 80, rows: 24 })
    term.feed("\x1b[1mBold\x1b[0m")
    expect(term.cell(0, 0)).toBeBold()
  })
}
```

### 3. Vitest Workspace (full control)

Each backend gets its own vitest project with a setup file. This gives you per-backend configuration, separate test runs, and CI matrix support.

#### Create setup files per backend

```typescript
// test/setup-xterm.ts
import { createXtermBackend } from "@termless/xtermjs"

declare global {
  var createBackend: () => import("termless").TerminalBackend
}

globalThis.createBackend = () => createXtermBackend()
```

```typescript
// test/setup-ghostty.ts
import { createGhosttyBackend, initGhostty } from "@termless/ghostty"

declare global {
  var createBackend: () => import("termless").TerminalBackend
}

const ghostty = await initGhostty()
globalThis.createBackend = () => createGhosttyBackend(undefined, ghostty)
```

#### Configure vitest workspace

```typescript
// vitest.workspace.ts
export default [
  {
    test: {
      name: "xterm",
      setupFiles: ["./test/setup-xterm.ts"],
      include: ["test/**/*.test.ts"],
    },
  },
  {
    test: {
      name: "ghostty",
      setupFiles: ["./test/setup-ghostty.ts"],
      include: ["test/**/*.test.ts"],
    },
  },
]
```

#### Write backend-agnostic tests

```typescript
// test/my-app.test.ts
import { test, expect } from "vitest"
import { createTerminal } from "@termless/core"
import "@termless/test/matchers"

function createTerm(cols = 80, rows = 24) {
  return createTerminal({ backend: globalThis.createBackend(), cols, rows })
}

test("renders text correctly", () => {
  const term = createTerm()
  term.feed("Hello, world!")
  expect(term.screen).toContainText("Hello, world!")
  term.close()
})

test("bold text renders as bold", () => {
  const term = createTerm()
  term.feed("\x1b[1mBold\x1b[0m Normal")
  expect(term.cell(0, 0)).toBeBold()
  expect(term.cell(0, 5)).not.toBeBold()
  term.close()
})
```

#### Run

```bash
bun vitest run              # Runs all workspace projects
bun vitest run --project xterm   # Run xterm only
```

## What Multi-Backend Testing Catches

All backends implement the same `TerminalBackend` interface, so `Terminal` behavior should be identical. Differences surface as test failures, revealing compatibility issues:

- Different color palette handling
- Reflow behavior on resize
- Unicode/wide character edge cases
- Escape sequence support differences
- Key encoding variations

See [Cross-Backend Conformance](/advanced/compat-matrix) for the 120+ conformance tests that Termless runs across backends.

## How Termless Compares

| System                        | What it matrices                           | How it works                                                                    |
| ----------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------- |
| **Playwright `projects`**     | Browsers (Chromium, Firefox, WebKit)       | Same tests injected with different browser launcher                             |
| **Vitest `workspace`**        | Any axis (backends, configs, environments) | Named projects with different setup files                                       |
| **BrowserStack / Sauce Labs** | Browsers + devices + OS combinations       | Cloud farms running tests across hundreds of targets                            |
| **Termless cross-backend**    | Terminal emulator VT parsers               | Same VT sequences fed to different WASM/native parsers, cell-by-cell comparison |

Playwright is the closest analog — "do different browsers render the same HTML?" maps to "do different terminals parse the same escape sequences?" But Termless additionally **compares backends side-by-side** in the same test run. No existing tool does automated cross-terminal-emulator conformance testing.
