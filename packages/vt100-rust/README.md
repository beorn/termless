# @termless/vt100-rust

Rust vt100 backend for termless -- wraps the [vt100](https://crates.io/crates/vt100) Rust crate via napi-rs.

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
