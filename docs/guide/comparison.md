---
title: Comparison
description: How Termless compares to pexpect, expect, Playwright, and other terminal testing approaches -- structured state vs byte streams.
---

# Comparison

How Termless compares with other approaches to testing terminal applications.

## Termless vs pexpect / expect

pexpect (Python) and expect (Tcl) match text patterns on a raw byte stream. They work, but they operate without any understanding of the terminal as a 2D grid.

| Aspect            | pexpect / expect        | Termless                                    |
| ----------------- | ----------------------- | ------------------------------------------- |
| Language          | Python / Tcl            | TypeScript                                  |
| Terminal model    | None -- raw byte stream | Full in-process emulator                    |
| Text matching     | Regex on output bytes   | Structured cell-level access                |
| Style assertions  | Not possible            | `toBeBold()`, `toHaveFg("#ff0000")`         |
| Cursor state      | Not available           | Position, visibility, style                 |
| Terminal modes    | Not available           | Alt screen, bracketed paste, mouse tracking |
| Scrollback        | Not available           | `term.scrollback`, line count               |
| Screenshots       | Not supported           | SVG and PNG snapshots                       |
| Speed (in-memory) | N/A (process-only)      | Sub-millisecond                             |
| Multiple backends | Single PTY              | 11 backends                                 |
| Flakiness         | Timing-sensitive regex  | Auto-retry matchers with lazy views         |

**When to prefer pexpect:** You're in a Python-only environment and only need basic output matching. pexpect is also useful for non-terminal process automation (serial ports, SSH sessions) where Termless's terminal model isn't relevant.

## Termless vs Playwright + ttyd

You can test terminal apps by running them inside [ttyd](https://github.com/tsl0922/ttyd) (a web-based terminal) and automating the browser with Playwright. This works but adds significant complexity:

| Aspect                | Playwright + ttyd                          | Termless                                          |
| --------------------- | ------------------------------------------ | ------------------------------------------------- |
| Architecture          | Browser + WebSocket + ttyd + PTY           | In-process emulator                               |
| Dependencies          | Chromium, ttyd, Node.js                    | Node.js or Bun only                               |
| Setup                 | Start ttyd server, launch browser, connect | `createTestTerminal()`                            |
| Speed                 | Seconds per test (browser overhead)        | Sub-millisecond (in-memory)                       |
| CI requirements       | Headless browser, display server           | Nothing extra -- runs headless                    |
| Cell-level assertions | Parse DOM from xterm.js canvas             | Native `term.cell(r, c)` API                      |
| Screenshot testing    | Browser screenshots (non-deterministic)    | Deterministic SVG/PNG                             |
| Debugging             | Browser DevTools                           | `term.screenshotSvg()` or `term.screen.getText()` |

**When to prefer Playwright + ttyd:** You need to test a web-based terminal specifically (e.g., verifying your xterm.js integration renders correctly in a real browser).

## Termless vs tmux send-keys

Shell scripts that use `tmux send-keys` and `tmux capture-pane` can drive terminal apps:

```bash
tmux new-session -d -s test './my-app'
tmux send-keys -t test 'q' Enter
tmux capture-pane -t test -p | grep "Expected output"
```

| Aspect            | tmux send-keys               | Termless                         |
| ----------------- | ---------------------------- | -------------------------------- |
| Language          | Shell script                 | TypeScript                       |
| Assertions        | grep / diff on captured text | 21+ typed matchers               |
| Style checking    | Not possible                 | Bold, italic, colors, underline  |
| Error messages    | "grep failed"                | Diff showing expected vs actual  |
| Test organization | Ad-hoc scripts               | Standard test framework (Vitest) |
| Parallelism       | Manual session management    | Automatic per-test isolation     |
| CI integration    | Custom scripts               | Standard `bun vitest run`        |

**When to prefer tmux:** Quick one-off smoke tests in a shell script, or when the test environment only has tmux available.

## Termless vs Raw String Assertions

The simplest approach: capture stdout and match on strings.

```typescript
// Raw string assertion
const { stdout } = await exec("./my-cli --help")
expect(stdout).toContain("Usage:")
```

| Aspect              | String assertions           | Termless                                      |
| ------------------- | --------------------------- | --------------------------------------------- |
| What you test       | stdout text                 | Full terminal state                           |
| ANSI handling       | Escape codes pollute output | Parsed by emulator -- invisible to assertions |
| Colors and styles   | Not possible                | `toHaveFg()`, `toBeBold()`                    |
| Interactive apps    | Not possible (no stdin)     | `term.press()`, `term.click()`                |
| Cursor position     | Not available               | `toHaveCursorAt(x, y)`                        |
| Layout verification | Fragile string matching     | `toMatchLines()`, row/cell selectors          |

**When to prefer raw strings:** Non-interactive CLI tools where you only care about text output. If the program prints a result and exits, `stdout` capture is simpler and faster.

## When NOT to Use Termless

Termless is designed for testing terminal applications. It's the wrong tool for:

- **Non-interactive CLI output.** If you just need to check that `my-tool --version` prints `1.0.0`, capture stdout directly. No terminal emulator needed.
- **Pure API testing.** If you're testing business logic that happens to live in a TUI app, test the logic directly -- don't route through the terminal layer.
- **Web application testing.** Use Playwright or Cypress. Termless tests terminal apps, not browsers.
- **Performance benchmarking.** Termless adds emulator overhead. Benchmark your app's rendering pipeline directly, not through an intermediary.

## Summary

| Approach                  | Best for                                                              |
| ------------------------- | --------------------------------------------------------------------- |
| **Termless**              | TUI testing with rich assertions (colors, cursor, modes, screenshots) |
| **pexpect**               | Python-based process automation, serial ports                         |
| **Playwright + ttyd**     | Testing web-based terminal UIs                                        |
| **tmux send-keys**        | Quick shell-script smoke tests                                        |
| **Raw string assertions** | Non-interactive CLI output                                            |
