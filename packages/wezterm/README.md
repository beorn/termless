# @termless/wezterm

WezTerm backend for [Termless](../../README.md) — headless terminal emulation using the [wezterm-term](https://crates.io/crates/tattoy-wezterm-term) Rust crate via [napi-rs](https://napi.rs) native bindings.

> Install from npm; a git install resolves the TypeScript source and runs only under Bun.

## Why WezTerm?

WezTerm's VT parser is one of the most complete terminal emulation implementations:

- **Kitty keyboard protocol** — progressive enhancement for modern TUI apps
- **Sixel graphics** — inline image support
- **OSC 8 hyperlinks** — clickable links in the terminal
- **Semantic prompts** — shell integration markers
- **Full Unicode 15.1** — wide characters, grapheme clusters, ZWJ sequences
- **Line reflow** — content reflows on resize

## Prerequisites

The native Rust module must be compiled before use:

```bash
# Install Rust if needed: https://rustup.rs
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Build the native module
cd packages/wezterm/native
cargo build --release

# Copy to package root (macOS)
cp target/release/libtermless_wezterm_native.dylib ../@termless/wezterm.node

# Linux
# cp target/release/libtermless_wezterm_native.so ../@termless/wezterm.node

# Windows
# cp target/release/termless_wezterm_native.dll ../@termless/wezterm.node
```

## Usage

```typescript
import { createWeztermBackend } from "@termless/wezterm"
import { createTerminal } from "@termless/core"

const term = createTerminal({
  backend: createWeztermBackend(),
  cols: 80,
  rows: 24,
})

term.feed("Hello, world!")
console.log(term.screen.getText())

await term.close()
```

## API

### `createWeztermBackend(opts?, native?)`

Creates a `TerminalBackend` using the wezterm-term VT parser.

- `opts` — Optional `Partial<TerminalOptions>` for eager initialization
- `native` — Optional pre-loaded native module (for test isolation)

### `loadWeztermNative()`

Explicitly loads the native module. Called automatically by `createWeztermBackend()`,
but can be called ahead of time to fail fast if the native module is missing.

## Capabilities

| Capability              | Supported     |
| ----------------------- | ------------- |
| True color (24-bit)     | Yes           |
| Kitty keyboard protocol | Yes           |
| Kitty graphics          | No (headless) |
| Sixel                   | Yes           |
| OSC 8 hyperlinks        | Yes           |
| Semantic prompts        | Yes           |
| Unicode 15.1            | Yes           |
| Line reflow             | Yes           |

## Architecture

```
TypeScript (backend.ts)
  └── napi-rs native binding (native/src/lib.rs)
        └── tattoy-wezterm-term (Rust crate)
              └── wezterm VT parser
```

The native module exposes a `WeztermTerminal` class via napi-rs that wraps the Rust `Terminal` struct. The TypeScript layer converts between napi types and the Termless `Cell`/`Cursor`/`ScrollbackState` types.

The native Cargo dependency uses the maintained source at
`native/vendor/tattoy-wezterm-term`: the published 0.1.0-fork.5 archive plus a
read-only `application_cursor_keys_enabled` getter and its lifecycle test.
`native/Cargo.toml` records the base archive identity. Its original license and
`.cargo_vcs_info.json` are retained; the latter says `dirty: true`, so its Git
commit is not a claim of an identical clean source tree. Native receipts bind
the maintained bytes through `nativeTreeOid`, with `sourceKind` and
`baseArchiveSha256` instead of a registry checksum for the patched crate.
