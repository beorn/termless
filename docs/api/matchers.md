---
title: Vitest Matchers API
description: Complete reference for Termless Vitest matchers -- text, style, color, cursor, and snapshot assertions for terminal testing.
---

# API: Vitest Matchers

```typescript
import { createTestTerminal } from "@termless/test" // Matchers auto-registered on import

// Or register manually (e.g., when using createTerminal directly):
import "@termless/test/matchers"

// Or cherry-pick:
import { terminalMatchers } from "@termless/test/matchers"
expect.extend(terminalMatchers)
```

Matchers are composable: use region selectors to pick **where**, then assert **what**. All support `.not` negation.

## Text Matchers (on Region / Row)

### `toContainText(text: string)`

Assert region contains the given text as a substring.

```typescript
expect(term.screen).toContainText("Hello")
expect(term.scrollback).not.toContainText("error")
expect(term.row(0)).toContainText("Title")
```

### `toHaveText(text: string)`

Assert region text matches exactly after trimming.

```typescript
expect(term.row(0)).toHaveText("Title")
expect(term.row(2)).toHaveText("status: ok")
```

### `toMatchLines(lines: string[])`

Assert region lines match expected array. Trailing whitespace is trimmed per line.

```typescript
expect(term.screen).toMatchLines(["Line 1", "Line 2", "", "Line 4"])
```

## Cell Style Matchers (on Cell)

### `toHaveFg(color: string | Color)`

Assert foreground color. Accepts `"#rrggbb"` string or `{ r, g, b }` object.

```typescript
expect(term.cell(0, 0)).toHaveFg("#ff0000")
expect(term.cell(0, 0)).toHaveFg({ r: 255, g: 0, b: 0 })
```

### `toHaveBg(color: string | Color)`

Assert background color.

```typescript
expect(term.cell(0, 0)).toHaveBg("#282a36")
```

### `toBeBold()`

Assert cell is bold.

```typescript
expect(term.cell(0, 0)).toBeBold()
```

### `toBeItalic()`

Assert cell is italic.

```typescript
expect(term.cell(0, 0)).toBeItalic()
```

### `toBeFaint()`

Assert cell is faint/dim.

```typescript
expect(term.cell(0, 0)).toBeFaint()
```

### `toHaveUnderline(style?: UnderlineStyle)`

Assert cell has underline. Optionally check specific style.

```typescript
expect(term.cell(0, 0)).toHaveUnderline() // Any underline
expect(term.cell(0, 0)).toHaveUnderline("single") // Specific style
expect(term.cell(0, 0)).toHaveUnderline("curly") // Curly underline (e.g., spell check)
```

Styles: `"single"`, `"double"`, `"curly"`, `"dotted"`, `"dashed"`.

### `toBeStrikethrough()`

Assert cell has strikethrough.

```typescript
expect(term.cell(0, 0)).toBeStrikethrough()
```

### `toBeInverse()`

Assert cell has inverse (reverse video).

```typescript
expect(term.cell(0, 0)).toBeInverse()
```

### `toBeWide()`

Assert cell is a double-width character (CJK, emoji).

```typescript
expect(term.cell(0, 0)).toBeWide() // First cell of a wide char
```

## Cursor Matchers (on Terminal)

### `toHaveCursorAt(x: number, y: number)`

Assert cursor is at the given position (column, row).

```typescript
expect(term).toHaveCursorAt(0, 0) // Top-left
expect(term).toHaveCursorAt(5, 2) // Column 5, row 2
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

## Terminal Mode Matcher (on Terminal)

### `toBeInMode(mode: TerminalMode)`

Assert a specific terminal mode is enabled. Replaces the old `toBeInAltScreen()`, `toBeInBracketedPaste()`, and `toHaveMode()` matchers.

```typescript
expect(term).toBeInMode("altScreen")
expect(term).toBeInMode("bracketedPaste")
expect(term).toBeInMode("mouseTracking")
expect(term).toBeInMode("applicationCursor")
expect(term).not.toBeInMode("insertMode")
```

Available modes: `altScreen`, `cursorVisible`, `bracketedPaste`, `applicationCursor`, `applicationKeypad`, `autoWrap`, `mouseTracking`, `focusTracking`, `originMode`, `insertMode`, `reverseVideo`.

## Title Matcher (on Terminal)

### `toHaveTitle(title: string)`

Assert terminal title (set via OSC 2 escape sequence).

```typescript
expect(term).toHaveTitle("vim - file.txt")
```

## Scrollback Matchers (on Terminal)

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

## Snapshot Matcher (on Terminal)

### `toMatchTerminalSnapshot(options?)`

Match terminal content against a Vitest snapshot.

```typescript
expect(term).toMatchTerminalSnapshot()
expect(term).toMatchTerminalSnapshot({ name: "after-input" })
```

## Snapshot Serializer

For human-readable `.snap` files, register the serializer:

```typescript
import { terminalSerializer, terminalSnapshot } from "@termless/test"

expect.addSnapshotSerializer(terminalSerializer)

test("renders correctly", () => {
  // ...
  expect(terminalSnapshot(term)).toMatchSnapshot()
  expect(terminalSnapshot(term, "after-input")).toMatchSnapshot()
})
```

### `terminalSnapshot(terminal, name?)`

Wraps a `Terminal` for the snapshot serializer.

```typescript
function terminalSnapshot(terminal: Terminal, name?: string): TerminalSnapshotMarker
```
