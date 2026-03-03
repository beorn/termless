# Multi-Backend Testing

termless separates the test API from the terminal emulator. Write tests once, run them against xterm.js today and Ghostty when it's ready.

## Architecture

```
Your tests
  └── termless (Terminal API)
        ├── termless-xtermjs  (xterm.js -- available now)
        └── termless-ghostty  (Ghostty -- Phase 2)
```

Tests interact with the `Terminal` interface. The backend is injected at creation time.

## Vitest Workspace Setup

### 1. Create setup files per backend

```typescript
// test/setup-xterm.ts
import { createXtermBackend } from "termless-xtermjs"

declare global {
  var createBackend: () => import("termless").TerminalBackend
}

globalThis.createBackend = () => createXtermBackend()
```

```typescript
// test/setup-ghostty.ts (Phase 2)
import { createGhosttyBackend } from "termless-ghostty"

declare global {
  var createBackend: () => import("termless").TerminalBackend
}

globalThis.createBackend = () => createGhosttyBackend()
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
  // Uncomment when ghostty backend is ready:
  // {
  //   test: {
  //     name: "ghostty",
  //     setupFiles: ["./test/setup-ghostty.ts"],
  //     include: ["test/**/*.test.ts"],
  //   },
  // },
]
```

### 3. Write backend-agnostic tests

```typescript
// test/my-app.test.ts
import { test, expect } from "vitest"
import { createTerminal } from "termless"
import "viterm/matchers"

function createTerm(cols = 80, rows = 24) {
  return createTerminal({ backend: globalThis.createBackend(), cols, rows })
}

test("renders text correctly", () => {
  const term = createTerm()
  term.feed("Hello, world!")
  expect(term).toContainText("Hello, world!")
  term.close()
})

test("bold text renders as bold", () => {
  const term = createTerm()
  term.feed("\x1b[1mBold\x1b[0m Normal")
  expect(term).toBeBoldAt(0, 0)
  expect(term).not.toBeBoldAt(0, 5)
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
