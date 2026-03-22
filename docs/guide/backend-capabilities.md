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

### @termless/xtermjs

The default backend. Uses `@xterm/headless` — the same xterm.js terminal emulator used in VS Code's integrated terminal, but without a DOM renderer.

- **Best for**: Most testing scenarios. Well-tested, stable, zero native dependencies.
- **Limitations**: No Kitty keyboard protocol. Emoji width detection may differ from native terminals in headless mode.
- **Install**: Included automatically with `@termless/test`.

### @termless/ghostty

Uses Ghostty's VT parser via `ghostty-web` WASM. Ghostty is a modern GPU-accelerated terminal with strong standards compliance.

- **Best for**: Testing against a modern, standards-compliant parser. Verifying Kitty keyboard protocol support.
- **Limitations**: WASM build does not support viewport scrolling or Kitty graphics. OSC title changes have no callback in WASM mode.
- **Install**: `npx termless install ghostty` (or `npm install -D @termless/ghostty`)

### @termless/vt100

Pure TypeScript VT100 emulator with zero dependencies. Lightweight and fast, inspired by the Rust `vt100` crate.

- **Best for**: Environments where you want zero native dependencies and zero WASM. CI runners with constrained environments.
- **Limitations**: No reflow on resize. No OSC 8 hyperlinks. No Kitty keyboard. More limited escape sequence coverage than xterm.js or Ghostty.
- **Install**: `npx termless install vt100` (or `npm install -D @termless/vt100`)

### @termless/alacritty

Uses Alacritty's `alacritty_terminal` crate via napi-rs native bindings. Alacritty is a GPU-accelerated terminal focused on simplicity and performance.

- **Best for**: Testing against Alacritty's VT parser. Cross-checking reflow behavior.
- **Limitations**: Requires Rust toolchain to build native bindings. Not available as prebuilt binaries yet.
- **Install**: `npx termless install alacritty` (or `npm install -D @termless/alacritty`; requires Rust build)

### @termless/wezterm

Uses WezTerm's `wezterm-term` VT parser via napi-rs native bindings. WezTerm has the broadest feature set of any terminal emulator.

- **Best for**: Testing sixel graphics support, semantic prompts, and the widest protocol coverage.
- **Limitations**: Requires Rust toolchain to build native bindings. Not available as prebuilt binaries yet.
- **Install**: `npx termless install wezterm` (or `npm install -D @termless/wezterm`; requires Rust build)

### @termless/peekaboo

OS-level terminal automation. Launches a real terminal application, sends keystrokes via OS accessibility APIs, and captures the terminal state via xterm.js data channel.

- **Best for**: End-to-end testing against a real terminal application (e.g., testing your app in actual Ghostty or iTerm2). OS-level screenshots of the real terminal window.
- **Limitations**: macOS only. Requires accessibility permissions. Much slower than in-memory backends. Not suitable for unit tests.
- **Install**: `npx termless install peekaboo` (or `npm install -D @termless/peekaboo`)

## Choosing a Backend

For most projects, the default xterm.js backend (included in `@termless/test`) is sufficient. Consider adding additional backends when:

- You ship a TUI that needs to work across different terminals
- You want to verify Kitty keyboard protocol handling (use Ghostty or Alacritty)
- You need sixel graphics testing (use WezTerm)
- You want the fastest possible zero-dep setup (use vt100)
- You need to test against a real terminal window (use Peekaboo)

See [Multi-Backend Testing](/guide/multi-backend) for how to configure Vitest to run tests against multiple backends.
