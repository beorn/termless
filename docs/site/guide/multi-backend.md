# Multi-Backend Testing

termless separates the test API from the terminal emulator. Write tests once, run them against any backend.

::: tip Single-backend testing
If you only need the default xterm.js backend, you don't need any of this. Just use `import { createTerminalFixture } from "@termless/test"` -- it handles the backend automatically.
:::

## Architecture

```
Your tests
  └── termless (Terminal API)
        ├── @termless/xtermjs   (xterm.js via @xterm/headless)
        ├── @termless/ghostty   (Ghostty via ghostty-web WASM)
        ├── @termless/vt100     (pure TypeScript, zero deps)
        ├── @termless/alacritty (alacritty_terminal via napi-rs)
        ├── @termless/wezterm   (wezterm-term via napi-rs)
        └── @termless/peekaboo  (xterm.js + OS automation)
```

Tests interact with the `Terminal` interface. The backend is injected at creation time.

## Vitest Workspace Setup

### 1. Create setup files per backend

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

### 2. Configure vitest workspace

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

### 3. Write backend-agnostic tests

```typescript
// test/my-app.test.ts
import { test, expect } from "vitest"
import { createTerminal } from "@termless/monorepo"
import "@termless/test/matchers" // Needed when using createTerminal directly (auto-registered with createTerminalFixture)

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

### 4. Run

```bash
bun vitest run              # Runs all workspace projects
bun vitest run --project xterm   # Run xterm only
```

## Same Test, Different Backends

The key insight: all backends implement the same `TerminalBackend` interface, so `Terminal` behavior is identical. Differences between backends surface as test failures, revealing compatibility issues.

Example of what multi-backend testing catches:

- Different color palette handling
- Reflow behavior on resize
- Unicode/wide character edge cases
- Escape sequence support differences

## How termless Compares to Other Matrix Testing

Matrix testing — running the same tests across multiple implementations — is a well-established pattern. Here's how termless fits in:

| System                               | What it matrices                           | How it works                                                                    | Output                                      |
| ------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------- |
| **GitHub Actions `strategy.matrix`** | OS, runtime version, config variants       | CI runs same workflow N times with different env vars                           | Per-combination pass/fail                   |
| **Playwright `projects`**            | Browsers (Chromium, Firefox, WebKit)       | Same tests injected with different browser launcher                             | Per-browser test results                    |
| **Vitest `workspace`**               | Any axis (backends, configs, environments) | Named projects with different setup files                                       | Per-project test results                    |
| **BrowserStack / Sauce Labs**        | Browsers + devices + OS combinations       | Cloud farms running tests across hundreds of targets                            | Compatibility matrix reports                |
| **termless cross-backend**           | Terminal emulator VT parsers               | Same VT sequences fed to different WASM/native parsers, cell-by-cell comparison | Vitest assertions that fail on disagreement |

### Key differences

**Playwright** is the closest analog — "do different browsers render the same HTML?" maps to "do different terminals parse the same escape sequences?" But Playwright runs tests independently per browser; termless additionally **compares backends side-by-side** in the same test run and produces a diff report. Playwright has no built-in "cross-browser conformance report" — you'd need a custom reporter.

**GitHub CI matrix** is infrastructure-level: "does our code build on Linux and macOS?" It varies the environment, not the system under test. termless varies the terminal emulator implementation itself.

**BrowserStack/Sauce Labs** are the commercial-scale version of what termless does for terminals. They run thousands of browser combinations and produce compatibility matrices. termless aims to be the open-source equivalent for terminal emulators — currently xterm.js and Ghostty, with WezTerm and Alacritty planned.

**Vitest workspace** is the underlying mechanism termless uses. Each backend gets a workspace project with its own setup file. The `cross-backend.test.ts` conformance suite adds cross-backend comparison assertions on top.

### What's unique about termless

No existing tool does automated cross-terminal-emulator conformance testing. Individual terminals test their own VT parser (Ghostty has vttest, xterm.js has its own suite), but no one feeds the **same sequences through multiple parsers and compares cell-by-cell**. termless is the first cross-terminal conformance testing framework. The long-term vision:

1. **Conformance suite**: Shared VT100/ECMA-48 tests all backends must pass
2. **Auto-generated reports**: Which features are identical, which differ, which are unsupported
3. **Regression detection**: CI catches when a new backend version changes behavior
4. **Upstream contribution**: Published findings for terminal emulator projects ("here's where xterm.js and Ghostty disagree on sequence X")
