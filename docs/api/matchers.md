# API: Vitest Matchers

```typescript
import "viterm/matchers"  // Auto-registers all matchers
// or:
import { terminalMatchers } from "viterm/matchers"
expect.extend(terminalMatchers)
```

All matchers work on any object implementing `TerminalReadable`. All support `.not` negation.

## Text Matchers

### `toContainText(text: string)`

Assert terminal buffer contains the given text anywhere.

```typescript
expect(term).toContainText("Hello")
expect(term).not.toContainText("error")
```

### `toHaveTextAt(row: number, col: number, text: string)`

Assert specific text appears at the given row and column.

```typescript
expect(term).toHaveTextAt(0, 0, "Title")
expect(term).toHaveTextAt(2, 5, "value")
```

### `toContainTextInRow(row: number, text: string)`

Assert a specific row contains the given text as a substring.

```typescript
expect(term).toContainTextInRow(0, "Status: OK")
expect(term).not.toContainTextInRow(1, "Error")
```

### `toHaveEmptyRow(row: number)`

Assert a row is empty (all spaces or empty strings).

```typescript
expect(term).toHaveEmptyRow(10)
expect(term).not.toHaveEmptyRow(0)
```

## Cell Style Matchers

### `toHaveFgColor(row: number, col: number, color: string | RGB)`

Assert foreground color at a specific cell. Accepts `"#rrggbb"` string or `{ r, g, b }` object.

```typescript
expect(term).toHaveFgColor(0, 0, "#ff0000")
expect(term).toHaveFgColor(0, 0, { r: 255, g: 0, b: 0 })
```

### `toHaveBgColor(row: number, col: number, color: string | RGB)`

Assert background color at a specific cell.

```typescript
expect(term).toHaveBgColor(0, 0, "#282a36")
```

### `toBeBoldAt(row: number, col: number)`

Assert cell has bold attribute.

```typescript
expect(term).toBeBoldAt(0, 0)
```

### `toBeItalicAt(row: number, col: number)`

Assert cell has italic attribute.

```typescript
expect(term).toBeItalicAt(0, 0)
```

### `toBeFaintAt(row: number, col: number)`

Assert cell has faint/dim attribute.

```typescript
expect(term).toBeFaintAt(0, 0)
```

### `toHaveUnderlineAt(row: number, col: number, style?: UnderlineStyle)`

Assert cell has underline. Optionally check specific style.

```typescript
expect(term).toHaveUnderlineAt(0, 0)            // Any underline
expect(term).toHaveUnderlineAt(0, 0, "single")  // Specific style
expect(term).toHaveUnderlineAt(0, 0, "curly")   // Curly underline (e.g., spell check)
```

Styles: `"single"`, `"double"`, `"curly"`, `"dotted"`, `"dashed"`.

### `toBeStrikethroughAt(row: number, col: number)`

Assert cell has strikethrough attribute.

```typescript
expect(term).toBeStrikethroughAt(0, 0)
```

### `toBeInverseAt(row: number, col: number)`

Assert cell has inverse (reverse video) attribute.

```typescript
expect(term).toBeInverseAt(0, 0)
```

### `toBeWideAt(row: number, col: number)`

Assert cell is a double-width character (CJK, emoji).

```typescript
expect(term).toBeWideAt(0, 0) // First cell of a wide char
```

## Cursor Matchers

### `toHaveCursorAt(x: number, y: number)`

Assert cursor is at the given position (column, row).

```typescript
expect(term).toHaveCursorAt(0, 0)  // Top-left
expect(term).toHaveCursorAt(5, 2)  // Column 5, row 2
```

### `toHaveCursorVisible()`

Assert cursor is visible.

```typescript
expect(term).toHaveCursorVisible()
```

### `toHaveCursorHidden()`

Assert cursor is hidden.

```typescript
expect(term).toHaveCursorHidden()
```

### `toHaveCursorStyle(style: CursorStyle)`

Assert cursor style.

```typescript
expect(term).toHaveCursorStyle("block")
expect(term).toHaveCursorStyle("beam")
expect(term).toHaveCursorStyle("underline")
```

## Terminal Mode Matchers

### `toBeInAltScreen()`

Assert terminal is in alternate screen mode.

```typescript
expect(term).toBeInAltScreen()
expect(term).not.toBeInAltScreen()
```

### `toBeInBracketedPaste()`

Assert terminal is in bracketed paste mode.

```typescript
expect(term).toBeInBracketedPaste()
```

### `toHaveMode(mode: TerminalMode)`

Assert a specific terminal mode is enabled.

```typescript
expect(term).toHaveMode("mouseTracking")
expect(term).toHaveMode("applicationCursor")
expect(term).not.toHaveMode("insertMode")
```

## Title Matcher

### `toHaveTitle(title: string)`

Assert terminal title (set via OSC 2 escape sequence).

```typescript
expect(term).toHaveTitle("vim - file.txt")
```

## Scrollback Matchers

### `toHaveScrollbackLines(n: number)`

Assert scrollback buffer has a specific number of total lines.

```typescript
expect(term).toHaveScrollbackLines(100)
```

### `toBeAtBottomOfScrollback()`

Assert viewport is at the bottom (no scroll offset).

```typescript
expect(term).toBeAtBottomOfScrollback()
```

## Snapshot Matcher

### `toMatchTerminalSnapshot(options?)`

Match terminal content against a Vitest snapshot.

```typescript
expect(term).toMatchTerminalSnapshot()
expect(term).toMatchTerminalSnapshot({ name: "after-input" })
```

## Snapshot Serializer

For human-readable `.snap` files, register the serializer:

```typescript
import { terminalSerializer, terminalSnapshot } from "viterm"

expect.addSnapshotSerializer(terminalSerializer)

test("renders correctly", () => {
  // ...
  expect(terminalSnapshot(term)).toMatchSnapshot()
  expect(terminalSnapshot(term, "after-input")).toMatchSnapshot()
})
```

### `terminalSnapshot(terminal, name?)`

Wraps a `TerminalReadable` for the snapshot serializer.

```typescript
function terminalSnapshot(terminal: TerminalReadable, name?: string): TerminalSnapshotMarker
```
