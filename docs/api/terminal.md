# API: Terminal

```typescript
import { createTerminal } from "@termless/monorepo"
import type { Terminal, TerminalCreateOptions } from "@termless/monorepo"
```

## `createTerminal(options: TerminalCreateOptions): Terminal`

Factory function that creates a Terminal wrapping a backend with optional PTY.

### TerminalCreateOptions

```typescript
interface TerminalCreateOptions {
  backend: TerminalBackend // Required
  cols?: number // Default: 80
  rows?: number // Default: 24
  scrollbackLimit?: number
}
```

## Terminal Interface

```typescript
interface Terminal extends TerminalReadable {
  // Properties
  readonly cols: number
  readonly rows: number
  readonly backend: TerminalBackend
  readonly alive: boolean // PTY process running?
  readonly exitInfo: string | null // e.g. "exit=0"

  // Region selectors (WHERE) — getter properties
  readonly screen: RegionView // visible rows x cols area
  readonly scrollback: RegionView // history above screen
  readonly buffer: RegionView // everything (scrollback + screen)
  readonly viewport: RegionView // current scroll position view

  // Region selectors (WHERE) — methods
  row(n: number): RowView // screen row (negative from bottom)
  cell(row: number, col: number): CellView // single cell
  range(r1: number, c1: number, r2: number, c2: number): RegionView // rectangular region
  firstRow(): RowView // convenience: first screen row
  lastRow(): RowView // convenience: last screen row

  // Data feed (no PTY)
  feed(data: Uint8Array | string): void

  // PTY lifecycle
  spawn(command: string[], options?: { env?: Record<string, string>; cwd?: string }): Promise<void>

  // Input (requires PTY)
  press(key: string): void
  type(text: string): void

  // Waiting
  waitFor(text: string, timeout?: number): Promise<void>
  waitForStable(stableMs?: number, timeout?: number): Promise<void>

  // Search
  find(text: string): TextPosition | null
  findAll(pattern: RegExp): TextPosition[]

  // Screenshot
  screenshotSvg(options?: SvgScreenshotOptions): string
  screenshotPng(options?: PngScreenshotOptions): Promise<Uint8Array>

  // Resize
  resize(cols: number, rows: number): void

  // Cleanup
  close(): Promise<void>
  [Symbol.asyncDispose](): Promise<void>
}
```

## Region Selectors

Region selectors separate **where** to look from **what** to assert.

### Properties (no parentheses)

```typescript
term.screen // RegionView — the rows x cols visible area
term.scrollback // RegionView — history above screen (empty in alt screen)
term.buffer // RegionView — everything (scrollback + screen)
term.viewport // RegionView — current scroll position view
```

### Methods

```typescript
term.row(0) // RowView — first screen row
term.row(-1) // RowView — last screen row (negative from bottom)
term.cell(0, 0) // CellView — single cell at row 0, col 0
term.range(0, 0, 5, 40) // RegionView — rectangular region
term.firstRow() // RowView — convenience for first screen row
term.lastRow() // RowView — convenience for last screen row
```

### View Types

```typescript
// RegionView — text access for a region
interface RegionView {
  getText(): string
  getLines(): string[]
  containsText(text: string): boolean
}

// RowView — a row with positional context (extends RegionView)
interface RowView extends RegionView {
  readonly row: number
  readonly cells: Cell[]
  cellAt(col: number): CellView
}

// CellView — a single cell with positional context and style
interface CellView {
  readonly text: string
  readonly row: number
  readonly col: number
  readonly fg: RGB | null
  readonly bg: RGB | null
  readonly bold: boolean
  readonly faint: boolean
  readonly italic: boolean
  readonly underline: UnderlineStyle
  readonly strikethrough: boolean
  readonly inverse: boolean
  readonly wide: boolean
}
```

## TerminalReadable Interface

The read-only subset that terminal matchers accept:

```typescript
interface TerminalReadable {
  getText(): string
  getTextRange(startRow: number, startCol: number, endRow: number, endCol: number): string
  getCell(row: number, col: number): Cell
  getLine(row: number): Cell[]
  getLines(): Cell[][]
  getCursor(): CursorState
  getMode(mode: TerminalMode): boolean
  getTitle(): string
  getScrollback(): ScrollbackState
}
```

## TextPosition

```typescript
interface TextPosition {
  row: number
  col: number
  text: string
}
```

## SpawnOptions

```typescript
interface SpawnOptions {
  command: string[]
  env?: Record<string, string>
  cwd?: string
}
```

## Key Utilities

```typescript
import { parseKey, keyToAnsi } from "@termless/monorepo"

// Parse "Ctrl+a" -> { key: "a", ctrl: true }
const desc = parseKey("Ctrl+Shift+ArrowUp")

// Convert to ANSI escape sequence
const ansi = keyToAnsi("Ctrl+c") // "\x03"
const ansi = keyToAnsi({ key: "ArrowUp", ctrl: true }) // "\x1b[1;5A"
```

## hasExtension

Type-safe extension check for backend capabilities:

```typescript
import { hasExtension } from "@termless/monorepo"
import type { MouseEncodingExtension } from "@termless/monorepo"

if (hasExtension<MouseEncodingExtension>(backend, "mouse")) {
  const encoded = backend.encodeMouse({ x: 5, y: 10, button: "left", action: "press" })
}
```
