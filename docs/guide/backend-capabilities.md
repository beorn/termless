# Backend Capability Matrix

Each Termless backend wraps a different terminal emulator. They all implement the same `TerminalBackend` interface, but their underlying capabilities differ.

## Discovering Backends

Use the CLI to see available backends and their installation status:

```bash
# List all backends with install status and capabilities
npx termless backends

# Check health of installed backends (version mismatches, missing deps)
npx termless doctor
```

## Capability Matrix

| Capability              | xterm.js | Ghostty | vt100 | Alacritty      | WezTerm        | Peekaboo |
| ----------------------- | -------- | ------- | ----- | -------------- | -------------- | -------- |
| **Truecolor (24-bit)**  | Yes      | Yes     | Yes   | Yes            | Yes            | Yes      |
| **Kitty keyboard**      | No       | Yes     | No    | Yes            | Yes            | No       |
| **Kitty graphics**      | No       | No      | No    | No             | No             | No       |
| **Sixel**               | No       | No      | No    | No             | Yes            | No       |
| **OSC 8 hyperlinks**    | Yes      | Yes     | No    | Yes            | Yes            | Yes      |
| **Semantic prompts**    | No       | No      | No    | No             | Yes            | No       |
| **Unicode**             | 15.1     | 15.1    | 15.1  | 15.1           | 15.1           | 15.1     |
| **Reflow on resize**    | Yes      | Yes     | No    | Yes            | Yes            | Yes      |
| **Viewport scrolling**  | Yes      | No      | Yes   | Yes            | Yes            | Yes      |
| **OS-level screenshot** | No       | No      | No    | No             | No             | Yes      |
| **Native deps**         | None     | WASM    | None  | Rust (napi-rs) | Rust (napi-rs) | None     |
| **Build requirement**   | None     | None    | None  | Rust toolchain | Rust toolchain | None     |

## Backend Details

Each backend can be used via factory function (explicit, sync) or string name (via registry, async). The registry handles backend-specific initialization (WASM loading, native module binding).

### @termless/xtermjs

The default backend. Uses `@xterm/headless` — the same xterm.js terminal emulator used in VS Code's integrated terminal, but without a DOM renderer.

- **Engine**: @xterm/headless 5.5
- **Best for**: Most testing scenarios. Well-tested, stable, zero native dependencies.
- **Limitations**: No Kitty keyboard protocol. Emoji width detection may differ from native terminals in headless mode.
- **Install**: Included automatically with `@termless/test`.

```typescript
// Factory function
import { createXtermBackend } from "@termless/xtermjs"
const term = createTerminal({ backend: createXtermBackend() })

// String name
const term = await createTerminalByName("xtermjs")
```

### @termless/ghostty

Uses Ghostty's VT parser via `ghostty-web` WASM. Ghostty is a modern GPU-accelerated terminal with strong standards compliance.

- **Engine**: ghostty-web 0.4 (WebAssembly)
- **Best for**: Testing against a modern, standards-compliant parser. Verifying Kitty keyboard protocol support.
- **Limitations**: WASM build does not support viewport scrolling or Kitty graphics. OSC title changes have no callback in WASM mode.
- **Install**: `npx termless install ghostty` (or `npm install -D @termless/ghostty`)

```typescript
// Factory function (requires async WASM init)
import { createGhosttyBackend, initGhostty } from "@termless/ghostty"
const ghostty = await initGhostty()
const term = createTerminal({ backend: createGhosttyBackend(undefined, ghostty) })

// String name (handles WASM init automatically)
const term = await createTerminalByName("ghostty")
```

### @termless/vt100

Pure TypeScript VT100 emulator with zero dependencies. Lightweight and fast, inspired by the Rust `vt100` crate.

- **Engine**: Built-in (pure TypeScript, zero deps)
- **Best for**: Environments where you want zero native dependencies and zero WASM. CI runners with constrained environments.
- **Limitations**: No reflow on resize. No OSC 8 hyperlinks. No Kitty keyboard. More limited escape sequence coverage than xterm.js or Ghostty.
- **Install**: `npx termless install vt100` (or `npm install -D @termless/vt100`)

```typescript
// Factory function
import { createVt100Backend } from "@termless/vt100"
const term = createTerminal({ backend: createVt100Backend() })

// String name
const term = await createTerminalByName("vt100")
```

### @termless/alacritty

Uses Alacritty's `alacritty_terminal` crate via napi-rs native bindings. Alacritty is a GPU-accelerated terminal focused on simplicity and performance.

- **Engine**: alacritty_terminal 0.25 (Rust via napi-rs)
- **Best for**: Testing against Alacritty's VT parser. Cross-checking reflow behavior.
- **Limitations**: Requires Rust toolchain to build native bindings. Not available as prebuilt binaries yet.
- **Install**: `npx termless install alacritty` (or `npm install -D @termless/alacritty`; requires Rust build)

```typescript
// Factory function
import { createAlacrittyBackend } from "@termless/alacritty"
const term = createTerminal({ backend: createAlacrittyBackend() })

// String name (handles native module loading)
const term = await createTerminalByName("alacritty")
```

### @termless/wezterm

Uses WezTerm's `wezterm-term` VT parser via napi-rs native bindings. WezTerm has the broadest feature set of any terminal emulator.

- **Engine**: wezterm-term (Rust via napi-rs)
- **Best for**: Testing sixel graphics support, semantic prompts, and the widest protocol coverage.
- **Limitations**: Requires Rust toolchain to build native bindings. Not available as prebuilt binaries yet.
- **Install**: `npx termless install wezterm` (or `npm install -D @termless/wezterm`; requires Rust build)

```typescript
// Factory function
import { createWeztermBackend } from "@termless/wezterm"
const term = createTerminal({ backend: createWeztermBackend() })

// String name (handles native module loading)
const term = await createTerminalByName("wezterm")
```

### @termless/peekaboo

OS-level terminal automation. Launches a real terminal application, sends keystrokes via OS accessibility APIs, and captures the terminal state via xterm.js data channel.

- **Engine**: OS accessibility APIs (macOS only)
- **Best for**: End-to-end testing against a real terminal application (e.g., testing your app in actual Ghostty or iTerm2). OS-level screenshots of the real terminal window.
- **Limitations**: macOS only. Requires accessibility permissions. Much slower than in-memory backends. Not suitable for unit tests.
- **Install**: `npx termless install peekaboo` (or `npm install -D @termless/peekaboo`)

```typescript
// Factory function
import { createPeekabooBackend } from "@termless/peekaboo"
const term = createTerminal({ backend: createPeekabooBackend() })

// String name
const term = await createTerminalByName("peekaboo")
```

## Choosing a Backend

For most projects, the default xterm.js backend (included in `@termless/test`) is sufficient. Consider adding additional backends when:

- You ship a TUI that needs to work across different terminals
- You want to verify Kitty keyboard protocol handling (use Ghostty or Alacritty)
- You need sixel graphics testing (use WezTerm)
- You want the fastest possible zero-dep setup (use vt100)
- You need to test against a real terminal window (use Peekaboo)

See [Multi-Backend Testing](/guide/multi-backend) for how to configure Vitest to run tests against multiple backends.
