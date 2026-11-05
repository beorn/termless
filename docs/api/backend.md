---
title: TerminalBackend API
description: API reference for the TerminalBackend interface -- the contract every Termless backend implements for terminal emulation.
---

# API: TerminalBackend

```typescript
import type { TerminalBackend, TerminalOptions, TerminalCapabilities } from "@termless/core"
```

## TerminalBackend Interface

All backends must implement this interface. Users typically don't interact with backends directly -- `createTerminal()` wraps them.

```typescript
interface TerminalBackend extends Terminal {
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
  // Compatibility no-op when capabilities.productViewport declares absence;
  // probes omit this control for that library subject.
  scrollViewport(delta: number): void

  // Capabilities
  readonly capabilities: TerminalCapabilities
}
```

`capabilities.productViewport?: { available: false; reason: string }` records audited
absence of a viewport in the library subject. Undefined means undeclared. WezTerm
Screen and libvterm retain the required `scrollViewport` compatibility no-op;
probes never read it when this declaration is present. The reason cites the pinned
library interface, not the enclosing application's viewport.

## Clipboard callback state

The optional `getClipboardState()` reader returns a copied snapshot of writes
accepted by the engine's clipboard callback. It does not prove that the OS
clipboard changed, and the input-scanned `Terminal.clipboardWrites` is not a
substitute for this reader.

Alacritty records its `ClipboardStore` requests per backend instance, in order.
Its `selector` is the engine's selection class: `c` for clipboard, `p` for primary
selection, including the engine's `s` alias. Its `text` is the decoded UTF-8 text
accepted by the engine; `payload` is a canonical base64 re-encode of that text,
not the original wire bytes. In contrast, the vt100-rust callback retains the
wire payload. Malformed base64 or non-UTF-8 writes produce no Alacritty entry,
not a `decodeError` entry.

Reading does not drain the history, and RIS does not clear it. Reinitializing
the backend creates a new instance with empty history; changing the returned
snapshot cannot change that history. Alacritty supplies neither `control` nor
`pasteSelector`. Its existing `OnlyCopy` default and clipboard-read behavior are
unchanged: this reader neither handles `ClipboardLoad` nor synthesizes replies.
A poisoned callback-state lock is reported as an error by the reader, never as
an empty successful snapshot.

## TerminalOptions

```typescript
interface TerminalOptions {
  cols: number
  rows: number
  scrollbackLimit?: number
}
```

## TerminalCapabilities

Describes what features a backend supports. Terminal capability data across real terminals is maintained at [terminfo.dev](https://terminfo.dev).

```typescript
interface TerminalCapabilities {
  name: string // e.g. "xterm"
  version: string // upstream engine release pinned by this backend
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

`capabilities.version` is the upstream engine release pinned by `upstreamVersion` in `backends.json` for the default install (`"not-applicable"` without an upstream), not the wrapper release or proof of execution; non-default installs are outside this claim and a run's `runtimeIdentity` supplies execution evidence. A request for a non-default `backend(name, { version })` is refused.

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
    getRow(row) {
      /* return Cell[] */
    },
    getRows() {
      /* return Cell[][] */
    },
    getCursor() {
      /* return Cursor */
    },
    getMode(mode) {
      /* return boolean */
    },
    getTitle() {
      /* return string */
    },
    getIconLabel() {
      /* optional: return string when backend tracks engine icon-name state */
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
      version: "not-applicable",
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

`osc8Hyperlinks` declares clickable-link feature support; the `hyperlinks` extension separately exposes per-cell URI metadata through `getHyperlinkAt`.

Backends can optionally implement extension interfaces. Use `hasExtension()` to check:

```typescript
import { hasExtension } from "@termless/core"

// Native mouse encoding (extension name "mouse-encoding")
interface MouseEncodingExtension {
  encodeMouse(event: MouseEvent): Uint8Array | null
}

// Native paste encoding (extension name "paste-encoding")
interface PasteEncodingExtension {
  encodePaste(text: string): Uint8Array
}

// Color palette manipulation
interface ColorPaletteExtension {
  setColorPalette(entries: Partial<Record<number, Color>>): void
  setDefaultFg(color: Color): void
  setDefaultBg(color: Color): void
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

// OSC parser metadata (extension name "osc-metadata")
interface OscMetadataExtension {
  getCwd(): string | null
  getNotifications(): readonly string[]
}

// Track A compatibility read; migrate onto Emulator or delete with TerminalBackend at A4b.
// "semantic-marks" declares starts; "semantic-command-end" declares ends.
interface SemanticStartMark {
  readonly type: "prompt" | "command" | "output"
  readonly startRow: number
  readonly startCol: number
}
type SemanticMark =
  | SemanticStartMark
  | {
      readonly type: "command-end"
      readonly rawStatus: string
    }
interface SemanticMarkExtension {
  getSemanticMarks(): readonly SemanticMark[]
}

// Track A compatibility read; migrate onto Emulator or delete with TerminalBackend at A4b.
// Extension name "sixel-storage"; storage is not raster rendering.
interface SixelStorageExtension {
  getSixelImages(): readonly {
    readonly data: string
    readonly row: number
    readonly col: number
  }[]
}

// Bell counter
interface BellExtension {
  getBellCount(): number
  clearBellCount(): void
}
```

`PasteEncodingExtension` is declared by `"paste-encoding"`. `encodePaste(text)`
returns the engine's native input bytes in its current mode, including its own
framing and text rules. It preserves modes and queued replies, does not feed the
parser or write to a PTY, and never calls the backend's `onResponse`. Libvterm and
WezTerm implement it; another backend may omit it when no path is exposed.

`OscMetadataExtension` exposes the engine's exact OSC 7 URI and copied, ordered
OSC 9 payloads. Null cwd means the engine reports no URI. Notification payloads
retain their raw strings; this reader does not attest an OS notification appearing
or OSC 9;4 progress behavior. Check `hasExtension<OscMetadataExtension>(backend,
"osc-metadata")` before calling these methods. The vterm backend implements them;
other backends can omit the extension.

Check `hasExtension<SemanticMarkExtension>(backend, "semantic-marks")` for start
observations or `hasExtension<SemanticMarkExtension>(backend, "semantic-command-end")`
for end observations. Both keys use the same getter; an engine recording both kinds
declares both keys. Narrow `mark.type` before reading variant fields. vterm declares
only starts; Kitty declares only ends. Each read returns copied, ordered records;
an empty array means no stored records, while an absent key means that kind of
observation is not declared. vterm reset and snapshot restore clear its starts.
Kitty's cumulative callback history survives reset and batch replay, preserves
duplicate entries and is cleared by a new `init()` or `destroy()`.

Start positions are zero-based screen coordinates captured at insertion, not
absolute buffer rows or tracked zone boundaries. Command-end entries have no
coordinates. Kitty preserves the native raw status string verbatim, including an
empty string, `"0"`, negative-looking and nonnumeric strings; it is not a validated
process exit status. Neither variant supplies command text or bounded zones.
Check `hasExtension<SixelStorageExtension>(backend, "sixel-storage")` before reading
vterm's copied raw image records; reset and snapshot restore clear those records.
Sixel `data` is the exact stored payload after `q`, without DCS framing
or parameters. Its row/column locate the DCS start, not the image extent. Neither
this reader nor the protocol capability flag establishes raster rendering or cell
geometry.
