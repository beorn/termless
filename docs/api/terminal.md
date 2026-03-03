# API: Terminal

```typescript
import { createTerminal } from "termless"
import type { Terminal, TerminalCreateOptions } from "termless"
```

## `createTerminal(options: TerminalCreateOptions): Terminal`

Factory function that creates a Terminal wrapping a backend with optional PTY.

### TerminalCreateOptions

```typescript
interface TerminalCreateOptions {
  backend: TerminalBackend  // Required
  cols?: number             // Default: 80
  rows?: number             // Default: 24
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
  readonly alive: boolean         // PTY process running?
  readonly exitInfo: string | null // e.g. "exit=0"

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

  // Resize
  resize(cols: number, rows: number): void

  // Cleanup
  close(): Promise<void>
  [Symbol.asyncDispose](): Promise<void>
}
```

## TerminalReadable Interface

The read-only subset that viterm matchers accept:

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
import { parseKey, keyToAnsi } from "termless"

// Parse "Ctrl+a" -> { key: "a", ctrl: true }
const desc = parseKey("Ctrl+Shift+ArrowUp")

// Convert to ANSI escape sequence
const ansi = keyToAnsi("Ctrl+c") // "\x03"
const ansi = keyToAnsi({ key: "ArrowUp", ctrl: true }) // "\x1b[1;5A"
```

## hasExtension

Type-safe extension check for backend capabilities:

```typescript
import { hasExtension } from "termless"
import type { MouseEncodingExtension } from "termless"

if (hasExtension<MouseEncodingExtension>(backend, "mouse")) {
  const encoded = backend.encodeMouse({ x: 5, y: 10, button: "left", action: "press" })
}
```
