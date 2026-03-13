# Terminal API

## `createTerminal(options)`

Creates a Terminal instance wrapping a backend with optional PTY support.

```typescript
import { createTerminal } from "@termless/core"
import type { Terminal, TerminalCreateOptions } from "@termless/core"
import { createXtermBackend } from "@termless/xtermjs"

const term = createTerminal({
  backend: createXtermBackend(),
  cols: 80, // default: 80
  rows: 24, // default: 24
  scrollbackLimit: 1000,
})
```

### TerminalCreateOptions

```typescript
interface TerminalCreateOptions {
  backend: TerminalBackend // Required
  cols?: number // Default: 80
  rows?: number // Default: 24
  scrollbackLimit?: number
}
```

| Option            | Type              | Default    | Description                                          |
| ----------------- | ----------------- | ---------- | ---------------------------------------------------- |
| `backend`         | `TerminalBackend` | _required_ | Backend instance (e.g., from `createXtermBackend()`) |
| `cols`            | `number`          | `80`       | Terminal width in columns                            |
| `rows`            | `number`          | `24`       | Terminal height in rows                              |
| `scrollbackLimit` | `number`          | --         | Maximum scrollback lines (backend-dependent)         |

## Terminal Interface

```typescript
interface Terminal extends TerminalReadable {
  // Properties
  readonly cols: number
  readonly rows: number
  readonly backend: TerminalBackend
  readonly alive: boolean // PTY process running?
  readonly exitInfo: string | null // e.g. "exit=0"

  // Region selectors (WHERE) -- getter properties
  readonly screen: RegionView // visible rows x cols area
  readonly scrollback: RegionView // history above screen
  readonly buffer: RegionView // everything (scrollback + screen)
  readonly viewport: RegionView // current scroll position view

  // Region selectors (WHERE) -- methods
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

## Properties

```typescript
term.cols // number -- current column count
term.rows // number -- current row count
term.backend // TerminalBackend -- the underlying backend
term.alive // boolean -- true if a spawned process is still running
term.exitInfo // string | null -- e.g. "exit=0" after process exits
```

## Region Selectors

Region selectors separate **where** to look from **what** to assert.

### Properties (no parentheses)

```typescript
term.screen // RegionView -- the rows x cols visible area
term.scrollback // RegionView -- history above screen (empty in alt screen)
term.buffer // RegionView -- everything (scrollback + screen)
term.viewport // RegionView -- current scroll position view
```

### Methods

```typescript
term.row(0) // RowView -- first screen row
term.row(-1) // RowView -- last screen row (negative from bottom)
term.cell(0, 0) // CellView -- single cell at row 0, col 0
term.range(0, 0, 5, 40) // RegionView -- rectangular region
term.firstRow() // RowView -- convenience for first screen row
term.lastRow() // RowView -- convenience for last screen row
```

### View Types

```typescript
// RegionView -- text access for a region
interface RegionView {
  getText(): string
  getLines(): string[]
  containsText(text: string): boolean
}

// RowView -- a row with positional context (extends RegionView)
interface RowView extends RegionView {
  readonly row: number
  readonly cells: Cell[]
  cellAt(col: number): CellView
}

// CellView -- a single cell with positional context and style
interface CellView {
  readonly char: string
  readonly row: number
  readonly col: number
  readonly fg: RGB | null
  readonly bg: RGB | null
  readonly bold: boolean
  readonly dim: boolean
  readonly italic: boolean
  readonly underline: false | "single" | "double" | "curly" | "dotted" | "dashed"
  readonly strikethrough: boolean
  readonly inverse: boolean
  readonly wide: boolean
}
```

## Data Feed

### `feed(data)`

Write data directly to the terminal (no PTY). Useful for testing rendering of ANSI output.

```typescript
term.feed("Hello, world!") // string
term.feed("\x1b[1;31mRed bold\x1b[0m") // ANSI escape sequences
term.feed(new Uint8Array([0x48, 0x69])) // raw bytes
```

## PTY Lifecycle

### `spawn(command, options?)`

Spawn a child process with a pseudo-terminal. The process output is fed to the backend automatically.

```typescript
await term.spawn(["ls", "-la"])
await term.spawn(["my-app", "--port", "3000"], {
  env: { NODE_ENV: "test" },
  cwd: "/path/to/project",
})
```

Throws if a process is already spawned or if the terminal is closed.

### SpawnOptions

```typescript
interface SpawnOptions {
  command: string[]
  env?: Record<string, string>
  cwd?: string
}
```

## Input

### `press(key)`

Send a keypress to the spawned process. Parses human-readable key descriptions into ANSI escape sequences.

```typescript
term.press("a") // Single character
term.press("Enter") // Named keys
term.press("ArrowUp") // Arrow keys
term.press("Ctrl+c") // Modifier + key
term.press("Ctrl+Shift+a") // Multiple modifiers
term.press("Alt+x") // Alt modifier
term.press("F5") // Function keys F1-F12
term.press("Shift+Tab") // Reverse tab
```

Supported modifiers: `Ctrl`, `Control`, `Alt`, `Option`, `Shift`, `Meta`, `Cmd`, `Super`.

Supported named keys: `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `Home`, `End`, `PageUp`, `PageDown`, `Enter`, `Tab`, `Backspace`, `Delete`, `Escape`, `Space`, `F1`--`F12`.

### `type(text)`

Send raw text to the spawned process. Unlike `press()`, this does not parse key descriptions -- it writes the string directly to the PTY.

```typescript
term.type("Hello, world!")
term.type("search query\r") // \r for Enter
```

## Waiting

### `waitFor(text, timeout?)`

Wait for specific text to appear in the terminal buffer. Polls every 50ms.

```typescript
await term.waitFor("ready>") // Default timeout: 5000ms
await term.waitFor("Loading...", 10000) // Custom timeout
```

Throws `Error` if the text doesn't appear within the timeout.

### `waitForStable(stableMs?, timeout?)`

Wait for terminal content to stop changing. Useful after keypresses or when waiting for rendering to complete.

```typescript
await term.waitForStable() // Default: stable for 200ms, timeout 5000ms
await term.waitForStable(100, 3000) // Stable for 100ms, timeout 3000ms
```

## Search

### `find(text)`

Find the first occurrence of text in the terminal buffer. Returns position or null.

```typescript
const pos = term.find("Error")
if (pos) {
  console.log(`Found at row ${pos.row}, col ${pos.col}`)
}
```

Returns: `{ row: number, col: number, text: string } | null`

### `findAll(pattern)`

Find all regex matches in the terminal buffer.

```typescript
const matches = term.findAll(/\d+\.\d+/g) // Find all decimal numbers
for (const m of matches) {
  console.log(`${m.text} at (${m.row}, ${m.col})`)
}
```

Returns: `TextPosition[]` -- array of `{ row, col, text }`.

## Reading State

These methods are part of the `TerminalReadable` interface and work with @termless/test matchers.

### `getText()`

Get all terminal text as a single string with newline-separated rows.

### `getTextRange(startRow, startCol, endRow, endCol)`

Get text from a rectangular region of the terminal.

### `getCell(row, col)`

Get a single cell with all attributes. Returns a `Cell` object:

```typescript
const cell = term.getCell(0, 0)
cell.char // string -- character
cell.fg // RGB | null -- foreground color
cell.bg // RGB | null -- background color
cell.bold // boolean
cell.dim // boolean
cell.italic // boolean
cell.underline // false | "single" | "double" | "curly" | "dotted" | "dashed"
cell.strikethrough // boolean
cell.inverse // boolean
cell.wide // boolean -- double-width character
```

### `getLine(row)`

Get all cells in a row as `Cell[]`.

### `getLines()`

Get the entire terminal grid as `Cell[][]`.

### `getCursor()`

Get cursor state: `{ x: number, y: number, visible: boolean, style: "block" | "underline" | "beam" }`.

### `getMode(mode)`

Check if a terminal mode is active. Returns `boolean`.

### `getTitle()`

Get the terminal title (set via OSC 2 escape sequence).

### `getScrollback()`

Get scrollback state: `{ viewportOffset: number, totalLines: number, screenLines: number }`.

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

## Screenshots

### `screenshotSvg(options?)`

Capture the terminal as an SVG string. See [Screenshots](/guide/screenshots) for options.

```typescript
const svg = term.screenshotSvg()
const svg = term.screenshotSvg({ theme: { background: "#282a36" } })
```

### `screenshotPng(options?)`

Capture the terminal as a PNG buffer. Requires `@resvg/resvg-js` (`bun add -d @resvg/resvg-js`). See [Screenshots](/guide/screenshots) for options.

```typescript
const png = await term.screenshotPng()
const png = await term.screenshotPng({ scale: 3, theme: { background: "#282a36" } })
```

## Resize

### `resize(cols, rows)`

Resize the terminal. Updates both backend and PTY (if spawned).

```typescript
term.resize(120, 40)
```

## Cleanup

### `close()`

Close the terminal, kill any spawned process, and destroy the backend. Safe to call multiple times.

```typescript
await term.close()
```

### `Symbol.asyncDispose`

Supports the `using` declaration for automatic cleanup:

```typescript
await using term = createTerminal({ backend: createXtermBackend() })
// term.close() called automatically when scope exits
```

## Key Utilities

```typescript
import { parseKey, keyToAnsi } from "@termless/core"

// Parse "Ctrl+a" -> { key: "a", ctrl: true }
const desc = parseKey("Ctrl+Shift+ArrowUp")

// Convert to ANSI escape sequence
const ansi = keyToAnsi("Ctrl+c") // "\x03"
const ansi = keyToAnsi({ key: "ArrowUp", ctrl: true }) // "\x1b[1;5A"
```

## hasExtension

Type-safe extension check for backend capabilities:

```typescript
import { hasExtension } from "@termless/core"
import type { MouseEncodingExtension } from "@termless/core"

if (hasExtension<MouseEncodingExtension>(backend, "mouse")) {
  const encoded = backend.encodeMouse({ x: 5, y: 10, button: "left", action: "press" })
}
```
