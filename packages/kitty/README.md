# @termless/kitty

Kitty backend for termless — uses [kitty's](https://github.com/kovidgoyal/kitty) actual VT parser via a Python subprocess bridge.

**Feature support:** [Kitty results on terminfo.dev](https://terminfo.dev/terminals/kitty) combine application and parser-backend results; no separate page isolates this library.

> Install from npm; a git install resolves the TypeScript source and runs only under Bun.

## How it works

Unlike other native backends that compile a Rust crate into a `.node` binary, the kitty backend runs kitty's own Python-embedded C code via `kitty +runpy`. This is necessary because kitty's VT parser is deeply coupled to CPython (all data structures use `PyObject_HEAD`, callbacks use the Python C API, etc.).

The architecture:

1. **`build/bridge.py`** — A Python script that creates a headless kitty `Screen`, accepts JSON commands via stdin, and returns terminal state snapshots via stdout
2. **`src/backend.ts`** — TypeScript wrapper that accumulates commands and replays them in a `kitty +runpy` subprocess when a query is needed

Each mutation (`feed`, `resize`, `reset`) is logged. When you query the terminal state (`getCell`, `getCursor`, etc.), the entire command log is replayed in a fresh subprocess and the resulting snapshot is cached until the next mutation.

The `paste-encoding` extension observes Kitty's terminal-state `Screen.paste` bytes, including native bracketed framing, rather than the application's sanitizing `Window.paste` action.

The existing `osc-metadata` getter `getUnhandledSequences()` copies native parser rejection codes in feed order. It uses Kitty's diagnostic parser variant and recognizes only the pinned 0.49.2 error wording; unmatched messages or other versions decide nothing. OSC codes retain their number; CSI diagnostics retain only reported modifiers and final byte, without reconstructing omitted parameters. These rejections are separate from host-delivery callbacks.

The `osc-metadata` getter `getCwd()` reads only native OSC 7 state: the last completed BEL- or ST-terminated payload wins, and split or incomplete sequences retain the previous value. Payloads stay literal, without URI, percent or backslash decoding; invalid UTF-8 becomes U+FFFD. Initial state, empty OSC 7, reset and re-init return `null`. Kitty 0.49.2 left cwd unchanged for OSC 633 `P;Cwd=` when measured alongside a working OSC 7 control; native stderr reported `Ignoring OSC 633, use by Windows Terminal for VSCode actions`.

## License

This package's source code (bridge script + TypeScript wrapper) is MIT licensed.

At runtime it invokes the separately installed kitty binary, which is GPL-3.0 licensed.
A build-time C emitter measures pinned Kitty headers; its source and generated JSON metadata are shipped, but its executable is not.

## Prerequisites

Install kitty:

```bash
brew install --cask kitty   # macOS
# or visit https://sw.kovidgoyal.net/kitty
```

For a source checkout, install Nix, then verify the committed native layout metadata and Kitty installation:

```bash
cd packages/kitty
bash build/build.sh
```

The script rebuilds `.#kitty-native-mode-layout` and compares its JSON layout and receipt before checking Kitty.
Native `reverseVideo` and `syncOutput` reads require the attested runtime; see [backend limits](../../docs/guide/backends.md#termlesskitty).

## Usage

```typescript
import { createKittyBackend } from "@termless/kitty"
import { createTerminal } from "@termless/core"

const term = createTerminal({ backend: createKittyBackend(), cols: 80, rows: 24 })
```

## Performance

- ~35ms per mutation (subprocess startup + replay + snapshot)
- <1ms per query (served from cached snapshot)
- Suitable for testing; not for real-time use
