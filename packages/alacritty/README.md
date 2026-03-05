# @termless/alacritty

Alacritty backend for [termless](../../) -- headless terminal emulation using
the [alacritty_terminal](https://crates.io/crates/alacritty_terminal) Rust
crate via [napi-rs](https://napi.rs).

## Status

**Work in progress.** The TypeScript wrapper and Rust native module source are
complete, but the native binary needs to be compiled before the backend is
functional.

## Architecture

```
TypeScript (backend.ts)
  └── napi-rs bridge (native/src/lib.rs)
        └── alacritty_terminal 0.25 (Rust crate)
              └── vte 0.15 (VT parser)
```

The native module exposes `AlacrittyTerminal` as a napi class with methods for
feeding data, reading cells/cursor/modes, resizing, and scrollback. The
TypeScript layer wraps this to implement the `TerminalBackend` interface.

## Characteristics

Compared to the xterm.js and Ghostty backends:

| Feature          | alacritty            | xterm.js    | ghostty     |
| ---------------- | -------------------- | ----------- | ----------- |
| Truecolor        | Yes                  | Yes         | Yes         |
| Kitty keyboard   | Yes                  | No          | Yes         |
| Kitty graphics   | No                   | No          | No          |
| Sixel            | No                   | No          | No          |
| Underline styles | All 5                | Single only | Single only |
| Reflow           | Yes                  | Yes         | Yes         |
| Cursor styles    | Block/Underline/Beam | Block only  | Block only  |

## Building

### Prerequisites

- Rust toolchain: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- napi-rs CLI: `bun add -g @napi-rs/cli`

### Compile

```bash
cd packages/alacritty/native
cargo build --release

# The output will be at:
#   target/release/libtermless_alacritty_native.dylib  (macOS)
#   target/release/libtermless_alacritty_native.so     (Linux)

# TODO: Use napi-rs CLI for proper .node binary generation:
# npx napi build --release
```

### Test

```bash
bun vitest run vendor/termless/packages/alacritty/tests/ --project vendor
```

## Usage

```typescript
import { createAlacrittyBackend } from "@termless/alacritty"

const backend = createAlacrittyBackend()
backend.init({ cols: 80, rows: 24 })
backend.feed(new TextEncoder().encode("Hello, Alacritty!"))
console.log(backend.getText()) // "Hello, Alacritty!"
backend.destroy()
```

## TODO

- [ ] Set up napi-rs build pipeline (generates platform-specific .node binaries)
- [ ] Add to cross-backend.test.ts once native module builds
- [ ] CI: build native binaries for all target platforms
- [ ] Publish as npm package with prebuilt binaries
