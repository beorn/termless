# Contributing to termless

## Getting Started

1. Fork and clone the repo
2. Install dependencies: `bun install`
3. Run tests: `bun vitest run`
4. Create a branch for your changes

## Development

### Code Style

- **Factory functions** — no classes, no globals
- **`using` cleanup pattern** — for resource management
- **Explicit dependency injection** — pass dependencies as arguments
- **No `require`** — ESM only

### Testing

```bash
bun vitest run                    # Run all tests
bun vitest run packages/xtermjs/  # Run tests for a specific package
```

Write tests for all new functionality. For rendering/terminal behavior, use the `viterm` matchers.

### Type Checking

```bash
bun run typecheck
```

## Packages

| Package | What it does |
|---------|-------------|
| `termless` (root) | Core types, Terminal API, PTY, SVG screenshots, key mapping |
| `termless-xtermjs` | xterm.js backend using @xterm/headless |
| `termless-ghostty` | Ghostty backend (ghostty-web WASM) |
| `termless-vt100` | Pure TypeScript VT100 emulator (zero native deps) |
| `termless-alacritty` | Alacritty backend (alacritty_terminal via napi-rs) |
| `termless-wezterm` | WezTerm backend (wezterm-term via napi-rs) |
| `termless-peekaboo` | OS-level terminal automation (xterm.js + real app) |
| `viterm` | Vitest matchers, fixtures, and snapshot serializer |
| `termless-cli` | CLI tool and MCP server |

## Submitting Changes

1. Ensure tests pass: `bun vitest run`
2. Ensure types check: `bun run typecheck`
3. Write clear commit messages following [Conventional Commits](https://conventionalcommits.org)
4. Open a PR against `main`

## Adding a New Backend

This section walks through implementing a new `TerminalBackend`. Use the xterm.js and Ghostty backends as reference implementations.

### Checklist

#### 1. Package files (create)

Create `packages/<name>/` with these files:

**`packages/<name>/package.json`**

```json
{
  "name": "termless-<name>",
  "version": "0.1.0",
  "description": "<Name> backend for termless",
  "license": "MIT",
  "author": "Beorn",
  "repository": {
    "type": "git",
    "url": "https://github.com/beorn/termless",
    "directory": "packages/<name>"
  },
  "engines": { "bun": ">=1.0.0" },
  "files": ["src"],
  "type": "module",
  "module": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "<native-package>": "^x.y.z"
  },
  "peerDependencies": {
    "termless": "workspace:*"
  }
}
```

Native dependencies go in `dependencies`. termless core goes in `peerDependencies` as `workspace:*`.

**`packages/<name>/src/index.ts`** -- re-export the factory function (and async init if needed):

```typescript
export { create<Name>Backend } from "./backend.ts"
// If async init is needed (e.g., WASM loading):
// export { create<Name>Backend, init<Name> } from "./backend.ts"
```

**`packages/<name>/src/backend.ts`** -- the `TerminalBackend` implementation (see [TerminalBackend Interface](#terminalbackend-interface-18-methods) below).

**`packages/<name>/tests/backend.test.ts`** -- unit tests covering lifecycle, text I/O, colors, attributes, cursor, modes, key encoding, scrollback, resize, reset, wide characters, and capabilities.

**`packages/<name>/tests/CLAUDE.md`** -- test scope documentation. Follow the pattern from `packages/xtermjs/tests/CLAUDE.md`: describe what to test here, what NOT to test here (cross-backend goes in root `tests/`, matchers go in viterm), patterns, and ad-hoc testing commands.

#### 2. Registration (modify existing files)

**`tests/cross-backend.test.ts`** -- add your backend to the `backends` array:

```typescript
import { create<Name>Backend } from "../packages/<name>/src/backend.ts"

const backends: [string, BackendFactory][] = [
  ["xterm", () => createXtermBackend()],
  ["ghostty", () => createGhosttyBackend(undefined, ghostty)],
  ["<name>", () => create<Name>Backend()],  // <-- add this
]
```

If your backend requires async initialization (like Ghostty's WASM), add it to the `beforeAll`:

```typescript
let <name>Instance: <NativeType>
beforeAll(async () => {
  ghostty = await initGhostty()
  <name>Instance = await init<Name>()  // <-- add this
})
```

**`tests/compat-matrix.ts`** -- add to the `backendFactories` array:

```typescript
const backendFactories: [string, () => TerminalBackend][] = [
  ["xterm.js", () => createXtermBackend()],
  ["ghostty", () => createGhosttyBackend(undefined, ghostty)],
  ["<name>", () => create<Name>Backend()],  // <-- add this
]
```

#### 3. Documentation (modify existing files)

- **`README.md`** -- add row to the Packages table
- **`CLAUDE.md`** -- add row to the Packages table and update the Architecture diagram
- **`CONTRIBUTING.md`** -- add row to the Packages table (below)
- **`CHANGELOG.md`** -- add a section under the current version
- **`docs/multi-backend.md`** -- add a setup file example for the new backend

### TerminalBackend Interface (18 methods)

All backends implement `TerminalBackend` (defined in `src/types.ts`). The interface extends `TerminalReadable` and adds lifecycle, data flow, key encoding, scrollback, and capability methods.

#### Lifecycle (3 methods)

| Method | Signature | Description |
|--------|-----------|-------------|
| `init` | `(opts: TerminalOptions) => void` | Initialize (or re-initialize) the terminal with given dimensions. If already initialized, dispose the old instance first. |
| `destroy` | `() => void` | Free all resources. Safe to call multiple times. |
| `name` | `readonly string` | Backend identifier (e.g., `"xterm"`, `"ghostty"`). |

`TerminalOptions` has `cols: number`, `rows: number`, and optional `scrollbackLimit?: number` (default 1000).

#### Data Flow (3 methods)

| Method | Signature | Description |
|--------|-----------|-------------|
| `feed` | `(data: Uint8Array) => void` | Feed raw terminal data (escape sequences, text). Must be synchronous -- callers expect state to be updated immediately after `feed()` returns. |
| `resize` | `(cols: number, rows: number) => void` | Resize the terminal. Content should be preserved. |
| `reset` | `() => void` | Reset to initial state (equivalent to RIS `\x1bc`). Clear screen, reset modes, clear title. |

#### Reading (9 methods from TerminalReadable)

| Method | Signature | Description |
|--------|-----------|-------------|
| `getText` | `() => string` | Full buffer text (scrollback + screen), lines joined with `\n`. Trailing whitespace per line should be trimmed. |
| `getTextRange` | `(startRow, startCol, endRow, endCol) => string` | Text from a rectangular region. |
| `getCell` | `(row: number, col: number) => Cell` | Single cell at screen position. Return empty cell for out-of-bounds. |
| `getLine` | `(row: number) => Cell[]` | All cells in a screen row (length = cols). |
| `getLines` | `() => Cell[][]` | All screen rows (length = rows). |
| `getCursor` | `() => CursorState` | Cursor position (`x`, `y`), `visible`, and `style`. |
| `getMode` | `(mode: TerminalMode) => boolean` | Query a terminal mode. Must support all 11 modes in the `TerminalMode` union. |
| `getTitle` | `() => string` | Current OSC 2 title. |
| `getScrollback` | `() => ScrollbackState` | Scrollback state: `viewportOffset`, `totalLines`, `screenLines`. |

#### Key Encoding (1 method)

| Method | Signature | Description |
|--------|-----------|-------------|
| `encodeKey` | `(key: KeyDescriptor) => Uint8Array` | Encode a key descriptor to ANSI byte sequence. Handle special keys (arrows, function keys, Enter, Escape, etc.), Ctrl+letter (ASCII 1-26), Alt+letter (ESC prefix), and modifier combinations (CSI parameter encoding). |

#### Scrollback (1 method)

| Method | Signature | Description |
|--------|-----------|-------------|
| `scrollViewport` | `(delta: number) => void` | Scroll the viewport by delta lines (positive = down). No-op if not supported by the backend. |

#### Capabilities (1 property)

| Property | Type | Description |
|----------|------|-------------|
| `capabilities` | `readonly TerminalCapabilities` | Static capabilities: `name`, `version`, `truecolor`, `kittyKeyboard`, `kittyGraphics`, `sixel`, `osc8Hyperlinks`, `semanticPrompts`, `unicode` version, `reflow`, and `extensions` (a `Set<string>` for optional interfaces like `"dirtyTracking"`). |

### Cell Format

The `Cell` type returned by `getCell`/`getLine`/`getLines`:

```typescript
interface Cell {
  text: string           // Character(s) at this position ("" for empty)
  fg: RGB | null         // Foreground color (null = terminal default)
  bg: RGB | null         // Background color (null = terminal default)
  bold: boolean
  faint: boolean
  italic: boolean
  underline: UnderlineStyle  // "none" | "single" | "double" | "curly" | "dotted" | "dashed"
  strikethrough: boolean
  inverse: boolean
  wide: boolean          // true for double-width characters (CJK, emoji)
}
```

Colors must be `null` for the terminal's default fg/bg (not `{ r: 0, g: 0, b: 0 }`). This is critical for correct matcher behavior. See how the Ghostty backend uses `isDefaultColor()` to detect and map default colors to `null`.

### Key Patterns

#### Factory function with closure state

Both existing backends use the same pattern -- a factory function that returns an object literal implementing `TerminalBackend`, with all state captured in closure variables:

```typescript
export function create<Name>Backend(opts?: Partial<TerminalOptions>): TerminalBackend {
  let term: NativeTerminal | null = null
  let title = ""

  function ensureTerm(): NativeTerminal {
    if (!term) throw new Error("<name> backend not initialized — call init() first")
    return term
  }

  function init(options: TerminalOptions): void {
    if (term) { /* dispose old instance */ }
    term = createNativeTerminal(options.cols, options.rows, {
      scrollback: options.scrollbackLimit ?? 1000,
    })
    title = ""
  }

  // ... implement all 18 methods ...

  return {
    name: "<name>",
    init,
    destroy,
    feed,
    resize,
    reset,
    getText,
    getTextRange,
    getCell,
    getLine,
    getLines,
    getCursor,
    getMode,
    getTitle,
    getScrollback,
    scrollViewport,
    encodeKey: encodeKeyToAnsi,
    capabilities,
  }
}
```

No classes, no globals, no `this`. State lives in closure variables (`term`, `title`, etc.).

#### Async WASM initialization

If the native library requires async loading (like Ghostty's WASM), use a module-level singleton pattern:

```typescript
let shared: NativeLib | null = null
let initPromise: Promise<NativeLib> | null = null

export async function init<Name>(): Promise<NativeLib> {
  if (shared) return shared
  if (initPromise) return initPromise
  initPromise = NativeLib.load().then((lib) => {
    shared = lib
    return lib
  })
  return initPromise
}
```

The factory function should accept an optional pre-loaded instance parameter for test isolation:

```typescript
export function create<Name>Backend(
  opts?: Partial<TerminalOptions>,
  nativeLib?: NativeLib,
): TerminalBackend {
  let instance = nativeLib ?? null
  // In init(), throw if instance is null (not yet loaded)
}
```

#### Synchronous feed

`feed()` must be synchronous from the caller's perspective. If the underlying library uses async writes (like xterm.js), use internal sync APIs:

```typescript
// xterm.js uses an internal writeSync to bypass async write()
function writeSync(t: Terminal, data: string): void {
  ;(t as any)._core._writeBuffer.writeSync(data)
}
```

If the native library requires an explicit update/flush step (like Ghostty), call it after every write:

```typescript
function feed(data: Uint8Array): void {
  const t = ensureTerm()
  t.write(data)
  t.update()  // Sync render state
}
```

#### Key encoding

Key encoding is identical across both existing backends -- standard ANSI escape sequences. You can reuse the same `encodeKeyToAnsi()` function. The shared logic handles:

- **Ctrl+letter**: ASCII control codes 1-26 (`charCodeAt(0) - 96`)
- **Alt+letter**: ESC prefix (`\x1b` + character)
- **Special keys**: Lookup table (`ArrowUp` -> `\x1b[A`, `Enter` -> `\r`, etc.)
- **Modifiers on special keys**: CSI parameter encoding (`\x1b[1;{mod}{suffix}` where mod = `(shift|1) + (alt|2) + (ctrl|4) + 1`)
- **Regular characters**: Pass through as UTF-8

If your terminal supports Kitty keyboard protocol or other extended encoding, implement that as well and declare it in `capabilities.kittyKeyboard`.

#### Color handling

Map the native library's color representation to termless `RGB | null`:

- **Default colors → `null`**: The terminal's default fg/bg must map to `null`, not to an RGB value. Cross-backend matchers depend on this.
- **True color (24-bit)**: Extract R, G, B from the native format.
- **256-color palette**: Convert palette index to RGB using the standard 256-color table (16 base + 216 cube + 24 grayscale). See `buildPalette256()` in the xterm.js backend.
- **ANSI 16-color**: Use the standard ANSI palette mapping.

#### Terminal modes

The `getMode()` method must handle all 11 `TerminalMode` values. Map each to the native library's mode query API:

| Mode | Typical DEC/ANSI code | What it means |
|------|----------------------|---------------|
| `altScreen` | DECSET 1049 | Alternate screen buffer |
| `cursorVisible` | DECTCEM (mode 25) | Cursor visibility |
| `bracketedPaste` | DECSET 2004 | Bracketed paste mode |
| `applicationCursor` | DECCKM (mode 1) | Application cursor keys |
| `applicationKeypad` | DECNKM (mode 66) | Application keypad |
| `autoWrap` | DECAWM (mode 7) | Auto-wrap at right margin |
| `mouseTracking` | DECSET 1000+ | Any mouse tracking mode |
| `focusTracking` | DECSET 1004 | Focus in/out events |
| `originMode` | DECOM (mode 6) | Origin mode |
| `insertMode` | IRM (ANSI mode 4) | Insert mode |
| `reverseVideo` | DECSCNM (mode 5) | Reverse video |

Some backends may not expose all modes. Return `false` for modes you can't detect and document the limitation in `capabilities.extensions`.

### Extension Interfaces

Beyond the core `TerminalBackend`, termless defines optional extension interfaces in `src/types.ts`. If your backend supports any of these, add the extension name to `capabilities.extensions`:

| Extension | Interface | Capability string |
|-----------|-----------|-------------------|
| Mouse encoding | `MouseEncodingExtension` | `"mouseEncoding"` |
| Color palette mutation | `ColorPaletteExtension` | `"colorPalette"` |
| Dirty row tracking | `DirtyTrackingExtension` | `"dirtyTracking"` |
| OSC 8 hyperlinks | `HyperlinkExtension` | `"hyperlinks"` |
| Bell detection | `BellExtension` | `"bell"` |

Use `hasExtension<T>(backend, "extensionName")` to type-narrow at runtime.

### Testing Your Backend

Write at minimum these test categories in `packages/<name>/tests/backend.test.ts`:

1. **Lifecycle**: create, init, destroy, re-init, ensureTerm guard
2. **Text I/O**: plain text, multiline, cursor positioning (CUP)
3. **Colors**: ANSI 16, 256-color palette, truecolor 24-bit, fg and bg
4. **Attributes**: bold, italic, faint, underline, strikethrough, inverse, combined
5. **Wide characters**: CJK, emoji, spacer cells
6. **Cursor**: position after text, after newline, after CUP
7. **Modes**: alt screen on/off, bracketed paste, auto wrap
8. **Key encoding**: Enter, Escape, Ctrl+letter, arrows, modifiers
9. **Scrollback**: state reporting, accumulation over rows
10. **Resize**: content preservation
11. **Reset**: clears screen and title
12. **Capabilities**: name, truecolor, other declared capabilities

After your backend-specific tests pass, run the cross-backend conformance suite to verify agreement with existing backends:

```bash
bun vitest run vendor/beorn-termless/tests/cross-backend.test.ts --project vendor
bun vendor/beorn-termless/tests/compat-matrix.ts
```

## Reporting Issues

Open an issue at https://github.com/beorn/termless/issues with:
- What you expected
- What happened instead
- Minimal reproduction steps
