# Changelog

## Unreleased

### Added

- **`Trace` is now the multi-track captured-session container** (`src/recording/recording.ts`), split from the single-track `Recording`, which is reserved for the io shape (`@termless/core/io`): `RecordingHeader.theme`, `RecordingHeader.sourceResolution` and `Event.derived` are new on the io side, and `recordingFromTrace`/`traceFromRecording` (`src/recording/trace-bridges.ts`) bridge the two, tallying what the other container cannot carry rather than dropping it.
- **io transforms** (`@termless/core/io`): `trim`, `retime` and `filter` (paired with the `byType` predicate helper) are pure functions over an io `Recording` that compose, since each returns one.
- **`readAsciicast`/`writeAsciicast`** (`@termless/core`) are the io-shaped `.cast` pair: total on read for all four asciicast v2 event codes — including the `r` resize event the old codec used to mis-file as input — and byte-symmetric on write, tallying `mode`/`signal`/`exit` events instead of losing them; `parseAsciicast` now validates the event code and throws naming the malformed line.
- **`loadRecording`/`loadBundle`** (`@termless/core`) are the io-shaped `.tty`/`.ttyz` door: output/input frames keep their raw payload bytes with no UTF-8 decode, a recorded resize becomes a captured (non-`derived`) control event, and every member this slice does not load is tallied by path instead of silently skipped.
- **Golden asciicast fixtures** (`tests/asciicast/fixtures/`) pin today's parser/writer/codec behavior — eight `.cast` files covering a full header, interleaved markers, unicode/SGR, timing edges, JSON escapes and a generated 100-event trace — as a committed oracle ahead of the format changes above.

### Changed

- The golden `.cast` fixtures are pinned to LF on every checkout (`.gitattributes`) — a Windows runner previously read them back as CRLF and broke every byte-identity round-trip assertion.

### Deprecated

- `Recording`, `CreateRecordingInput` and `createRecording` (`@termless/core`) — renamed to `Trace`/`CreateTraceInput`/`createTrace`, kept as transparent aliases, removed at unterm phase A4a.
- `readRecording`/`readBundle` (`@termless/core`) — the Trace-shaped `.tty`/`.ttyz` readers; `loadRecording`/`loadBundle` are the io-shaped replacements, removed at unterm phase A4a.
- `decodeAsciicast`/`encodeAsciicast` (`@termless/core`) — now thin wrappers over `readAsciicast`/`writeAsciicast` plus the Trace bridges, removed at unterm phase A4a.

## 0.9.0 - 2026-09-01

### Added

- **The io module — the unterm primitives** (`@termless/core`): `Session`, `Event`/`OutputEvent`, `Emulator`, `Recording` and `pipe`, on a microsecond clock (`micros()`), are the vocabulary the rest of the package is being re-expressed in; `emulatorFromBackend()` adapts any `TerminalBackend`. See `src/io/README.md`.
- **Views over the Emulator** — `Emulator` carries its `scrollback` extent, and `createScreenView` / `createScrollbackView` / `createBufferView` / `createRangeView` / `createViewportView` read a `PictureReadable` (an Emulator) as well as the legacy `Terminal`; all five are exported from the root barrel.
- **io conformance seed** — `tests/io/conformance.test.ts` replays one event stream through the vterm and xterm.js emulators and compares screen, cursor, scrollback and, on a styled resize, every cell by painted RGB (`Color.index` is engine identity, never part of a verdict).
- **Conformance corpus** — the libvterm suite (MIT), a `resize` step verb that converts the reflow cases, and a gap ledger that names its engine: `vtermEngineIdentity()` and the `_engine` header fail the suite when a different vterm.js resolves than the one the rows were graded against.
- **`.tty` / `.ttyz` — one recording format, two encodings.** `.tty` is the live bundle directory (a manifest plus typed, declaratively-pathed members); `.ttyz` is the sealed, reproducible ZIP of the same members. `readRecording` accepts either and no consumer can tell which it was handed. The `hts1` io encoding decodes the session writer's binary journal natively, and a ttyrec import codec rides along. `docs/reference/formats/tty.md` is the normative reference and now also carries the live-read (session access) contract.
- **CLI recordings** — native recordings replay by track authority, recording bundles are canonical, and a native-source flag on another format is refused.
- **OSC 8 hyperlinks** — emulator-owned link URIs are carried through both the xterm and vterm guest cell adapters (fail-loud on an unresolvable link id); `termless` validates OSC 8 raw passthrough.
- **`@termless/vterm` projects nested terminal graphics**, and no longer advertises graphics it does not project.
- **`snapshotView()`** wraps a vterm-family `EngineSnapshot` as a `Terminal` read view, so region selectors and matchers run over a frozen snapshot exactly as over a live backend (a type-only dependency; core still imports no engine).
- **`termless` umbrella package** (the bare name, 0.9.0) — Effect-style subpaths `.`, `./contract`, `./fmt`, `./rec` and `./backends`; every subpath is a thin re-export of `@termless/core`, and only `./backends` knows more than one engine.

### Changed

- **`@termless/vterm` follows vterm.js 0.7.0** (`^0.7.0`), which retires seven gap-ledger rows: two scroll cases, Newline/Linefeed mode, DEC Auto Wrap, double-width/height rows, resize-shorter, and protected areas.
- **CLI sessions default to vterm**, the production engine, instead of the retired xterm.js reference, and an unknown backend name is refused instead of silently substituted. `@termless/peekaboo` and the `termless rec` live overlay run the production engine and shell guest on the data path.
- Phase A4 of the io migration is named on the deprecated 07-09 read-API names and on the `Cursor.x`/`Cursor.y` markers.
- **Node 24 is the floor for `@termless/cli` and the `termless` umbrella** — their `silvery` dependency (`^0.21.0`) ships `using` declarations and `AsyncDisposableStack`, which Node 23 cannot parse; the publishable-verify job runs Node 24 accordingly. `@termless/core` and the backends keep `>=23.6.0`. Bun is unaffected.

### Fixed

- **`@termless/cli` installs from a fresh clone again** — `silvery` `^0.16.6` → `^0.21.0` (the older bundle imported an undeclared `@silvery/ag-react` under Bun's export condition) and `loggily` `^0.4.0` → `^0.10.2` (the older range resolved to a package shipping TypeScript source); the root workspace now links the pure backends (`@termless/vt100`, `vt220`, `vterm`, `xtermjs`) so a standalone checkout resolves them by name.
- **`@termless/ghostty` bounds native canvas allocations.**
- **Cross-platform perceptual hashes** in the compare tools.
- **The terminal preserves unrelated escape prefixes**, and the corpus runner replays a file's preamble into segment state.
- CLI: the `termless` bin entry is committed executable, and the cursor probe keeps its nullable types.

### Removed

- **`.rec`** — deleted, not aliased (zero shipped artifacts existed); a frame trace becomes a valid `.tty` bundle by gaining a manifest, which the tracer now writes.
- The §9-naming pure type aliases in `@termless/core` and `@termless/vterm`, and `@termless/test`'s `createTerminalFixture` aliases.

## 0.7.0 – 0.8.4 - 2026-04-09 → 2026-07-27

The entries below shipped across the 0.7.0 through 0.8.4 tags; they were listed under Unreleased until the 0.9.0 entry was written.

### Changed

- **`termless rec` default live chrome restored to centered `macos`** — the live overlay now mounts recorded PTY output through silvery `<Island guest={xtermGuest}>`, so the old compositing-leak class is isolated at the island boundary instead of patched by disabling chrome. Bare `termless rec` shows the centered REC chrome again; concrete `--chrome macos|windows` styles also set the live style; `--live-chrome none` remains the explicit raw-stdout passthrough.

### Added

- **`compat-screenshot` — real desktop-terminal capture** — `termless compat-screenshot -- <cmd>` (CLI) and the `compat-screenshot` MCP tool spawn the user's actual macOS terminal app (Ghostty / kitty / iTerm / Terminal.app), run a TUI command, `screencapture` the window, and clean up. Pixel-perfect for that specific terminal + the user's real font/theme config — the **compat** path. macOS-only; auto-detects the terminal (ghostty > kitty > iterm > terminal) and returns terminal version/font/theme metadata. For routine visual iteration use the canvas renderer instead. New `@termless/peekaboo` exports: `compatScreenshot()`, `assertCompatCapable()`, `detectTerminal()`, `getTerminalAdapter()`. See [@termless/peekaboo README](packages/peekaboo/README.md).
- **Canvas-rendered screenshots** — `screenshotCanvasPng()` and `terminal.screenshot({ renderer: "canvas" })` route through `@termless/ghostty`'s native canvas path: ghostty-web's CanvasRenderer backed by `@napi-rs/canvas`, with no Playwright/Chromium process. Real-fidelity truecolor + glyph shaping + DPR 2 retina output. SVG/resvg remains available for deterministic snapshots.
- **Frame-trace mode** — `createFrameTracer(terminal, { dir, debounceMs, maxFrames, dedupe })` captures every render-relevant buffer change with timestamp + xxHash64 content dedupe. Append-only streaming-readable `index.jsonl` + `NNNNN.png` per unique frame. New `TerminalCreateOptions.onAfterWrite` hook wires it transparently.
- **Tape `Set Frames` directive** — `Set Frames "/path/to/trace/"` + optional `Set FrameDebounceMs 16` in `.tape` files enables frame-trace during execution; summary surfaces on `result.frameTrace`. See [Frame-Trace Mode](docs/guide/frame-trace.md).

### Fixed

- **Bounded native-canvas screenshots** — `renderTerminalPng()` now sizes inferred renders to the visible viewport instead of the scrollback-backed buffer, and every Skia surface has a fail-loud 64-MiPixel ceiling checked before allocation. The renderer uses a 1×1 measurement canvas, applies DPR once at the measured resize, and reports attempted dimensions when a render or resample exceeds the ceiling.
- **Ghostty backend initialization under Bun** — `initGhostty()` now provides the browser-style `self` global expected by `ghostty-web`, so the backend and native-canvas screenshot tests run directly in Bun without a browser harness.

## 0.6.0 - 2026-04-09

### Added

- **Recording themes**: 77 built-in themes (imported from silvery), `Set Theme` in .tape, `--theme` CLI flag
- **SVG chrome**: padding, border radius, window bar, margin options for polished SVG output
- **Asciicast v2 recording/playback**: capture PTY output events with timestamps, play .cast files with real-time streaming
- **GIF output**: generate animated GIFs from terminal recordings
- **Keyboard overlay**: visual key overlay during recording playback
- **Expect command**: assert terminal content during tape execution
- **Play streaming**: real-time asciicast playback with configurable speed
- **Interactive recording**: capture keystrokes and generate .tape files
- **Browser web player**: `@termless/web-player` for xterm.js playback of `.cast` recordings and browser-safe `.tape` timelines
- **Animation formats**: tape executor/compare tests, VHS tape format support
- **Composable matchers**: `toHaveAttrs` and `toHaveCursor` matchers
- **@termless/vt220 backend**: VT220 emulator backend
- **Glossary**: expanded from 47 to 99 terms, composed from terminfo.dev
- **SEO**: sitemap, robots.txt, OG tags, Twitter cards, JSON-LD breadcrumbs, canonical URLs
- **Footer**: author info and ecosystem cross-links
- **Docs**: Why Termless page, problem summary, navigation submenus, deprecation notices for individual matcher pages

### Changed

- CLI migrated to typed `.argument()` and `.actionMerged()` for commander
- CLI uses `@silvery/commander` typed options
- Renamed `@bearly/vitepress-enrich` to `vitepress-enrich`
- Glossary URLs point to specific terminfo.dev feature pages
- Bjorn → Bjørn in author references
- Removed km references from public docs

### Fixed

- System font loading in resvg (fixes broken font rendering in GIF/PNG output)
- Auto-detect terminal font (Ghostty), moderate SVG defaults
- Zero-dimension crash and empty frame capture in screenshot rendering
- CI: skip silvery theme tests when `@silvery/theme` not available
- CI: use relative imports for standalone compatibility
- `isTerminalReadable` accepts Proxy-based objects
- Various VitePress build and SEO fixes

### Note

Versions 0.3.0 through 0.5.1 were released without changelog entries.

## 0.2.0

- Renamed all packages to `@termless/*` scoped names
- Added `@termless/core` as the published core package (types, Terminal, PTY, SVG/PNG, key mapping, region views)
- Added PNG screenshot support via optional `@resvg/resvg-js`
- Added VitePress documentation site at termless.dev
- Added visual diff, mock timer, and recording/replay APIs
- Improved docs: composable region selectors, Quick Start examples, multi-backend setup
- Renamed internal references from inkx to hightea to silvery

## 0.1.0

Initial release.

### termless (core)

- Terminal abstraction with pluggable backends
- PTY support (Bun PTY) for spawning real processes
- SVG screenshots with customizable themes
- Key mapping and encoding (Playwright key format)
- Text search (find, findAll)
- Wait conditions (waitFor text, waitForStable)

### @termless/xtermjs

- xterm.js backend using @xterm/headless
- Full TerminalBackend implementation (~18 methods)
- True color, 256-color palette support
- Terminal mode detection

### @termless/ghostty

- Ghostty backend via ghostty-web WASM
- Full TerminalBackend implementation (text, styles, colors, cursor, modes, scrollback, key encoding)
- 35 backend-specific tests + 47 cross-backend conformance tests

### @termless/test

- 25 Vitest matchers for terminal assertions
- Terminal fixture with automatic cleanup
- Snapshot serializer for terminal state

### @termless/vt100

- Pure TypeScript VT100 emulator (zero native dependencies)
- Full SGR support: 16/256/truecolor colors, all underline styles
- Terminal modes: alt screen, bracketed paste, mouse tracking, auto wrap
- OSC 2 title, wide character detection, scroll regions
- 53 backend tests passing in 22ms

### @termless/alacritty

- Alacritty backend via `alacritty_terminal` crate + napi-rs
- Full Rust native bindings (~350 lines) + TypeScript wrapper
- 35 backend tests (skip gracefully without Rust toolchain)
- Requires: `cd native && cargo build --release`

### @termless/wezterm

- WezTerm backend via `tattoy-wezterm-term` crate + napi-rs
- Full Rust native bindings + TypeScript wrapper
- 35 backend tests (skip gracefully without Rust toolchain)
- Requires: `cd native && cargo build --release`

### @termless/peekaboo

- Dual-layer backend: xterm.js for data + real terminal app for visual
- OS-level automation via MCP peekaboo tools
- Screenshot capture, command spawning, key injection
- 14 integration tests

### @termless/cli

- CLI: `termless capture` for one-shot terminal operations
- MCP server: `termless mcp` for AI agent integration
- SVG screenshots (no Chromium required)
