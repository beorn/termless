# @termless/libvterm

libvterm backend for termless -- wraps [neovim's libvterm](https://github.com/neovim/libvterm) C library via Emscripten WASM.

libvterm is the VT parser used by neovim's built-in terminal. It provides a clean, standards-compliant implementation that differs from all other termless backends.

> Install from npm; a git install resolves the TypeScript source and runs only under Bun.

## Build

The repository's `flake.nix` declares Emscripten and the build tools. From the
Termless repository root:

```bash
nix develop --command bash packages/libvterm/build/build.sh
```

An existing Emscripten SDK can also run `bash build/build.sh` from this package.
The build generates `wasm/libvterm.js`, `wasm/libvterm.wasm`, and a receipt binding
their hashes to the committed build inputs. Uncommitted build inputs prevent
receipt generation; diagnostic binaries from such a build are not attested.

## Usage

New backend instances start in UTF-8 mode, matching the bytes supplied through
`TerminalBackend.feed`. The low-level module's `vterm_new` binding uses the same
UTF-8 constructor; it does not expose libvterm's legacy byte-mode default.

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
