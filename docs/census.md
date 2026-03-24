# Terminal Census

<div style="text-align: center; padding: 2em 0;">
  <h2 style="font-size: 1.8em; margin-bottom: 0.5em;">
    <a href="https://terminfo.dev" style="text-decoration: none;">Terminfo.dev &rarr;</a>
  </h2>
  <p style="font-size: 1.1em; color: var(--vp-c-text-2);">
    Can your terminal do that?<br/>
    Interactive feature support matrix for terminal emulators.
  </p>
</div>

## What Is the Census?

The terminal census is an automated test suite that probes headless terminal backends for feature support — SGR styling, cursor movement, modes, scrollback, text handling, erase operations, and protocol extensions. Each probe writes escape sequences and inspects the resulting terminal state to determine whether a feature works correctly.

Census probes and their results are maintained in the **[terminfo.dev](https://github.com/beorn/terminfo.dev)** repository. Visit **[terminfo.dev](https://terminfo.dev)** for the full interactive matrix with hover tooltips, category filters, and backend comparison.

## How It Works

1. **Probes** — small functions that write ANSI/VT sequences to a backend and assert on terminal state (cell attributes, cursor position, mode flags, scrollback).
2. **Backends** — headless terminal emulator libraries (JS, Rust, C, WASM) implementing the `TerminalBackend` interface from `@termless/core`.
3. **Matrix** — results are aggregated into a feature x backend grid. Each cell is *yes*, *no*, or *partial* (with notes explaining the gap).

The census uses Termless backends to run probes, but the probe definitions and result data live in terminfo.dev.

## Relationship to Termless

Termless provides the **backend abstraction layer** that makes the census possible — a uniform `TerminalBackend` interface across xterm.js, Ghostty, vt100, Alacritty, WezTerm, and others. The census was originally part of the Termless repo but has moved to [terminfo.dev](https://github.com/beorn/terminfo.dev) as a standalone project.

For backend capabilities relevant to **testing** (as opposed to the broader terminal feature matrix), see [Backend Capabilities](/guide/backends) and [Cross-Backend Conformance](/advanced/compat-matrix).
