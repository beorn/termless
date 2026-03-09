# API: TerminalBackend

```typescript
import type { TerminalBackend, TerminalOptions, TerminalCapabilities } from "@termless/core"
```

## TerminalBackend Interface

All backends must implement this interface. Users typically don't interact with backends directly -- `createTerminal()` wraps them.

```typescript
interface TerminalBackend extends TerminalReadable {
  readonly name: string

  // Lifecycle
  init(opts: TerminalOptions): void
  destroy(): void

  // Data flow
  feed(data: Uint8Array): void
  resize(cols: number, rows: number): void
  reset(): void

  // Key encoding
  encodeKey(key: KeyDescriptor): Uint8Array

  // Scrollback
  scrollViewport(delta: number): void

  // Capabilities
  readonly capabilities: TerminalCapabilities
}
```

## TerminalOptions

```typescript
interface TerminalOptions {
  cols: number
  rows: number
  scrollbackLimit?: number
}
```

## TerminalCapabilities

Describes what features a backend supports:

```typescript
interface TerminalCapabilities {
  name: string // e.g. "xterm"
  version: string // e.g. "5.5.0"
  truecolor: boolean // 24-bit RGB colors
  kittyKeyboard: boolean // Kitty keyboard protocol
  kittyGraphics: boolean // Kitty graphics protocol
  sixel: boolean // Sixel image support
  osc8Hyperlinks: boolean // OSC 8 clickable links
  semanticPrompts: boolean
  unicode: string // e.g. "15.1"
  reflow: boolean // Text reflow on resize
  extensions: Set<string> // Optional extension identifiers
}
```

## Available Backends

### xterm.js

```typescript
import { createXtermBackend } from "@termless/xtermjs"

const backend = createXtermBackend()
// or with eager initialization:
const backend = createXtermBackend({ cols: 80, rows: 24 })
```

Uses `@xterm/headless` for in-process terminal emulation. No browser needed.

### Ghostty

```typescript
import { createGhosttyBackend, initGhostty } from "@termless/ghostty"

// WASM must be loaded first
const ghostty = await initGhostty()
const backend = createGhosttyBackend(undefined, ghostty)
backend.init({ cols: 80, rows: 24 })
```

## Implementing a Custom Backend

To create a new backend, implement the full `TerminalBackend` interface:

```typescript
import type { TerminalBackend, TerminalOptions, Cell /* ... */ } from "@termless/core"

export function createMyBackend(): TerminalBackend {
  return {
    name: "my-backend",

    init(opts: TerminalOptions) {
      /* initialize with cols/rows */
    },
    destroy() {
      /* cleanup */
    },

    feed(data: Uint8Array) {
      /* process terminal data */
    },
    resize(cols, rows) {
      /* resize terminal */
    },
    reset() {
      /* reset to initial state */
    },

    getText() {
      /* return all text */
    },
    getTextRange(sr, sc, er, ec) {
      /* return text range */
    },
    getCell(row, col) {
      /* return Cell */
    },
    getLine(row) {
      /* return Cell[] */
    },
    getLines() {
      /* return Cell[][] */
    },
    getCursor() {
      /* return CursorState */
    },
    getMode(mode) {
      /* return boolean */
    },
    getTitle() {
      /* return string */
    },
    getScrollback() {
      /* return ScrollbackState */
    },

    encodeKey(key) {
      /* encode KeyDescriptor to bytes */
    },
    scrollViewport(delta) {
      /* scroll by delta lines */
    },

    capabilities: {
      name: "my-backend",
      version: "1.0.0",
      truecolor: true,
      kittyKeyboard: false,
      kittyGraphics: false,
      sixel: false,
      osc8Hyperlinks: false,
      semanticPrompts: false,
      unicode: "15.1",
      reflow: false,
      extensions: new Set(),
    },
  }
}
```

## Extension Interfaces

Backends can optionally implement extension interfaces. Use `hasExtension()` to check:

```typescript
import { hasExtension } from "@termless/core"

// Mouse encoding
interface MouseEncodingExtension {
  encodeMouse(event: MouseEvent): Uint8Array | null
}

// Color palette manipulation
interface ColorPaletteExtension {
  setColorPalette(entries: Partial<Record<number, RGB>>): void
  setDefaultFg(color: RGB): void
  setDefaultBg(color: RGB): void
}

// Dirty row tracking (for incremental rendering)
interface DirtyTrackingExtension {
  getDirtyRows(): Set<number>
  clearDirty(): void
}

// Hyperlink detection
interface HyperlinkExtension {
  getHyperlinkAt(row: number, col: number): string | null
}

// Bell counter
interface BellExtension {
  getBellCount(): number
  clearBellCount(): void
}
```
