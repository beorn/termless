# @termless/ghostty-native

Native [Ghostty](https://ghostty.org/) backend for [termless](https://termless.dev/) — headless terminal emulation using Ghostty's VT Zig module via napigen N-API bindings.

Same VT processing as the Ghostty terminal emulator, running natively (no WASM overhead). Compare with `@termless/ghostty` which uses the WASM build.

**Feature support:** No dedicated headless page is published on [terminfo.dev](https://terminfo.dev/backends). Ghostty's application page covers the full terminal.

> Install from npm; a git install resolves the TypeScript source and runs only under Bun.

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

## Paste input

The `paste-encoding` extension provides `backend.encodePaste(text): Uint8Array`
using the current native Terminal handle. It returns Ghostty's own input bytes
without feeding the parser, changing modes or screen state, draining pending
replies, or calling `onResponse`.

Ghostty 1.3.1 replaces its listed control bytes, including ESC, with spaces in
both modes. With mode 2004 off, LF becomes CR (CRLF becomes CRCR). With mode
2004 enabled, the native encoder frames the payload and preserves newlines.
This is Ghostty's native policy, not a shared Termless normalizer. Empty text
returns empty bytes when unbracketed and the native empty frame when bracketed.

Calls before init or after destroy fail. Reset and re-init use native default
modes. An older addon without this method reports the existing rebuild command.

## Working directory

The `osc-metadata` reader `getCwd(): string | null` returns Ghostty's stored OSC 7 URL literally. Ghostty the app applies scheme, host and percent-decoding policy; this library binding applies none of those checks or transformations. Valid Unicode, backslashes and percent escapes stay literal. Napigen's UTF-8 string projection replaces invalid bytes with U+FFFD; it is not lossless byte transport.

On the pinned 1.3.1 engine, BEL or ESC dispatches the pending OSC 7 payload. An incomplete payload leaves the prior value until ESC arrives; the backslash completing ST adds no second dispatch. Initial state, empty OSC 7, reset, RIS and re-init return `null`. A measured 4,097-byte payload was ignored and retained the prior value. OSC 633 `P;Cwd=` with BEL or ST, and unrelated OSC 633, left the value unchanged after successful OSC 7 controls. Calls before init or after destroy fail; an older addon without the reader names the existing rebuild command.

## Pinned version

Built against ghostty v1.3.1 (`332b2aef`). The stable C API migration is tracked in km as `@km/termless/libghostty-stable-api`.
