This is a patched, source-backed distribution of ghostty-web0.4.0, never an upstream release. See RECEIPT.json and the removal tracker @si/terminfo/30211-terminfo-273/31257-remove-private-ghostty.

The package manifest retains upstream consumer metadata; build scripts and development dependencies are omitted from this installable distribution. Rebuilds use the pinned upstream archive's own manifest and lockfile through rebuild.ts.

The private reply path traps on stream/producer errors. The wrapper propagates those failures, frees write input in `finally`, and distinguishes a failed response read from an empty buffer. RECEIPT.json pins the rebuilt artifacts.

`GhosttyTerminal.getCwd()` reads the engine's OSC 7 directory store as a literal string or null. This library applies no URI scheme/host policy, percent-decoding or backslash conversion; those belong to the Ghostty app. The last completed callback wins. On pinned core `5714ed07`, OSC dispatch occurs at ESC before the ST backslash; an incomplete payload keeps the prior directory, an empty payload means null, and a 4097-byte payload is ignored. Initial state, full reset, RIS and re-init return null. Measured OSC 633 `P;Cwd=` with BEL or ST, and `A`, leave a working OSC 7 value unchanged. Strings returned to callers survive later mutations and instances remain independent.

The web reader uses the existing fatal UTF-8 decoder: invalid bytes throw `TypeError`, while the native binding replaces invalid bytes with U+FFFD. A thrown lookup is an error, never absence or a support grade. The borrowed pointer/length is decoded before another WASM call; scratch is freed on success and failure. Missing reader/ABI exports fail with a rebuild instruction or named missing export.

# ghostty-web

[![NPM Version](https://img.shields.io/npm/v/ghostty-web)](https://npmjs.com/package/ghostty-web) [![NPM Downloads](https://img.shields.io/npm/dw/ghostty-web)](https://npmjs.com/package/ghostty-web) [![npm bundle size](https://img.shields.io/bundlephobia/minzip/ghostty-web)](https://npmjs.com/package/ghostty-web) [![license](https://img.shields.io/github/license/coder/ghostty-web)](./LICENSE)

[Ghostty](https://github.com/ghostty-org/ghostty) for the web with [xterm.js](https://github.com/xtermjs/xterm.js) API compatibility — giving you a proper VT100 implementation in the browser.

- Migrate from xterm by changing your import: `@xterm/xterm` → `ghostty-web`
- WASM-compiled parser from Ghostty—the same code that runs the native app
- Zero runtime dependencies, ~400KB WASM bundle

Originally created for [Mux](https://github.com/coder/mux) (a desktop app for isolated, parallel agentic development), but designed to be used anywhere.

## Try It

- [Live Demo](https://ghostty.ondis.co) on an ephemeral VM (thank you to Greg from [disco.cloud](https://disco.cloud) for hosting).

- On your computer:

  ```bash
  npx @ghostty-web/demo@next
  ```

  This starts a local HTTP server with a real shell on `http://localhost:8080`. Works best on Linux and macOS.

![ghostty](https://github.com/user-attachments/assets/aceee7eb-d57b-4d89-ac3d-ee1885d0187a)

## Comparison with xterm.js

xterm.js is everywhere—VS Code, Hyper, countless web terminals. But it has fundamental issues:

| Issue                                    | xterm.js                                                         | ghostty-web                |
| ---------------------------------------- | ---------------------------------------------------------------- | -------------------------- |
| **Complex scripts** (Devanagari, Arabic) | Rendering issues                                                 | ✓ Proper grapheme handling |
| **XTPUSHSGR/XTPOPSGR**                   | [Not supported](https://github.com/xtermjs/xterm.js/issues/2570) | ✓ Full support             |

xterm.js reimplements terminal emulation in JavaScript. Every escape sequence, every edge case, every Unicode quirk—all hand-coded. Ghostty's emulator is the same battle-tested code that runs the native Ghostty app.

## Installation

```bash
npm install ghostty-web
```

## Usage

ghostty-web aims to be API-compatible with the xterm.js API.

```javascript
import { init, Terminal } from "ghostty-web"

await init()

const term = new Terminal({
  fontSize: 14,
  theme: {
    background: "#1a1b26",
    foreground: "#a9b1d6",
  },
})

term.open(document.getElementById("terminal"))
term.onData((data) => websocket.send(data))
websocket.onmessage = (e) => term.write(e.data)
```

For a comprehensive client <-> server example, refer to the [demo](./demo/index.html#L141).

## Development

ghostty-web builds from Ghostty's source with a [patch](./patches/ghostty-wasm-api.patch) to expose additional
functionality.

> Requires Zig and Bun.

```bash
bun run build
```

Mitchell Hashimoto (author of Ghostty) has [been working](https://mitchellh.com/writing/libghostty-is-coming) on `libghostty` which makes this all possible. The patches are very minimal thanks to the work the Ghostty team has done, and we expect them to get smaller.

This library will eventually consume a native Ghostty WASM distribution once available, and will continue to provide an xterm.js compatible API.

At Coder we're big fans of Ghostty, so kudos to that team for all the amazing work.

## License

[MIT](./LICENSE)
