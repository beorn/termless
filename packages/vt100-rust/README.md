# @termless/vt100-rust

Rust vt100 backend for termless -- wraps the [vt100](https://crates.io/crates/vt100) Rust crate via napi-rs.

**Feature support:** [Terminfo.dev](https://terminfo.dev/backends) does not currently publish a feature page for this library. The vt100.js page covers the separate TypeScript backend.

> Install from npm; a git install resolves the TypeScript source and runs only under Bun.

## Build

Requires Rust toolchain:

```bash
cd native && cargo build --release
cp target/release/libtermless_vt100_rust_native.dylib ../termless-vt100-rust.node
```

## Usage

```typescript
import { createVt100RustBackend } from "@termless/vt100-rust"
import { createTerminal } from "@termless/core"

const term = createTerminal({ backend: createVt100RustBackend(), cols: 80, rows: 24 })
```

The backend's `getCwd()` reads completed OSC 7 and OSC 633 `P;Cwd=` callbacks
from its own parser. The last completed value wins; OSC 633 values remain
literal, with no backslash decoding or URL normalization. Empty values and a
fresh or reset parser return `null`; other OSC 633 commands preserve the value.
Destroying the backend ends its reader lifetime.

The vt100 0.16.2 callback journey measures a limit of 16 delivered fields,
including the command: OSC 7 retains at most 15 payload fields, OSC 633 Cwd at
most 14. Only those fields are joined with semicolons; excess raw input is not
recovered. As with notifications, Rust's `String::from_utf8_lossy` replaces
invalid UTF-8 sequences with the Unicode replacement character (U+FFFD).

`getNotifications()` and `getOsc777Payloads()` retain each ordered OSC 9 and OSC 777 payload as the library dispatches it: at most 15 payload fields after the command are joined with semicolons, with the same lossy UTF-8 decoding. Both return copies, start empty on init/re-init, and clear together when reset replaces their native callback owner; their getters throw after destroy.

`getUnhandledSequences()` copies unhandled OSC command numbers and CSI native normalized parameter groups plus final byte (intermediate characters first), without OSC payloads; it shares that callback owner's reset/re-init lifetime and throws after destroy.
