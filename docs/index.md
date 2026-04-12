---
layout: home
title: Termless -- Headless Terminal Testing
description: Like Playwright, but for terminal apps. Test TUIs with in-process emulators -- assert on cells, colors, cursor, scrollback, and modes. 10 backends, 21+ matchers.

hero:
  name: "Termless"
  text: "Headless terminal testing"
  tagline: "Terminal apps are hard to test — no DOM to inspect, just invisible escape sequences. Termless gives you a real terminal emulator in-process with full access to cells, colors, cursor, and modes. Like Playwright, but for terminals."
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/beorn/termless

features:
  - title: Terminal Internals
    details: "Access scrollback, cursor state, cell colors, terminal modes, alt screen, resize behavior — everything that's invisible to string matching."
  - title: Cross-Terminal Conformance
    details: "Run the same tests against 10 backends. Find where xterm.js and Ghostty disagree on emoji width, color palettes, key encoding, and scroll behavior."
  - title: Recording & Playback
    details: "Record terminal sessions as .tape files. Play back as GIF, animated SVG, APNG, or asciicast. Cross-terminal comparison in one command. Like VHS, but headless and multi-backend."
  - title: Composable Selectors
    details: "screen, scrollback, buffer, viewport, row, cell, range. Separate WHERE to look from WHAT to assert. 21+ matchers for text, style, cursor, modes."
  - title: SVG & PNG Screenshots
    details: "Generate terminal screenshots as SVG or PNG. No Chromium, no native dependencies. Colors, bold, italic, cursor — all rendered. PNG via optional @resvg/resvg-js."
  - title: Fast & Headless
    details: "Pure in-process terminal emulation. Under 1ms per unit-style test. No Chromium, no ffmpeg, no subprocesses. GIF and APNG output via pure JS encoders."
---

## Quick Start

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

```typescript
import { test, expect } from "vitest"
import { createTestTerminal } from "@termless/test"

// ANSI helpers — real apps use @silvery/ag-term or @silvery/ansi, these are just for test data
const BOLD = (s: string) => `\x1b[1m${s}\x1b[0m`
const GREEN = (s: string) => `\x1b[38;2;0;255;0m${s}\x1b[0m`

test("inspect what string matching can't see", () => {
  // Creates an xterm.js terminal by default. Ghostty, Alacritty, WezTerm, vt100,
  // and Peekaboo backends are also available — see Multi-Backend Testing below.
  const term = createTestTerminal({ cols: 40, rows: 3 })

  // Simulate a build pipeline — 4 lines overflow a 3-row terminal
  term.feed("Step 1: install\r\n")
  term.feed(`Step 2: ${GREEN("build ok")}\r\n`)
  term.feed(`Step 3: ${BOLD("test")}\r\n`)
  term.feed("Step 4: deploy")

  // Region selectors — screen, scrollback, buffer
  expect(term.scrollback).toContainText("install") // scrolled off, still in history
  expect(term.screen).toContainText("deploy") // visible area
  expect(term.buffer).toContainText("install") // everything (scrollback + screen)
  expect(term.row(0)).toHaveText("Step 2: build ok") // specific row

  // Cell styles — colors that getText() can't see
  expect(term.cell(0, 8)).toHaveFg("#00ff00") // "build ok" is green
  expect(term.cell(1, 8)).toBeBold() // "test" is bold

  // Scroll up, then assert on viewport
  term.backend.scrollViewport(1)
  expect(term.viewport).toContainText("install")

  // Resize — verify content survives
  term.resize(20, 3)
  expect(term.screen).toContainText("deploy")

  // Terminal state — window title, cursor, modes
  term.feed("\x1b]2;Build Pipeline\x07") // OSC 2 — set window title
  expect(term).toHaveTitle("Build Pipeline")
  expect(term).toHaveCursorAt(14, 2) // after "Step 4: deploy"
  expect(term).toBeInMode("autoWrap") // default mode
  expect(term).not.toBeInMode("altScreen") // not in alternate screen
})
```

## Recording & Playback

Record terminal sessions and play them back as animated output -- no ffmpeg, no Chromium, no external tools:

```bash
# Record a command to a tape file
$ termless record -o demo.tape ls -la

# Play back as an animated GIF
$ termless play -o demo.gif demo.tape

# Cross-terminal comparison — same tape, different backends
$ termless play -b vterm,ghostty --compare side-by-side demo.tape
```

Output formats: GIF, animated SVG, APNG, PNG, asciicast v2 -- all rendered with pure JS encoders. See [Recording & Playback](/guide/recording) for full details.

## Why Not Just Assert on Strings?

String assertions on terminal output break constantly:

- **ANSI codes** make string matching fragile (`\x1b[1m` litters your test)
- **Trailing whitespace** differs between terminals and runs
- **Wide characters** (emoji, CJK) occupy 2 columns but 1 string position
- **Colors** are invisible in `getText()` — a red error looks the same as a green success

Termless gives you **structured access** to the terminal buffer. Assert on what matters:

```typescript
// Instead of fragile string matching...
expect(output).toContain("\x1b[1;31mError\x1b[0m")

// ...assert on terminal state
expect(term.screen).toContainText("Error")
expect(term.cell(0, 0)).toBeBold()
expect(term.cell(0, 0)).toHaveFg("#ff0000")
expect(term).toBeInMode("altScreen")
expect(term).toHaveTitle("my-app")
```

## Which Package Do I Need?

| You want to...                                  | Install                                                   |
| ----------------------------------------------- | --------------------------------------------------------- |
| Test a terminal UI in Vitest                    | `@termless/test` (includes xterm.js backend)              |
| Use the core Terminal API without test matchers | `@termless/core` + a backend (`@termless/xtermjs`, etc.)  |
| Test against Ghostty's VT parser                | `@termless/ghostty`                                       |
| Test with a zero-dependency emulator            | `@termless/vt100`                                         |
| Take SVG/PNG screenshots                        | Built into `@termless/core` (PNG needs `@resvg/resvg-js`) |
| Spawn and test real processes via PTY           | Built into `@termless/core` (used via any backend)        |
| Automate a real terminal app (OS-level)         | `@termless/peekaboo`                                      |
| Use the CLI or MCP server                       | `@termless/cli`                                           |

Most users only need `@termless/test` -- it includes everything for writing Vitest terminal tests with the xterm.js backend. Add extra backend packages only if you want [multi-backend testing](/guide/multi-backend).

### Backend Management CLI

```bash
$ bunx termless backends                       # List all backends and install status
$ bunx termless backends install               # Install default backends
$ bunx termless backends install ghostty       # Install a specific backend
$ bunx termless doctor                         # Health check installed backends
```

### Two Ways to Choose a Backend

```typescript
// 1. Factory function (explicit, sync)
import { createXtermBackend } from "@termless/xtermjs"
const term = createTerminal({ backend: createXtermBackend() })
```

```typescript
// 2. String name via registry (async — handles WASM/native init)
import { backend } from "@termless/core"
const b = await backend("ghostty")
const term = createTerminal({ backend: b })
```

## Backends

Every backend wraps a real terminal emulator and implements the same interface — write once, test everywhere:

| Backend            | Engine                  | Highlights                                                                         | Type   |
| ------------------ | ----------------------- | ---------------------------------------------------------------------------------- | ------ |
| **xtermjs**        | @xterm/headless 5.5     | VS Code's terminal. Most mature, zero native deps.                                 | JS     |
| **ghostty**        | ghostty-web 0.4         | Modern GPU-accelerated parser. Best standards compliance, Kitty keyboard protocol. | WASM   |
| **vt100**          | (built-in)              | Pure TypeScript, zero dependencies. Fastest backend, ideal for CI.                 | JS     |
| **alacritty**      | alacritty_terminal 0.26 | Rust parser via napi-rs. Strong reflow behavior.                                   | Native |
| **wezterm**        | tattoy-wezterm-term     | Broadest protocol support: sixel graphics, semantic prompts, Kitty keyboard.       | Native |
| **peekaboo**       | (OS automation)         | Tests against a real terminal app via OS accessibility APIs. macOS only.           | OS     |
| **vt100-rust**     | vt100 0.15 (Rust)       | Reference Rust implementation — cross-validates the TS vt100 backend.              | Native |
| **libvterm**       | libvterm (neovim)       | Neovim's C VT parser via WASM. Different implementation = different bugs found.    | WASM   |
| **ghostty-native** | libghostty-vt 1.3       | Native Ghostty via Zig N-API bindings. Same parser as ghostty, no WASM overhead.   | Native |
| **kitty**          | kitty (C, GPL source)   | Kitty's parser built from source. Only backend with Kitty graphics protocol.       | Native |

See [Backend Capabilities](/guide/backends) for the full feature matrix, per-backend details, and usage examples (factory function + string name).

## Packages

| Package                    | Description                                                             |
| -------------------------- | ----------------------------------------------------------------------- |
| `@termless/core`           | Core: Terminal API, PTY, SVG/PNG screenshots, key mapping, region views |
| `@termless/test`           | Vitest integration: 21+ matchers, fixtures, snapshot serializer         |
| `@termless/xtermjs`        | xterm.js backend via `@xterm/headless`                                  |
| `@termless/ghostty`        | Ghostty backend via `ghostty-web` WASM                                  |
| `@termless/vt100`          | Pure TypeScript VT100 emulator, zero native deps                        |
| `@termless/alacritty`      | Alacritty backend via `alacritty_terminal` (napi-rs)                    |
| `@termless/wezterm`        | WezTerm backend via `wezterm-term` (napi-rs)                            |
| `@termless/peekaboo`       | OS-level terminal automation (xterm.js + real app)                      |
| `@termless/vt100-rust`     | Rust vt100 crate via napi-rs (reference implementation)                 |
| `@termless/libvterm`       | neovim's libvterm via Emscripten WASM                                   |
| `@termless/ghostty-native` | Native Ghostty backend via Zig N-API bindings (libghostty-vt)           |
| `@termless/kitty`          | Kitty VT parser built from GPL source (not distributed)                 |
| `@termless/cli`            | CLI tools + MCP server for AI agents                                    |

## How It Compares

| Feature               | Termless                              | Manual string testing | Playwright     |
| --------------------- | ------------------------------------- | --------------------- | -------------- |
| Speed                 | &lt;1ms/test (in-memory, no PTY)      | &lt;1ms/test          | ~100ms+/test   |
| Terminal internals    | Scrollback, cursor, modes, cell attrs | None                  | N/A            |
| ANSI awareness        | Full (colors, bold, cursor)           | None                  | N/A            |
| Multi-backend         | 10 terminal emulators                 | N/A                   | 3 browsers     |
| Protocol capabilities | Kitty, sixel, OSC 8, reflow           | None                  | N/A            |
| Wide char support     | Cell-level width tracking             | Broken                | N/A            |
| Screenshots           | SVG + PNG (no Chromium)               | None                  | PNG (Chromium) |
| PTY support           | Spawn real processes                  | Manual                | N/A            |

## See Also

Termless is part of the terminal tools ecosystem:

- **[vterm.js](https://github.com/beorn/vterm)** — full-featured terminal emulator (161/161 features on [terminfo.dev](https://terminfo.dev)), included as `@termless/vterm`
- **[vt100.js](https://github.com/beorn/vterm/tree/main/packages/vt100)** — VT220-era baseline emulator, included as `@termless/vt100`
- **[terminfo.dev](https://terminfo.dev)** — terminal feature compatibility database, powered by Termless
- **[Silvery](https://silvery.dev)** — React framework for terminal UIs (30+ components, incremental rendering)
- **[Flexily](https://beorn.codes/flexily)** — pure JS flexbox layout engine (Yoga-compatible, zero WASM)
- **[Loggily](https://loggily.dev)** — debug + structured logging + tracing in one library

<style>
:root {
  --vp-home-hero-name-color: transparent;
  --vp-home-hero-name-background: -webkit-linear-gradient(120deg, #41d1ff 30%, #bd34fe 100%);
}
</style>
