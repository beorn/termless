# @termless/ghostty-native

Native [Ghostty](https://ghostty.org/) backend for [termless](https://termless.dev/) — headless terminal emulation using libghostty-vt via Zig N-API bindings.

Same VT processing as the Ghostty terminal emulator, running natively (no WASM overhead). Compare with `@termless/ghostty` which uses the WASM build.

## Build

Requires **Zig 0.15.2+** (available via nix).

```bash
# From the ghostty-native package directory:
bash build/build.sh

# Or via the termless CLI:
bunx termless install ghostty-native
```

The first build fetches the ghostty source (~large download, cached after).

## Architecture

```
TypeScript backend (src/backend.ts)
  └── N-API bindings (native/src/main.zig) — via napigen
        └── libghostty-vt C API — Ghostty's terminal emulation core
```

- **napigen** — comptime N-API bindings for Zig (single toolchain, no Rust needed)
- **libghostty-vt** — Ghostty's VT parser + terminal state as a C library
- Uses the **Render State API** for efficient cell-by-cell reading
- Uses the **Formatter API** for bulk text extraction

## API

```typescript
import { createGhosttyNativeBackend } from "@termless/ghostty-native"

const backend = createGhosttyNativeBackend({ cols: 80, rows: 24 })
backend.feed(new TextEncoder().encode("Hello, world!\r\n"))
console.log(backend.getText())
backend.destroy()
```

## Pinned version

Built against ghostty v1.3.1 (`22efb0be`).
