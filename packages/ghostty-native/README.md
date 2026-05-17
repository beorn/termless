# @termless/ghostty-native

Native [Ghostty](https://ghostty.org/) backend for [termless](https://termless.dev/) — headless terminal emulation using Ghostty's VT Zig module via napigen N-API bindings.

Same VT processing as the Ghostty terminal emulator, running natively (no WASM overhead). Compare with `@termless/ghostty` which uses the WASM build.

## Build

Requires **Zig 0.15.2+** (available via nix).

```bash
# From the ghostty-native package directory:
bash build/build.sh

# Or via the termless CLI:
bunx termless backends install ghostty-native
```

The first build fetches the ghostty source (~large download, cached after).

## Architecture

```
TypeScript backend (src/backend.ts)
  └── N-API bindings (native/src/main.zig) — via napigen
        └── ghostty-vt Zig module — Ghostty's terminal emulation core
```

- **napigen** — comptime N-API bindings for Zig (single toolchain, no Rust needed)
- **ghostty-vt Zig module** — current binding target; exposes Ghostty's VT parser, terminal state, screen, cells, cursor, and scrollback directly to the Zig bridge
- **libghostty-vt C API** — future migration target once upstream tags or declares the C signatures stable enough for external bindings
- Uses Ghostty's Zig terminal/screen/cell APIs for cell-by-cell reading
- Uses Ghostty's Zig formatter helpers for bulk text extraction

## API

```typescript
import { createGhosttyNativeBackend } from "@termless/ghostty-native"

const backend = createGhosttyNativeBackend({ cols: 80, rows: 24 })
backend.feed(new TextEncoder().encode("Hello, world!\r\n"))
console.log(backend.getText())
backend.destroy()
```

## Pinned version

Built against ghostty v1.3.1 (`332b2aef`). The stable C API migration is tracked in km as `@km/termless/libghostty-stable-api`.
