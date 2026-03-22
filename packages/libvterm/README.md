# @termless/libvterm

libvterm backend for termless -- wraps [neovim's libvterm](https://github.com/neovim/libvterm) C library via Emscripten WASM.

libvterm is the VT parser used by neovim's built-in terminal. It provides a clean, standards-compliant implementation that differs from all other termless backends.

## Build

Requires [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html):

```bash
cd packages/libvterm
bash build/build.sh
```

This generates `wasm/libvterm.js` and `wasm/libvterm.wasm`.

## Usage

```typescript
import { createLibvtermBackend, initLibvterm } from "@termless/libvterm"
import { createTerminal } from "@termless/core"

// Initialize WASM (once, memoized)
await initLibvterm()

const term = createTerminal({ backend: createLibvtermBackend(), cols: 80, rows: 24 })
```

Or use the registry:

```typescript
const term = await createTerminalByName("libvterm")
```
