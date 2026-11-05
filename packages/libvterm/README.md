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
their hashes to the staged build inputs. Stage the changed inputs, run the build,
then commit the inputs, the rebuilt pair and the receipt together as one commit.
A build input whose working tree differs from the index prevents receipt
generation; diagnostic binaries from such a build are not attested.

This generated loader targets Node.js: the pinned build uses
`ENVIRONMENT=node`, and the adapter loads its assets with `node:fs` and
`node:crypto`. The package does not claim a browser runtime for this backend.

## Usage

New backend instances start in UTF-8 mode, matching the bytes supplied through
`TerminalBackend.feed`. The low-level module's `vterm_new` binding uses the same
UTF-8 constructor; it does not expose libvterm's legacy byte-mode default.

OSC 52 clipboard selection `c` uses memory owned by each backend instance.
The engine's selection callbacks decode writes and format query responses.

The `osc-metadata` extension exposes a copy of completed OSC 9 payloads through
`getNotifications()`, in parser order, including empty payloads and `4;…` forms.
`getOsc777Payloads()` returns copied OSC 777 payloads as the library dispatches
them, including both empty command forms. OSC 9 and OSC 777 share the same
per-instance callback owner and have separate ordered histories.
This records parser notifications; it does not deliver desktop notifications or
interpret progress. Reset and re-initialization clear complete and partial
observations. Reading before initialization or after destruction throws.

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
