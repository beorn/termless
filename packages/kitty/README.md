# @termless/kitty

Kitty backend for termless — uses [kitty's](https://github.com/kovidgoyal/kitty) actual VT parser via a Python subprocess bridge.

## How it works

Unlike other native backends that compile a Rust crate into a `.node` binary, the kitty backend runs kitty's own Python-embedded C code via `kitty +runpy`. This is necessary because kitty's VT parser is deeply coupled to CPython (all data structures use `PyObject_HEAD`, callbacks use the Python C API, etc.).

The architecture:

1. **`build/bridge.py`** — A Python script that creates a headless kitty `Screen`, accepts JSON commands via stdin, and returns terminal state snapshots via stdout
2. **`src/backend.ts`** — TypeScript wrapper that accumulates commands and replays them in a `kitty +runpy` subprocess when a query is needed

Each mutation (`feed`, `resize`, `reset`) is logged. When you query the terminal state (`getCell`, `getCursor`, etc.), the entire command log is replayed in a fresh subprocess and the resulting snapshot is cached until the next mutation.

## License

This package's source code (bridge script + TypeScript wrapper) is MIT licensed.

**However**, at runtime it invokes the kitty binary, which is GPL-3.0 licensed. No derivative binaries are produced or distributed. Kitty must be installed separately on your machine.

## Prerequisites

Install kitty:

```bash
brew install --cask kitty   # macOS
# or visit https://sw.kovidgoyal.net/kitty
```

Then verify:

```bash
cd packages/kitty
bash build/build.sh
```

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
