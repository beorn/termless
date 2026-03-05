# Terminal API

## `createTerminal(options)`

Creates a Terminal instance wrapping a backend with optional PTY support.

```typescript
import { createTerminal } from "@termless/monorepo"

const term = createTerminal({
  cols: 80, // default: 80
  rows: 24, // default: 24
  scrollbackLimit: 1000,
})
```

### Options

| Option            | Type              | Default  | Description                                  |
| ----------------- | ----------------- | -------- | -------------------------------------------- |
| `backend`         | `TerminalBackend` | xterm.js | Backend instance (defaults to xterm.js)      |
| `cols`            | `number`          | `80`     | Terminal width in columns                    |
| `rows`            | `number`          | `24`     | Terminal height in rows                      |
| `scrollbackLimit` | `number`          | --       | Maximum scrollback lines (backend-dependent) |

## Properties

```typescript
term.cols // number -- current column count
term.rows // number -- current row count
term.backend // TerminalBackend -- the underlying backend
term.alive // boolean -- true if a spawned process is still running
term.exitInfo // string | null -- e.g. "exit=0" after process exits
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
cell.text // string -- character
cell.fg // RGB | null -- foreground color
cell.bg // RGB | null -- background color
cell.bold // boolean
cell.faint // boolean
cell.italic // boolean
cell.underline // "none" | "single" | "double" | "curly" | "dotted" | "dashed"
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

## Screenshots

### `screenshotSvg(options?)`

Capture the terminal as an SVG string. See [Screenshots](screenshots.md) for options.

```typescript
const svg = term.screenshotSvg()
const svg = term.screenshotSvg({ theme: { background: "#282a36" } })
```

### `screenshotPng(options?)`

Capture the terminal as a PNG buffer. Requires `@resvg/resvg-js` (`bun add -d @resvg/resvg-js`). See [Screenshots](screenshots.md) for options.

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
