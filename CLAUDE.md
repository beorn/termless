# Termless - Headless Terminal Library

Pluggable headless terminal library for cross-terminal TUI testing. Composable region selectors + matchers. Write tests once, run against any backend.

## Documentation Site

VitePress docs at `docs/` — deployed to termless.dev via GitHub Pages.

- **Source**: `docs/` (edit files here)
- **Config**: `docs/.vitepress/config.ts`
- **Build**: `bun run docs:build` (runs `vitepress build docs`)
- **Build output**: `docs/.vitepress/dist/` (gitignored)
- **Logo**: `docs/public/logo.svg`
- **CI**: `.github/workflows/docs.yml` — auto-deploys on push to main

**Do NOT create or edit `docs/site/`** — docs live directly in `docs/`.

## Ruling: which packages keep xterm.js, and why

vterm is the sole production shell **guest** (`@si/vterm/21016-terminal-runtime`). That ruling settles the guest seam and nothing else, so the remaining xterm.js consumers were each checked rather than swept. Recorded here so the next inventory does not re-open a settled question — or quietly close an unsettled one.

**`@termless/web-player` — KEEPS xterm.js. Settled, on merit.**
It imports `@xterm/xterm` (the full browser package, not `@xterm/headless`) and calls `terminal.open(element)` to mount into the DOM. vterm cannot do this and is not meant to: it has no DOM renderer at all — no `document`/`HTMLElement`/`canvas` references anywhere in `packages/vterm/src`, no `browser` field, a single export. Browser playback is a different problem from being a terminal emulator, and the two packages are not substitutes. This is a keep with a reason, not a deferral.

**`@termless/peekaboo` — MOVED to vterm (2026-08-04). Settled, and not by implication.**
It used `createXtermBackend` for its **data path** only (`getText`/`getCell`/`getCursor`) behind a real terminal app — the same `TerminalBackend` seam as `packages/cli/src/session.ts`, not a DOM dependency. That is what discriminates it from web-player: web-player's keep is _structural_ (vterm has no DOM renderer, so `terminal.open(element)` is impossible), while peekaboo's "merit" was only that nobody had checked.

The divergence bites harder here than anywhere else in the codebase. peekaboo exists to be authoritative about what a real terminal app is doing, and the xterm adapter hardcodes cursor shape to `block` and visibility to `visible` — so it reported a visible block cursor for an app that had hidden the cursor and asked for a beam. Confidently wrong about precisely the thing peekaboo is consulted for. Guarded by `packages/peekaboo/tests/data-path-vterm.test.ts`, which runs everywhere because `visual: false` needs no OS automation.

Ruled by @chief on the evidence rather than swept along with the session default — the distinction Track 2 exists to preserve.

_Fixed at the same time:_ peekaboo declared `@termless/xtermjs` as a peer dependency while importing it by relative path (`../../xtermjs/src/backend.ts`), and carried a direct `@xterm/headless` dependency it never imported. The peer dep now names `@termless/vterm` and the unused direct dependency is gone.

## Packages

| Package                | Description                                                                | Runtime       | Status                 |
| ---------------------- | -------------------------------------------------------------------------- | ------------- | ---------------------- |
| `@termless/core`       | Core: types, Terminal, PTY, SVG/PNG screenshots, key mapping, region views | Bun + Node.js | Active                 |
| `@termless/xtermjs`    | xterm.js backend (@xterm/headless)                                         | Bun + Node.js | Active                 |
| `@termless/ghostty`    | Ghostty backend (ghostty-web WASM)                                         | Bun + Node.js | Active                 |
| `@termless/vt100`      | Pure TypeScript VT100 emulator (zero native deps)                          | Bun + Node.js | Active                 |
| `@termless/vterm`      | Full-featured vterm.js backend (100% terminfo.dev coverage)                | Bun + Node.js | Active                 |
| `@termless/alacritty`  | Alacritty backend (alacritty_terminal via napi-rs)                         | Bun + Node.js | Needs Rust build       |
| `@termless/wezterm`    | WezTerm backend (wezterm-term via napi-rs)                                 | Bun + Node.js | Needs Rust build       |
| `@termless/peekaboo`   | OS-level terminal automation (vterm data path + real app)                  | Bun + Node.js | Active (macOS)         |
| `@termless/web-player` | Browser xterm.js player for `.cast` / `.tape` recordings                   | Browser       | Active                 |
| `@termless/vt100-rust` | Rust vt100 crate via napi-rs                                               | Bun + Node.js | Needs Rust build       |
| `@termless/libvterm`   | neovim's libvterm via WASM                                                 | Bun + Node.js | Needs Emscripten build |
| `@termless/kitty`      | Kitty VT parser built from GPL source (not distributed)                    | Bun + Node.js | Needs C build          |
| `@termless/test`       | Vitest integration: matchers, fixtures, snapshots                          | Bun + Node.js | Active                 |
| `@termless/cli`        | CLI + MCP server                                                           | Bun + Node.js | Active                 |

### Runtime Notes

- **PTY support** (`spawnPty` / `terminal.spawn()`) uses Bun's native PTY on Bun, and `node-pty` on Node.js. On Node.js, install `node-pty` as a peer dependency: `npm install node-pty`.
- **Peekaboo** uses OS automation (osascript, screencapture) — macOS only on both runtimes.
- **Pure backends** (xtermjs, ghostty, vt100, vterm) have zero runtime-specific dependencies and work on both Bun and Node.js.
- **napi-rs backends** (alacritty, wezterm, vt100-rust) load native `.node` binaries — work on any runtime that supports N-API.
- **WASM backends** (ghostty, libvterm) require async initialization to load the WASM module.

## Architecture

```
@termless/test (Vitest matchers + fixtures)
  └── @termless/core (TerminalBackend interface + PTY + SVG/PNG + region views)
        ├── @termless/xtermjs (@xterm/headless)
        ├── @termless/ghostty (ghostty-web WASM)
        ├── @termless/vt100 (pure TypeScript — VT100-era)
        ├── @termless/vterm (pure TypeScript — full standards)
        ├── @termless/alacritty (Rust napi-rs)
        ├── @termless/wezterm (Rust napi-rs)
        ├── @termless/vt100-rust (Rust napi-rs)
        ├── @termless/libvterm (C via Emscripten WASM)
        ├── @termless/kitty (C built from GPL source)
        ├── @termless/peekaboo (vterm data path + OS automation)
        └── @termless/web-player (@xterm/xterm browser playback)
```

## Commands

```bash
bun test                              # Run all tests
bun cli backend list                  # List backends and install status
bun cli backend install [names...]    # Install or upgrade backends
bun cli backend update                # Check upstream versions
bun cli doctor                        # Health check installed backends
```

### CI matrix

CI runs the test suite on **darwin-arm64, darwin-x64, linux-x64-gnu, linux-arm64-gnu, and win32-x64-msvc** (`.github/workflows/ci.yml`). A dedicated `ghostty-canvas` job exercises `@napi-rs/canvas` + `ghostty-web` on every platform — proves the NAPI binding loads and the renderer produces valid PNG bytes outside macOS.

The dHash regression tolerance is platform-aware via `TERMLESS_CI_PLATFORM` (set per matrix entry). Skia's font hinting differs across platforms (CoreText / libfontconfig / DirectWrite), so the per-platform ceiling lives in `packages/ghostty/tests/cross-platform.test.ts` — darwin 7/64, linux + win32 12/64. The canonical-Ghostty-reference test in `packages/ghostty/tests/render.test.ts` runs darwin-only (Mac-only font path + gold reference); non-darwin runners filter it out via vitest `--testNamePattern`.

## Backend Registry

`backends.json` pins backend versions (like Playwright's `browsers.json`). The registry in `src/backend/backends.ts` provides:

- `backend("ghostty")` — async resolution (handles WASM/native init)
- `backends()` — list all backend names
- `isReady(name)` — check if installed and built
- `entry(name)` — get manifest entry for a backend
- `manifest()` — get full manifest
- `buildBackend(name)` — build native/WASM backends

Two ways to choose a backend:

```typescript
// Factory function (explicit, sync)
import { createXtermBackend } from "@termless/xtermjs"
const term = createTerminal({ backend: createXtermBackend() })
```

```typescript
// By name (async — handles WASM/native init)
import { backend } from "@termless/core"
const b = await backend("ghostty")
const term = createTerminal({ backend: b })
```

## Code Style

Factory functions, `using` cleanup, no classes, no globals. Same conventions as km.

## Key Types

- `TerminalBackend` -- interface all backends implement (~18 methods)
- `Terminal` -- read contract for backends (getText, getTextRange, getCell, getRow, getRows, getCursor, getMode, getTitle, getScrollback)
- `TestTerminal` -- high-level API: backend + optional PTY + search + screenshots + region selectors + mouse input (click/dblclick)
- `Region` -- a lazy region view that recomputes offsets on every access (getText(), getLines(), containsText())
- `CellView` -- a single cell with positional context (row, col, fg, bg, bold, italic, etc.)
- `Row` -- a row (extends Region) with row number and cellAt(col) access
- `Cell` -- single terminal cell with text, colors, and style flags

## Composable API Pattern

```
WHERE (region selector)     +  WHAT (matcher)
─────────────────────────      ──────────────
term.screen                    toContainText("x")
term.cell(r, c)                toBeBold()
term (Terminal)                toHaveCursorAt(x, y)
```

All text and terminal matchers accept an optional `{ timeout: number }` as the last argument for auto-retry:

```typescript
await expect(term.screen).toContainText("ready", { timeout: 15000 })
```

This replaces `waitFor()` (now deprecated) with a more idiomatic pattern.

Region selectors: `term.screen`, `term.scrollback`, `term.buffer`, `term.viewport`, `term.row(n)`, `term.cell(r, c)`, `term.range(r1, c1, r2, c2)`, `term.firstRow()`, `term.lastRow()`.

## Buffer Diff

```typescript
import { diffBuffers } from "@termless/core"

const changes = diffBuffers(oldBuffer, newBuffer)
// Array of { row, col, oldCell, newCell } — only changed cells
```

## Mock Timer

```typescript
import { createMockTimer } from "@termless/core"

const timer = createMockTimer()
timer.setTimeout(fn, 1000)
timer.advanceTime(1000) // Fires the callback synchronously
timer.advanceTime(500) // Partial advance
```

## Recording & Replay

One event vocabulary, two containers. **`Recording`** (`@termless/core/io`,
`src/io/recording.ts`) is the io shape — a header plus `Event[]`, one track.
**`Trace`** (`src/recording/recording.ts`) is the multi-track container —
`commands` intent, `io` truth, `frames` projection — over that same
vocabulary, integer-µs clock throughout. The old names — `Recording`,
`createRecording`, `readRecording`, `decodeAsciicast`/`encodeAsciicast` —
still work but now name the _Trace_ shape; they are `@deprecated` aliases
and wrappers, deleted at unterm phase A4a, when the root barrel's
`Recording` becomes the io shape.

On disk it is the `.tty`/`.ttyz` format: one format, two encodings (live
bundle directory ⇄ sealed ZIP archive), one encoding-blind reader. Reference:
`docs/reference/formats/tty.md`.

Doors onto the io shape: `loadRecording`/`loadBundle` read a `.tty` bundle or
`.ttyz` archive; `readAsciicast`/`writeAsciicast` are the byte-symmetric
`.cast` pair (`o`/`i`/`m`/`r`, every drop tallied, never silent). Between
containers, `recordingFromTrace` maps a `Trace`'s `io` track onto an io
`Recording`, total on every row; `traceFromRecording`
(`src/recording/trace-bridges.ts`) goes the other way and tallies the events
with no `io`-track row shape (`control`, `mark`, `exit`) instead of dropping
them. Pure transforms — `trim`, `retime`, `filter`, `byType` — run over the
io `Recording` (`@termless/core/io`).

Every loader here follows two rules: `header.sourceResolution`
(`"us" | "ms" | "s"`) is declared from what the source actually recorded at,
never assumed; `Event.derived` marks only an event a loader _reconstructs_
from other evidence — a byte-for-byte capture never carries it.

```typescript
import { loadRecording, readAsciicast } from "@termless/core"

const rec = loadRecording("session.tty") // or "session.ttyz" — identical result
const cast = readAsciicast(castText) // .cast text, same io Recording shape
```

Codecs: `.cast` (asciicast v2 — io-shaped `readAsciicast`/`writeAsciicast`;
Trace-shaped deprecated `decodeAsciicast`/`encodeAsciicast`), `.tape`
(compiler input), `ttyrec` (import-only). Visual traces read/write through
`loadVisualTrace`/`writeVisualTrace`; the frame tracer's live directory is
itself a valid `.tty` bundle.
