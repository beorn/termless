# @termless/vt100-rust

Rust vt100 backend for termless -- wraps the [vt100](https://crates.io/crates/vt100) Rust crate via napi-rs.

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
