---
title: Backend Capabilities
description: Compare Termless backends -- xterm.js, Ghostty, vterm.js, vt100, Alacritty, WezTerm, and more. Feature matrix and selection guide.
---

# Backend Capability Matrix

Each Termless backend wraps a different terminal emulator. They all implement the same `TerminalBackend` interface, but their underlying capabilities differ.

## Discovering Backends

Use the CLI to see available backends and their installation status:

```bash
# List all backends with install status and capabilities
$ bunx termless backends

# Check health of installed backends (version mismatches, missing deps)
$ bunx termless doctor
```

## Which Backend Should I Use?

| Need                                    | Start with                                             |
| --------------------------------------- | ------------------------------------------------------ |
| Default Vitest unit-style tests         | `xtermjs` via `@termless/test`                         |
| Zero-dependency CI smoke tests          | `vt100`                                                |
| Modern parser and Kitty keyboard checks | `ghostty` or `ghostty-native`                          |
| Reflow behavior                         | `xtermjs`, `alacritty`, `wezterm`, or `ghostty-native` |
| Sixel graphics                          | `wezterm`                                              |
| Kitty graphics protocol                 | `kitty`                                                |
| Real terminal app automation            | `peekaboo`                                             |
| Independent parser cross-checks         | `libvterm`, `vt100-rust`, or another native backend    |

Fast unit tests and high-fidelity terminal tests are different tools. Use in-memory backends for feed/assert loops, then add PTY, native, or OS-level backends where terminal-specific behavior matters.

## Capability Matrix

| Capability              | xterm.js              | Ghostty           | vt100              | vterm.js       | Alacritty                  | WezTerm                     | Peekaboo       | vt100-rust     | libvterm                 | Ghostty Native               | Kitty                                |
| ----------------------- | --------------------- | ----------------- | ------------------ | -------------- | -------------------------- | --------------------------- | -------------- | -------------- | ------------------------ | ---------------------------- | ------------------------------------ |
| **Truecolor (24-bit)**  | Yes                   | Yes               | Yes                | Yes            | Yes                        | Yes                         | Yes            | Yes            | Yes                      | Yes                          | Yes                                  |
| **Kitty keyboard**      | No                    | Yes               | No                 | Yes            | Yes                        | Yes                         | No             | No             | No                       | Yes                          | Yes                                  |
| **Kitty graphics**      | No                    | No                | No                 | Yes            | No                         | No                          | No             | No             | No                       | No                           | Yes                                  |
| **Sixel**               | No                    | No                | No                 | Yes            | No                         | Yes                         | No             | No             | No                       | No                           | No                                   |
| **OSC 8 hyperlinks**    | Yes                   | Yes               | No                 | Yes            | Yes                        | Yes                         | Yes            | No             | No                       | Yes                          | Yes                                  |
| **Semantic prompts**    | No                    | No                | No                 | Yes            | No                         | Yes                         | No             | No             | No                       | Yes                          | No                                   |
| **Unicode**             | 15.1                  | 15.1              | 15.1               | 15.1           | 15.1                       | 15.1                        | 15.1           | 15.1           | 15.1                     | 15.1                         | 15.1                                 |
| **Reflow on resize**    | Yes                   | Yes               | No                 | Yes            | Yes                        | Yes                         | Yes            | No             | No                       | Yes                          | Yes                                  |
| **Viewport scrolling**  | Yes                   | No                | Yes                | Yes            | Yes                        | Yes                         | Yes            | Yes            | Yes                      | Yes                          | Yes                                  |
| **OS-level screenshot** | No                    | No                | No                 | No             | No                         | No                          | Yes            | No             | No                       | No                           | No                                   |
| **Native deps**         | None                  | WASM              | None               | None           | Rust (napi-rs)             | Rust (napi-rs)              | None           | Rust (napi-rs) | WASM (Emscripten)        | Zig (napigen)                | Installed Kitty + Python bridge      |
| **Upstream**            | `npm:@xterm/headless` | `npm:ghostty-web` | _(self-contained)_ | `npm:vterm.js` | `crate:alacritty_terminal` | `crate:tattoy-wezterm-term` | `npm:peekaboo` | `crate:vt100`  | `github:neovim/libvterm` | `github:ghostty-org/ghostty` | `github:kovidgoyal/kitty`            |
| **Build requirement**   | None                  | None              | None               | None           | Rust toolchain             | Rust toolchain              | None           | Rust toolchain | Emscripten SDK           | Zig 0.15.2+                  | Kitty; Nix for metadata verification |

::: tip Full Feature Matrix
For a comprehensive, interactive capability matrix across all backends, visit **[terminfo.dev](https://terminfo.dev)** — powered by termless census probes.
:::

## Adapter source identity

All eleven library backends expose `AdapterSourcesExtension` through `adapter-sources`.
`getAdapterSources()` returns the implementation paths and Git blob OIDs. Each backend's
tests independently hash its actual imported files; the identity module excludes itself.
This source list identifies implementation bytes. Response behavior is observed through
`onResponse`, `feed()` and the backend's immediate drain, rather than declared by metadata.

## Backend Details

### Reading parser metadata

Use `hasExtension<HyperlinkExtension>(backend, "hyperlinks")` before calling
`getHyperlinkAt(row, col)`. The getter and `Cell.hyperlink` return the stored URI,
or null for an observed unlinked cell. They use the same row origin as that
backend's `getCell`; buffer and viewport addressing differ between backends.
Alacritty, WezTerm, Ghostty Native and Kitty preserve this metadata through their
native bridges. A capability flag alone does not provide a metadata observer.

Ghostty Native also advertises `DefaultColorsExtension` as `default-colors`.
`getDefaultColors()` reads all three current engine defaults (`fg`, `bg`,
`cursor`), including OSC overrides. Null means the engine reports an unset slot;
it does not supply a display RGB. Reads require an initialized backend. This
Track A compatibility extension migrates onto Emulator or leaves with
TerminalBackend at A4b.

Each backend can be used via factory function (explicit, sync) or string name via `backend()` (async — handles WASM/native init). The registry handles backend-specific initialization (WASM loading, native module binding).

### @termless/xtermjs

The default backend. Uses `@xterm/headless` — the same xterm.js terminal emulator used in VS Code's integrated terminal, but without a DOM renderer.

**Feature support:** [xterm.js results on terminfo.dev](https://terminfo.dev/terminals/xterm-js).

- **Engine**: @xterm/headless 6.0
- **Upstream**: `npm:@xterm/headless`
- **Best for**: Most testing scenarios. Well-tested, stable, zero native dependencies.
- **Limitations**: No Kitty keyboard protocol. Emoji width detection may differ from native terminals in headless mode.
- **Install**: Included automatically with `@termless/test`.

```typescript
// Factory function (preferred — explicit, sync)
import { createXtermBackend } from "@termless/xtermjs"
const term = createTerminal({ backend: createXtermBackend() })
```

```typescript
// By name (async — handles init automatically)
import { backend } from "@termless/core"
const b = await backend("xtermjs")
const term = createTerminal({ backend: b })
```

### @termless/ghostty

Uses Ghostty's VT parser via `ghostty-web` WASM. Ghostty is a modern GPU-accelerated terminal with strong standards compliance.

**Feature support:** [Ghostty results on terminfo.dev](https://terminfo.dev/terminals/ghostty) combine application and parser-backend results; no separate page isolates the WASM backend.

- **Engine**: ghostty-web 0.4 (WebAssembly)
- **Upstream**: `npm:ghostty-web`
- **Best for**: Testing against a modern, standards-compliant parser. Verifying Kitty keyboard protocol support.
- **Limitations**: WASM build does not support viewport scrolling or Kitty graphics. Read OSC titles with `getTitle()`; title push/pop is unimplemented.
- **Install**: `bunx termless backends install ghostty` (or `npm install -D @termless/ghostty`)

```typescript
// Factory function (requires async WASM init)
import { createGhosttyBackend, initGhostty } from "@termless/ghostty"
const ghostty = await initGhostty()
const term = createTerminal({ backend: createGhosttyBackend(undefined, ghostty) })
```

```typescript
// By name (handles WASM init automatically)
import { backend } from "@termless/core"
const b = await backend("ghostty")
const term = createTerminal({ backend: b })
```

### @termless/vt100

Pure TypeScript VT100 emulator with zero dependencies. Lightweight and fast, inspired by the Rust `vt100` crate.

**Feature support:** [vt100.js results on terminfo.dev](https://terminfo.dev/terminals/vt100-js).

- **Engine**: Built-in (pure TypeScript, zero deps)
- **Upstream**: `npm:@termless/vt100` (self-contained)
- **Best for**: Environments where you want zero native dependencies and zero WASM. CI runners with constrained environments.
- **Limitations**: No reflow on resize. No OSC 8 hyperlinks. No Kitty keyboard. More limited escape sequence coverage than xterm.js or Ghostty.
- **Install**: `bunx termless backends install vt100` (or `npm install -D @termless/vt100`)

```typescript
// Factory function (preferred — explicit, sync)
import { createVt100Backend } from "@termless/vt100"
const term = createTerminal({ backend: createVt100Backend() })
```

```typescript
// By name (async)
import { backend } from "@termless/core"
const b = await backend("vt100")
const term = createTerminal({ backend: b })
```

### @termless/vt220

TypeScript VT220 emulator, available as `@termless/vt220` or through `backend("vt220")`.

**Feature support:** [Terminfo.dev](https://terminfo.dev/backends) does not currently publish a feature page for this library. Its historical DEC VT220 page describes the hardware terminal.

### @termless/vterm

Full-featured TypeScript terminal emulator targeting 100% of the [terminfo.dev](https://terminfo.dev) feature matrix. Pure TypeScript, zero dependencies — the comprehensive counterpart to `@termless/vt100`.

**Feature support:** [vterm.js results on terminfo.dev](https://terminfo.dev/terminals/vterm-js).

- **Engine**: Built-in (pure TypeScript, zero deps)
- **Upstream**: `npm:vterm.js`
- **Best for**: Full-standards conformance testing — 100% terminfo.dev coverage, Kitty keyboard protocol, OSC 8 hyperlinks, semantic prompts (OSC 133/633), and the DEC private modes other in-memory backends skip.
- **Limitations**: Sixel payloads are preserved through the optional `sixel-storage` extension, without decoded pixels or image cell geometry. Kitty graphics are not rendered by this backend.
- **Install**: `bunx termless backends install vterm` (or `npm install -D @termless/vterm`)

The `semantic-marks` extension exposes `SemanticMarkExtension.getSemanticMarks()`:
copied, ordered prompt/command/output start markers in zero-based screen coordinates
at insertion. These are not absolute buffer rows, bounded zones or completion events.
The shared `SemanticMark` type also includes command-end entries; narrow its `type`
before reading `startRow` or `startCol`. vterm declares only `semantic-marks` and
returns the unchanged `SemanticStartMark` shape.
Track A compatibility read; migrate onto Emulator or delete with TerminalBackend at A4b.

The `sixel-storage` extension exposes `SixelStorageExtension.getSixelImages()`:
copied raw payloads after `q`, with the row/column where their DCS started. It supplies
neither raster dimensions nor decoded pixels or cell geometry. Track A compatibility
read; migrate onto Emulator or delete with TerminalBackend at A4b.

Check the relevant extension with `hasExtension()` before reading. Empty arrays mean
no stored records; an absent extension means no reader. Reset and snapshot restore
clear vterm's mark and image records. See the [extension API](../api/backend#extension-interfaces).

```typescript
// Factory function (preferred — explicit, sync)
import { createVtermBackend } from "@termless/vterm"
const term = createTerminal({ backend: createVtermBackend() })
```

```typescript
// By name (async)
import { backend } from "@termless/core"
const b = await backend("vterm")
const term = createTerminal({ backend: b })
```

### @termless/alacritty

Uses Alacritty's `alacritty_terminal` crate via napi-rs native bindings. Alacritty is a GPU-accelerated terminal focused on simplicity and performance.

**Feature support:** [Alacritty results on terminfo.dev](https://terminfo.dev/terminals/alacritty) combine application and parser-backend results; no separate page isolates this library.

- **Engine**: alacritty_terminal 0.26 (Rust via napi-rs)
- **Upstream**: `crate:alacritty_terminal`
- **Best for**: Testing against Alacritty's VT parser. Cross-checking reflow behavior.
- **Limitations**: Requires Rust toolchain to build native bindings. Not available as prebuilt binaries yet.
- **Install**: `bunx termless backends install alacritty` (or `npm install -D @termless/alacritty`; requires Rust build)

```typescript
// Factory function (preferred — explicit, sync)
import { createAlacrittyBackend } from "@termless/alacritty"
const term = createTerminal({ backend: createAlacrittyBackend() })
```

```typescript
// By name (async — handles native module loading)
import { backend } from "@termless/core"
const b = await backend("alacritty")
const term = createTerminal({ backend: b })
```

### @termless/wezterm

Uses WezTerm's `wezterm-term` VT parser via napi-rs native bindings. WezTerm has the broadest feature set of any terminal emulator.

**Feature support:** [WezTerm results on terminfo.dev](https://terminfo.dev/terminals/wezterm) combine application and parser-backend results; no separate page isolates this library.

- **Engine**: tattoy-wezterm-term (Rust via napi-rs)
- **Upstream**: `crate:tattoy-wezterm-term`
- **Best for**: Testing sixel graphics support, semantic prompts, and the widest protocol coverage.
- **Limitations**: Requires Rust toolchain to build native bindings. Not available as prebuilt binaries yet.
- **Install**: `bunx termless backends install wezterm` (or `npm install -D @termless/wezterm`; requires Rust build)

```typescript
// Factory function (preferred — explicit, sync)
import { createWeztermBackend } from "@termless/wezterm"
const term = createTerminal({ backend: createWeztermBackend() })
```

```typescript
// By name (async — handles native module loading)
import { backend } from "@termless/core"
const b = await backend("wezterm")
const term = createTerminal({ backend: b })
```

### @termless/peekaboo

OS-level terminal automation. Launches a real terminal application, sends keystrokes via OS accessibility APIs, and captures the terminal state via xterm.js data channel.

- **Engine**: OS accessibility APIs (macOS only)
- **Upstream**: `npm:peekaboo`
- **Best for**: End-to-end testing against a real terminal application (e.g., testing your app in actual Ghostty or iTerm2). OS-level screenshots of the real terminal window.
- **Limitations**: macOS only. Requires accessibility permissions. Much slower than in-memory backends. Not suitable for unit tests.
- **Install**: `bunx termless backends install peekaboo` (or `npm install -D @termless/peekaboo`)

```typescript
// Factory function (preferred — explicit, sync)
import { createPeekabooBackend } from "@termless/peekaboo"
const term = createTerminal({ backend: createPeekabooBackend() })
```

```typescript
// By name (async)
import { backend } from "@termless/core"
const b = await backend("peekaboo")
const term = createTerminal({ backend: b })
```

### @termless/vt100-rust

Reference Rust implementation of VT100 terminal emulation. Uses the `vt100` Rust crate by doy — the same parser used in several terminal multiplexers.

**Feature support:** [Terminfo.dev](https://terminfo.dev/backends) does not currently publish a feature page for this library. The vt100.js page covers the separate TypeScript backend.

- **Engine**: vt100 0.15.0 (Rust via napi-rs)
- **Upstream**: `crate:vt100`
- **Best for**: Cross-validating the TypeScript vt100 backend. Finding disagreements between implementations. Reference conformance testing.
- **Limitations**: Requires Rust toolchain. Similar feature set to the TypeScript vt100 backend (no reflow, no OSC 8).
- **Install**: `bunx termless backends install vt100-rust` (or `npm install -D @termless/vt100-rust`; requires Rust build)

```typescript
// Factory function (preferred — explicit, sync)
import { createVt100RustBackend } from "@termless/vt100-rust"
const term = createTerminal({ backend: createVt100RustBackend() })
```

```typescript
// By name (async — handles native module loading)
import { backend } from "@termless/core"
const b = await backend("vt100-rust")
const term = createTerminal({ backend: b })
```

### @termless/libvterm

Neovim's VT parser compiled to WebAssembly via Emscripten. A completely different C implementation from all other backends — high conformance testing value.

**Feature support:** [Terminfo.dev](https://terminfo.dev/backends) does not currently publish a feature page for this library.

- **Engine**: libvterm (C via Emscripten WASM)
- **Upstream**: `github:neovim/libvterm`
- **Best for**: Cross-terminal conformance testing against neovim's parser. Finding bugs that only appear in C-based implementations.
- **Limitations**: Requires Emscripten SDK to build WASM. No Kitty keyboard, no reflow, no OSC 8.
- **Install**: `bunx termless backends install libvterm` (or `npm install -D @termless/libvterm`; requires Emscripten build)

```typescript
// Factory function (requires async WASM init)
import { createLibvtermBackend, initLibvterm } from "@termless/libvterm"
await initLibvterm()
const term = createTerminal({ backend: createLibvtermBackend() })
```

```typescript
// By name (handles WASM init automatically)
import { backend } from "@termless/core"
const b = await backend("libvterm")
const term = createTerminal({ backend: b })
```

### @termless/ghostty-native

Native Ghostty backend using Ghostty's VT Zig module via napigen N-API bindings. Same VT parser as the WASM `@termless/ghostty` backend, but running natively with no WASM overhead.

The `mouse-shape` extension reads the engine's logical W3C pointer state.
`semantic-cells` reads stored prompt/input/output cell types; `semantic-marks`
and `semantic-command-end` share the copied action-history reader. The adapter
retains typed command-end actions because the engine keeps no exit status.
Optional clipboard readback retains raw encoded writes and observes a typed
read request passed to the app; it supplies no clipboard reply. Histories last
until re-init/destroy, while reset follows the engine's actual cell/pointer state.
See [backend API](../api/backend.md) for status validation and reader lifetimes.
`kittyGraphics` reads the library's actual compiled flag; the pinned ghostty-vt
build disables its graphics support independently of the full application.

**Feature support:** [Ghostty results on terminfo.dev](https://terminfo.dev/terminals/ghostty) combine application and parser-backend results; no separate page isolates this library.

- **Engine**: ghostty-vt Zig module pinned to Ghostty 1.3.1 (napigen N-API)
- **Upstream**: `github:ghostty-org/ghostty`
- **Best for**: High-performance Ghostty conformance testing without WASM startup cost. Same parser fidelity as `@termless/ghostty` but faster.
- **Limitations**: Requires Zig 0.15.2+ to build. Not available as prebuilt binaries. The stable libghostty-vt C API migration is blocked until upstream tags or declares the C signatures stable enough for external bindings.
- **Install**: `bunx termless backends install ghostty-native` (requires Zig build)

```typescript
// Factory function (preferred — explicit, sync)
import { createGhosttyNativeBackend } from "@termless/ghostty-native"
const term = createTerminal({ backend: createGhosttyNativeBackend() })
```

```typescript
// By name (async — handles native module loading)
import { backend } from "@termless/core"
const b = await backend("ghostty-native")
const term = createTerminal({ backend: b })
```

### @termless/kitty

**Feature support:** [Kitty results on terminfo.dev](https://terminfo.dev/terminals/kitty) combine application and parser-backend results; no separate page isolates this library.

The `semantic-command-end` extension exposes the same
`SemanticMarkExtension.getSemanticMarks()` getter, returning copied, ordered
`{ type: "command-end", rawStatus: string }` entries from native OSC 133 D
callbacks. There are no coordinates or validated process exit codes: raw status
strings, including empty, zero, negative-looking and nonnumeric values, survive
verbatim. Kitty also declares `semantic-marks` for positional prompt and
output starts. It has no command/input start: Kitty 0.49.2 handles OSC 133
A, C and D, and 133 B is ignored. Both keys use the one reader.

Kitty's callback history preserves equal entries and survives reset and batch
replay. Cached rereads add nothing; `init()` starts fresh and `destroy()` clears
the history. Check the extension with `hasExtension()` before reading. Track A
compatibility read; migrate onto Emulator or delete with TerminalBackend at A4b.

Uses the separately installed Kitty executable through a `kitty +runpy` Python subprocess bridge. Kitty is GPL-3.0 licensed.

- **Engine**: installed Kitty VT parser (C through its embedded Python)
- **Upstream**: `github:kovidgoyal/kitty`
- **Best for**: Testing Kitty keyboard protocol, Kitty graphics protocol, and cross-checking against kitty's parser behavior. The only backend that decodes and stores Kitty graphics pixel data (`vterm` accepts the protocol handshake but does not render pixels).
- **Limitations**: Requires a working Kitty Python environment. Native `reverseVideo` and `syncOutput` reads require the attested runtime described below.
- **Install**: Install Kitty separately, then install `@termless/kitty` from npm. Source verification uses Nix; see the [Kitty package setup](https://github.com/beorn/termless/blob/main/packages/kitty/README.md#prerequisites).

The runtime loads no Termless `.node` binding or helper executable.
At build time, a C emitter measures the exact pinned Kitty headers through `.#kitty-native-mode-layout` in the declared Nix flake.
Its committed outputs are `build/native-mode-layout.json` and `build/native-mode-layout.receipt.json`; the metadata executable is build-only.
`build/build.sh` compares both files with the derivation output before checking the installed Kitty environment.

The native mode reader uses `ctypes` to read Kitty's live `Screen`.
`reverseVideo` reads `modes.mDECSCNM`; `syncOutput` reads whether `paused_rendering.expires_at` is nonzero.
The committed layout attests Kitty 0.49.2 at source `b2cb871254fbdac19a085188813c8dfb258b95cd`.
Its native-module SHA-256 is `6f28bbff8e8276d076957a718b9c1db21d1a42a7592890fab5171ee31db99619`.
It covers Linux x86_64, little-endian, 64-bit pointers, and normal-GIL CPython 3.14 without debug or trace-ref builds.
The 3,888-byte `Screen` has a one-byte reverse-video field at offset 667 and an eight-byte `int64_t` synchronization deadline at offset 1112.
The receipt records Python 3.14.3 build headers; their layout was checked against the attested Python 3.14.7 runtime.

Every snapshot validates the manifest digest, Kitty version/source/native-module digest, `Screen` type, platform, Python ABI flags, object size, and field types, widths, bounds and alignment.
If metadata is missing or the runtime does not match, `getMode("reverseVideo")` and `getMode("syncOutput")` throw `KITTY_NATIVE_STATE_UNAVAILABLE`.
Cells, cursor and other mode queries remain available through the generic bridge.

```typescript
// Factory function (preferred — explicit, sync)
import { createKittyBackend } from "@termless/kitty"
const term = createTerminal({ backend: createKittyBackend() })
```

```typescript
// By name (async — handles native module loading)
import { backend } from "@termless/core"
const b = await backend("kitty")
const term = createTerminal({ backend: b })
```

## Choosing a Backend

For most projects, the default xterm.js backend (included in `@termless/test`) is sufficient. Consider adding additional backends when:

- You ship a TUI that needs to work across different terminals
- You want to verify Kitty keyboard protocol handling (use Ghostty or Alacritty)
- You need sixel graphics testing (use WezTerm)
- You want the fastest possible zero-dep setup (use vt100)
- You need to test against a real terminal window (use Peekaboo)

See [Multi-Backend Testing](/guide/multi-backend) for how to configure Vitest to run tests against multiple backends.
