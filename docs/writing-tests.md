# Writing Tests

## Setup

Import matchers and create fixtures:

```typescript
import { describe, test, expect } from "vitest"
import { createTerminalFixture } from "viterm"
```

`createTerminalFixture()` wraps `createTerminal()` and registers cleanup in `afterEach` -- no manual `close()` needed.

## Composable API

The key design principle: separate **where** to look from **what** to assert.

```typescript
// WHERE: region selectors
term.screen      // visible rows x cols area
term.scrollback  // history above screen
term.buffer      // everything (scrollback + screen)
term.viewport    // current scroll position view
term.row(n)      // screen row (negative from bottom)
term.cell(r, c)  // single cell
term.range(r1, c1, r2, c2) // rectangular region
term.firstRow()  // convenience: first screen row
term.lastRow()   // convenience: last screen row

// WHAT: matchers
expect(term.screen).toContainText("Hello")    // text matcher on region
expect(term.cell(0, 0)).toBeBold()            // style matcher on cell
expect(term).toHaveCursorAt(5, 0)             // terminal matcher
```

## Matchers Reference

### Text Matchers (on RegionView / RowView)

```typescript
// Contains text anywhere in the region
expect(term.screen).toContainText("Hello")

// Exact text match (trimmed)
expect(term.row(0)).toHaveText("Title")

// Line-by-line match (trailing whitespace trimmed)
expect(term.screen).toMatchLines(["Line 1", "Line 2", "Line 3"])
```

### Cell Style Matchers (on CellView)

```typescript
// Colors -- accepts "#rrggbb" string or { r, g, b } object
expect(term.cell(0, 0)).toHaveFg("#ff0000")
expect(term.cell(0, 0)).toHaveBg({ r: 0, g: 255, b: 0 })

// Text attributes
expect(term.cell(0, 0)).toBeBold()
expect(term.cell(0, 0)).toBeItalic()
expect(term.cell(0, 0)).toBeFaint()
expect(term.cell(0, 0)).toBeStrikethrough()
expect(term.cell(0, 0)).toBeInverse()
expect(term.cell(0, 0)).toBeWide() // Double-width character

// Underline -- optional style: "single" | "double" | "curly" | "dotted" | "dashed"
expect(term.cell(0, 0)).toHaveUnderline()          // Any underline
expect(term.cell(0, 0)).toHaveUnderline("curly")   // Specific style
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
// Generic mode check (replaces toBeInAltScreen, toBeInBracketedPaste, toHaveMode)
expect(term).toBeInMode("altScreen")
expect(term).toBeInMode("bracketedPaste")
expect(term).toBeInMode("mouseTracking")
expect(term).toBeInMode("applicationCursor")
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
expect(term.screen).not.toContainText("error")
expect(term.cell(0, 5)).not.toBeBold()
expect(term).not.toBeInMode("altScreen")
```

## Snapshot Serializer

For readable terminal snapshots in `.snap` files:

```typescript
import { expect } from "vitest"
import { terminalSerializer, terminalSnapshot } from "viterm"

expect.addSnapshotSerializer(terminalSerializer)

test("renders correctly", () => {
  const term = createTerminalFixture({ cols: 40, rows: 5 })
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
  const term = createTerminalFixture()
  term.feed("\x1b[1;31mError:\x1b[0m file not found")

  expect(term.screen).toContainText("Error: file not found")
  expect(term.cell(0, 0)).toBeBold()
  expect(term.cell(0, 0)).toHaveFg("#800000") // ANSI red (palette index 1)
  expect(term.cell(0, 7)).not.toBeBold()       // Space after "Error:" is not bold
})
```

### Testing cursor movement

```typescript
test("cursor tracks input", () => {
  const term = createTerminalFixture()
  term.feed("Hello")
  expect(term).toHaveCursorAt(5, 0)

  term.feed("\r\nWorld")
  expect(term).toHaveCursorAt(5, 1)
})
```

### Testing interactive apps with PTY

```typescript
test("app enters alt screen", async () => {
  const term = createTerminalFixture({ cols: 80, rows: 24 })
  await term.spawn(["my-tui"])
  await term.waitForStable()

  expect(term).toBeInMode("altScreen")
  expect(term.screen).toContainText("Welcome")

  term.press("q")
  await term.waitForStable()
  expect(term).not.toBeInMode("altScreen")
})
```

### Finding text positions

```typescript
test("find specific text", () => {
  const term = createTerminalFixture()
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

### Reading text from regions

```typescript
test("read text from different regions", () => {
  const term = createTerminalFixture({ cols: 80, rows: 5 })

  // Feed enough lines to create scrollback
  for (let i = 0; i < 10; i++) {
    term.feed(`Line ${i}\r\n`)
  }

  // Screen shows the last 5 rows
  const screenText = term.screen.getText()

  // Scrollback has the history
  const scrollbackText = term.scrollback.getText()

  // Buffer has everything
  const bufferText = term.buffer.getText()

  // Single row
  const rowText = term.row(0).getText()
})
```

## Migration from Old API

| Old | New |
|-----|-----|
| `expect(term).toContainText("x")` | `expect(term.screen).toContainText("x")` |
| `expect(term).toBeBoldAt(r, c)` | `expect(term.cell(r, c)).toBeBold()` |
| `expect(term).toHaveFgColor(r, c, color)` | `expect(term.cell(r, c)).toHaveFg(color)` |
| `expect(term).toBeInAltScreen()` | `expect(term).toBeInMode("altScreen")` |
| `expect(term).toMatchViewport(lines)` | `expect(term.screen).toMatchLines(lines)` |
| `term.getViewportText()` | `term.screen.getText()` |
| `term.getScrollbackText()` | `term.scrollback.getText()` |
| `term.getRowText(n)` | `term.row(n).getText()` |
