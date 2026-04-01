# FAQ

## Do I need a real terminal to run tests?

No. Termless runs entirely headless with in-process terminal emulators. There is no display, no window, no GPU required. Tests run on bare CI machines, containers, and SSH sessions.

## Which backend should I use?

**Start with the default.** `@termless/test` ships with xterm.js, which covers most testing needs. If you need higher fidelity:

| Backend | When to use it |
|---------|---------------|
| **xterm.js** (default) | General-purpose testing. Ships with `@termless/test`. |
| **vterm.js** | Full standards compliance. 100% [terminfo.dev](https://terminfo.dev) coverage. Best for conformance testing. |
| **Ghostty** | Test against Ghostty's VT parser specifically. |
| **vt100** | Zero native dependencies. Pure TypeScript. Good for environments where WASM or native modules are problematic. |

See [Backend Capabilities](/guide/backends) for a full feature comparison.

## Can I test Go/Rust/Python TUI apps?

Yes. Termless spawns any process via PTY -- it doesn't care what language the app is written in. If it runs in a terminal, Termless can test it:

```typescript
await term.spawn(["./my-go-app"])         // Go (Bubbletea, etc.)
await term.spawn(["./target/release/app"]) // Rust (Ratatui, etc.)
await term.spawn(["python", "-m", "myapp"]) // Python (Textual, etc.)
```

See [Recipes](/guide/recipes) for complete examples.

## How is this different from pexpect?

pexpect matches text patterns on a raw byte stream. It has no understanding of the terminal -- it can't tell you what color a character is, whether text is bold, or where the cursor is.

Termless runs a real terminal emulator in-process. You get structured access to the full terminal state: cell attributes, cursor position, terminal modes, scrollback history, and more.

See [Comparison](/guide/comparison) for a detailed breakdown.

## Does it work with Jest?

The custom matchers (`toBeBold()`, `toContainText()`, etc.) are built for Vitest. However, `@termless/core` is framework-agnostic -- you can use the Terminal API directly with any test runner:

```typescript
// Works with any test framework
import { createTerminal } from "@termless/core"
import { createXtermBackend } from "@termless/xtermjs"

const term = createTerminal({ backend: createXtermBackend(), cols: 80, rows: 24 })
term.feed("Hello")

// Use your framework's built-in assertions
assert(term.screen.getText().includes("Hello"))
assert(term.cell(0, 0).bold === false)
```

## Can I use it without Vitest?

Yes. `@termless/core` is standalone -- no test framework dependency. You get the full Terminal API (feed, spawn, screen, cell, cursor, screenshots) and can use whatever assertion library you prefer. The `@termless/test` package adds Vitest-specific matchers and fixtures on top.

## How do I test on CI?

Termless needs no display server. Add it to your CI pipeline the same way you'd run any Node.js/Bun test:

```yaml
# GitHub Actions
- run: bun vitest run
  # No xvfb, no DISPLAY, no Docker-in-Docker
```

See [Recipes](/guide/recipes#ci-integration) for full CI configuration examples.

## What about Windows?

PTY features (`term.spawn()`) require a Unix PTY and only work on macOS and Linux. In-memory testing (`term.feed()`) and all pure backends work everywhere, including Windows.

## How do I debug failing tests?

Three approaches, from quick to thorough:

**1. Screenshot to SVG** -- save the terminal state as a visual snapshot:

```typescript
import { writeFileSync } from "node:fs"

// Inside a failing test:
writeFileSync("/tmp/debug.svg", term.screenshotSvg())
```

**2. Print the text** -- dump what the terminal actually contains:

```typescript
console.log(term.screen.getText())
```

**3. Debug logging** -- enable verbose output for the Termless internals:

```bash
DEBUG=termless:* bun vitest run tests/my-test.ts
```

## How fast are the tests?

In-memory tests (feed ANSI data, assert on state) typically run in under 1ms each. PTY tests that spawn real processes are slower -- startup time depends on the application, but Termless adds negligible overhead beyond process launch.

## Can I test multiple backends in the same test suite?

Yes. Use `createTestTerminalByName()` to run the same test logic against different backends:

```typescript
const backends = ["xtermjs", "vterm", "ghostty"]

for (const name of backends) {
  test(`renders bold on ${name}`, async () => {
    const term = await createTestTerminalByName({ backendName: name })
    term.feed("\x1b[1mBold\x1b[0m")
    expect(term.cell(0, 0)).toBeBold()
  })
}
```

See [Multi-Backend Testing](/guide/multi-backend) for patterns and strategies.

## Does Termless support mouse events?

Yes. Send SGR mouse events with `click()` and `dblclick()`:

```typescript
term.click(10, 5)                      // Single click at column 10, row 5
await term.dblclick(10, 5)             // Double-click
term.click(10, 5, { ctrl: true })      // Ctrl+click
```

The target app must enable mouse tracking for these events to be received. See [Best Practices](/guide/best-practices#mouse-interaction) for details.
