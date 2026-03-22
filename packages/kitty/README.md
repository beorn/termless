# @termless/kitty

Kitty backend for termless — wraps [kitty's](https://github.com/kovidgoyal/kitty) VT parser, built from source.

## License

This package's source code (build script + TypeScript wrapper) is MIT licensed.

**However**, the build process downloads and compiles kitty, which is GPL-3.0 licensed. The resulting native binary (`.node` file) is a derivative work under GPL-3.0 and **must not be distributed**. It is built locally on your machine for testing purposes only.

## Build

Requires: C compiler (cc/gcc/clang), Python 3, git

```bash
cd packages/kitty
bash build/build.sh
```

## Status

**Work in progress.** Kitty's VT parser is tightly coupled to its rendering pipeline, making extraction complex. The build script clones kitty's source and documents the integration approach, but the native module compilation is not yet implemented.

## Usage (once built)

```typescript
import { createKittyBackend } from "@termless/kitty"
import { createTerminal } from "@termless/core"

const term = createTerminal({ backend: createKittyBackend(), cols: 80, rows: 24 })
```
