# Writing Tests

## Setup

Import matchers and create fixtures:

```typescript
import { describe, test, expect } from "vitest"
import { createTerminalFixture } from "viterm/fixture"
import { createXtermBackend } from "termless-xtermjs"
import "viterm/matchers" // Registers all matchers on expect()
```

`createTerminalFixture()` wraps `createTerminal()` and registers cleanup in `afterEach` -- no manual `close()` needed.

## Matchers Reference

All matchers work on any object implementing `TerminalReadable` (including `Terminal`).

### Text Matchers

```typescript
// Contains text anywhere in the buffer
expect(term).toContainText("Hello")

// Exact text at a specific position (row, col, text)
expect(term).toHaveTextAt(0, 5, "world")

// Row contains text substring (row, text)
expect(term).toContainTextInRow(2, "status: ok")

// Row is empty (all spaces)
expect(term).toHaveEmptyRow(10)
```

### Cell Style Matchers

All take `(row, col)` coordinates:

```typescript
// Colors -- accepts "#rrggbb" string or { r, g, b } object
expect(term).toHaveFgColor(0, 0, "#ff0000")
expect(term).toHaveBgColor(0, 0, { r: 0, g: 255, b: 0 })

// Text attributes
expect(term).toBeBoldAt(0, 0)
expect(term).toBeItalicAt(0, 0)
expect(term).toBeFaintAt(0, 0)
expect(term).toBeStrikethroughAt(0, 0)
expect(term).toBeInverseAt(0, 0)
expect(term).toBeWideAt(0, 0) // Double-width character

// Underline -- optional style: "single" | "double" | "curly" | "dotted" | "dashed"
expect(term).toHaveUnderlineAt(0, 0)           // Any underline
expect(term).toHaveUnderlineAt(0, 0, "curly")  // Specific style
```

### Cursor Matchers

```typescript
// Position (x, y)
expect(term).toHaveCursorAt(5, 0)

// Visibility
expect(term).toHaveCursorVisible()
expect(term).toHaveCursorHidden()

// Style: "block" | "underline" | "beam"
expect(term).toHaveCursorStyle("beam")
```

### Terminal Mode Matchers

```typescript
// Alt screen (fullscreen TUI mode)
expect(term).toBeInAltScreen()

// Bracketed paste mode
expect(term).toBeInBracketedPaste()

// Generic mode check
expect(term).toHaveMode("mouseTracking")
expect(term).toHaveMode("applicationCursor")
```

Available modes: `altScreen`, `cursorVisible`, `bracketedPaste`, `applicationCursor`, `applicationKeypad`, `autoWrap`, `mouseTracking`, `focusTracking`, `originMode`, `insertMode`, `reverseVideo`.

### Title Matcher

```typescript
// OSC 2 title
expect(term).toHaveTitle("My App - untitled")
```

### Scrollback Matchers

```typescript
// Total lines in scrollback buffer
expect(term).toHaveScrollbackLines(100)

// Viewport at bottom (no scroll offset)
expect(term).toBeAtBottomOfScrollback()
```

### Snapshot Matcher

```typescript
// Vitest snapshot of terminal state
expect(term).toMatchTerminalSnapshot()
```

## Negation

All matchers support `.not`:

```typescript
expect(term).not.toContainText("error")
expect(term).not.toBeBoldAt(0, 5)
expect(term).not.toBeInAltScreen()
```

## Snapshot Serializer

For readable terminal snapshots in `.snap` files:

```typescript
import { expect } from "vitest"
import { terminalSerializer, terminalSnapshot } from "viterm"

expect.addSnapshotSerializer(terminalSerializer)

test("renders correctly", () => {
  const term = createTerminalFixture({ backend: createXtermBackend(), cols: 40, rows: 5 })
  term.feed("\x1b[1mTitle\x1b[0m\r\nContent")

  expect(terminalSnapshot(term)).toMatchSnapshot()
})
```

Produces snapshots like:

```
# terminal 40x5 | cursor (7,1) visible block
--------------------------------------------------
 1|Title
 2|Content
 3|
 4|
 5|
```

With style annotations when cells have non-default attributes:

```
 1|Title  [0:bold] [1:bold] [2:bold] [3:bold] [4:bold]
```

## Common Patterns

### Testing ANSI output

```typescript
test("error message is red and bold", () => {
  const term = createTerminalFixture({ backend: createXtermBackend() })
  term.feed("\x1b[1;31mError:\x1b[0m file not found")

  expect(term).toContainText("Error: file not found")
  expect(term).toBeBoldAt(0, 0)
  expect(term).toHaveFgColor(0, 0, "#800000") // ANSI red (palette index 1)
  expect(term).not.toBeBoldAt(0, 7) // Space after "Error:" is not bold
})
```

### Testing cursor movement

```typescript
test("cursor tracks input", () => {
  const term = createTerminalFixture({ backend: createXtermBackend() })
  term.feed("Hello")
  expect(term).toHaveCursorAt(5, 0)

  term.feed("\r\nWorld")
  expect(term).toHaveCursorAt(5, 1)
})
```

### Testing interactive apps with PTY

```typescript
test("app enters alt screen", async () => {
  const term = createTerminalFixture({ backend: createXtermBackend(), cols: 80, rows: 24 })
  await term.spawn(["my-tui"])
  await term.waitForStable()

  expect(term).toBeInAltScreen()
  expect(term).toContainText("Welcome")

  term.press("q")
  await term.waitForStable()
  expect(term).not.toBeInAltScreen()
})
```

### Finding text positions

```typescript
test("find specific text", () => {
  const term = createTerminalFixture({ backend: createXtermBackend() })
  term.feed("Line 0\r\nLine 1\r\nTarget here")

  const pos = term.find("Target")
  expect(pos).not.toBeNull()
  expect(pos!.row).toBe(2)
  expect(pos!.col).toBe(0)

  // Regex search for multiple matches
  const matches = term.findAll(/Line \d/g)
  expect(matches).toHaveLength(2)
})
```
