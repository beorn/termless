# Why Termless?

## The Problem

Terminal apps are hard to test. Unlike web apps — where you can spin up a headless browser, click buttons, and assert on DOM elements — terminal apps render invisible escape sequences to a stream of bytes. There's no "DOM" to inspect, no "element" to click, no "screenshot" to compare.

Existing tools like `expect` and `pexpect` match on raw text output, which is fragile: they break on color changes, layout shifts, or timing differences. They can't tell you what color a character is, whether the cursor is visible, or if the terminal is in alternate screen mode.

**Termless solves this.** It gives you a real terminal emulator running in-process — with full access to the screen buffer, cell attributes, cursor state, and terminal modes. You can write assertions like "cell (5, 10) is bold red on black" or "the scrollback has 150 lines." No regex matching on byte streams.

## What It Enables

**Cross-terminal conformance testing.** Write your tests once, run them against 10 different terminal emulators (xterm.js, Ghostty, Kitty, Alacritty, WezTerm, and more). Find where they disagree on emoji width, color handling, or keyboard encoding.

**TUI regression testing.** Test your terminal UI like you'd test a web app: render a component, send keystrokes, assert on the screen state. Catch visual regressions before they ship.

**Terminal emulator development.** If you're building a terminal emulator, Termless gives you a conformance test suite out of the box. The same tests that power [terminfo.dev](https://terminfo.dev) can validate your implementation.

## How It's Different from expect/pexpect

| | expect/pexpect | Termless |
|---|---|---|
| Matching | Regex on raw byte stream | Structured access to cells, colors, cursor, modes |
| Speed | Spawns processes, waits for output | In-process emulation, typically < 1ms per test |
| Cross-terminal | Tests one terminal | Tests against 10+ backends |
| What you can assert | Text appeared in output | Cell attributes, cursor position, scrollback, terminal modes |
| Flakiness | Timing-dependent | Deterministic (no I/O, no subprocesses) |

## Who It's For

- **TUI developers** building apps with React (Silvery/Ink), Go (Bubbletea), Rust (Ratatui), or Python (Textual)
- **Terminal emulator authors** validating VT/ECMA-48/xterm compliance
- **CLI tool authors** who want visual regression tests beyond string matching
- **QA engineers** testing terminal-based workflows
