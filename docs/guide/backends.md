# Backend Capability Matrix

Each Termless backend wraps a different terminal emulator. They all implement the same `TerminalBackend` interface, but their underlying capabilities differ.

## Discovering Backends

Use the CLI to see available backends and their installation status:

```bash
# List all backends with install status and capabilities
bunx termless backends

# Check health of installed backends (version mismatches, missing deps)
bunx termless doctor
```

## Capability Matrix

| Capability              | xterm.js              | Ghostty           | vt100              | Alacritty                  | WezTerm                     | Peekaboo       | vt100-rust     | libvterm                 | Kitty                       |
| ----------------------- | --------------------- | ----------------- | ------------------ | -------------------------- | --------------------------- | -------------- | -------------- | ------------------------ | --------------------------- |
| **Truecolor (24-bit)**  | Yes                   | Yes               | Yes                | Yes                        | Yes                         | Yes            | Yes            | Yes                      | Yes                         |
| **Kitty keyboard**      | No                    | Yes               | No                 | Yes                        | Yes                         | No             | No             | No                       | Yes                         |
| **Kitty graphics**      | No                    | No                | No                 | No                         | No                          | No             | No             | No                       | Yes                         |
| **Sixel**               | No                    | No                | No                 | No                         | Yes                         | No             | No             | No                       | No                          |
| **OSC 8 hyperlinks**    | Yes                   | Yes               | No                 | Yes                        | Yes                         | Yes            | No             | No                       | Yes                         |
| **Semantic prompts**    | No                    | No                | No                 | No                         | Yes                         | No             | No             | No                       | No                          |
| **Unicode**             | 15.1                  | 15.1              | 15.1               | 15.1                       | 15.1                        | 15.1           | 15.1           | 15.1                     | 15.1                        |
| **Reflow on resize**    | Yes                   | Yes               | No                 | Yes                        | Yes                         | Yes            | No             | No                       | Yes                         |
| **Viewport scrolling**  | Yes                   | No                | Yes                | Yes                        | Yes                         | Yes            | Yes            | Yes                      | Yes                         |
| **OS-level screenshot** | No                    | No                | No                 | No                         | No                          | Yes            | No             | No                       | No                          |
| **Native deps**         | None                  | WASM              | None               | Rust (napi-rs)             | Rust (napi-rs)              | None           | Rust (napi-rs) | WASM (Emscripten)        | C (built from GPL source)   |
| **Upstream**            | `npm:@xterm/headless` | `npm:ghostty-web` | _(self-contained)_ | `crate:alacritty_terminal` | `crate:tattoy-wezterm-term` | `npm:peekaboo` | `crate:vt100`  | `github:neovim/libvterm` | `github:kovidgoyal/kitty`   |
| **Build requirement**   | None                  | None              | None               | Rust toolchain             | Rust toolchain              | None           | Rust toolchain | Emscripten SDK           | C compiler + Python 3 + git |

## Backend Details

Each backend can be used via factory function (explicit, sync) or string name via `backend()` (async — handles WASM/native init). The registry handles backend-specific initialization (WASM loading, native module binding).

### @termless/xtermjs

The default backend. Uses `@xterm/headless` — the same xterm.js terminal emulator used in VS Code's integrated terminal, but without a DOM renderer.

- **Engine**: @xterm/headless 5.5
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

- **Engine**: ghostty-web 0.4 (WebAssembly)
- **Upstream**: `npm:ghostty-web`
- **Best for**: Testing against a modern, standards-compliant parser. Verifying Kitty keyboard protocol support.
- **Limitations**: WASM build does not support viewport scrolling or Kitty graphics. OSC title changes have no callback in WASM mode.
- **Install**: `bunx termless install ghostty` (or `npm install -D @termless/ghostty`)

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

- **Engine**: Built-in (pure TypeScript, zero deps)
- **Upstream**: `npm:@termless/vt100` (self-contained)
- **Best for**: Environments where you want zero native dependencies and zero WASM. CI runners with constrained environments.
- **Limitations**: No reflow on resize. No OSC 8 hyperlinks. No Kitty keyboard. More limited escape sequence coverage than xterm.js or Ghostty.
- **Install**: `bunx termless install vt100` (or `npm install -D @termless/vt100`)

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

### @termless/alacritty

Uses Alacritty's `alacritty_terminal` crate via napi-rs native bindings. Alacritty is a GPU-accelerated terminal focused on simplicity and performance.

- **Engine**: alacritty_terminal 0.26 (Rust via napi-rs)
- **Upstream**: `crate:alacritty_terminal`
- **Best for**: Testing against Alacritty's VT parser. Cross-checking reflow behavior.
- **Limitations**: Requires Rust toolchain to build native bindings. Not available as prebuilt binaries yet.
- **Install**: `bunx termless install alacritty` (or `npm install -D @termless/alacritty`; requires Rust build)

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

- **Engine**: tattoy-wezterm-term (Rust via napi-rs)
- **Upstream**: `crate:tattoy-wezterm-term`
- **Best for**: Testing sixel graphics support, semantic prompts, and the widest protocol coverage.
- **Limitations**: Requires Rust toolchain to build native bindings. Not available as prebuilt binaries yet.
- **Install**: `bunx termless install wezterm` (or `npm install -D @termless/wezterm`; requires Rust build)

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
- **Install**: `bunx termless install peekaboo` (or `npm install -D @termless/peekaboo`)

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

- **Engine**: vt100 0.15.0 (Rust via napi-rs)
- **Upstream**: `crate:vt100`
- **Best for**: Cross-validating the TypeScript vt100 backend. Finding disagreements between implementations. Reference conformance testing.
- **Limitations**: Requires Rust toolchain. Similar feature set to the TypeScript vt100 backend (no reflow, no OSC 8).
- **Install**: `bunx termless install vt100-rust` (or `npm install -D @termless/vt100-rust`; requires Rust build)

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

- **Engine**: libvterm (C via Emscripten WASM)
- **Upstream**: `github:neovim/libvterm`
- **Best for**: Cross-terminal conformance testing against neovim's parser. Finding bugs that only appear in C-based implementations.
- **Limitations**: Requires Emscripten SDK to build WASM. No Kitty keyboard, no reflow, no OSC 8.
- **Install**: `bunx termless install libvterm` (or `npm install -D @termless/libvterm`; requires Emscripten build)

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

### @termless/kitty

Kitty's VT parser built from GPL-3.0 source. Kitty is a modern, feature-rich terminal with its own keyboard protocol and graphics protocol.

- **Engine**: kitty VT parser (C, built from source)
- **Upstream**: `github:kovidgoyal/kitty`
- **Best for**: Testing Kitty keyboard protocol, Kitty graphics protocol, and cross-checking against kitty's parser behavior. The only backend with Kitty graphics support.
- **Limitations**: Requires building from GPL-3.0 source (C compiler + Python 3 + git). The resulting `.node` binary is GPL-3.0 and must not be distributed. Build script is WIP.
- **Install**: `bunx termless install kitty` (or `npm install -D @termless/kitty`; requires build from source)

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
