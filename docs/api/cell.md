---
title: Cell, Cursor & Colors API
description: API reference for Cell, Cursor, CursorStyle, Color, UnderlineStyle, and other terminal cell types in Termless.
---

# API: Cell, Cursor, Colors

```typescript
import type { Cell, Cursor, CursorStyle, Color, UnderlineStyle, TerminalMode, ScrollbackState } from "@termless/core"
```

## Cell

Represents a single terminal cell with text content and style attributes.

```typescript
interface Cell {
  text: string // Character(s) in this cell
  fg: Color | null // Foreground color (null = default)
  bg: Color | null // Background color (null = default)
  bold: boolean
  faint: boolean // Dim/half-bright
  italic: boolean
  underline: UnderlineStyle // "none" | "single" | "double" | "curly" | "dotted" | "dashed"
  strikethrough: boolean
  inverse: boolean // Foreground/background swapped
  wide: boolean // Double-width character (CJK, emoji)
}
```

## Color

```typescript
type Color = { r: number; g: number; b: number; index?: number }
```

Values are 0-255 per channel. `index` is the ANSI/256-color palette index, when known.

## UnderlineStyle

```typescript
type UnderlineStyle = "none" | "single" | "double" | "curly" | "dotted" | "dashed"
```

## Cursor

```typescript
interface Cursor {
  col: number // Column (0-based)
  row: number // Row (0-based)
  visible: boolean
  style: CursorStyle
}
```

## CursorStyle

```typescript
type CursorStyle = "block" | "underline" | "beam"
```

## TerminalMode

```typescript
type TerminalMode =
  | "altScreen" // Alternate screen buffer (fullscreen TUI)
  | "cursorVisible" // DECTCEM cursor visibility
  | "bracketedPaste" // Bracketed paste mode
  | "applicationCursor" // Application cursor keys (DECCKM)
  | "applicationKeypad" // Application keypad mode (DECKPAM)
  | "autoWrap" // Auto-wrap at end of line
  | "mouseTracking" // Mouse event reporting
  | "focusTracking" // Focus in/out reporting
  | "originMode" // DECOM origin mode
  | "insertMode" // IRM insert mode
  | "reverseVideo" // DECSCNM reverse video
```

## ScrollbackState

```typescript
interface ScrollbackState {
  viewportTop: number // Lines scrolled up from bottom (0 = at bottom)
  totalRows: number // Total rows in buffer (screen + scrollback)
  screenRows: number // Visible screen height
}
```

## KeyDescriptor

Used by `parseKey()` and `keyToAnsi()`:

```typescript
interface KeyDescriptor {
  key: string // Main key name (e.g. "a", "ArrowUp", "F5")
  shift?: boolean
  ctrl?: boolean
  alt?: boolean
  super?: boolean // Meta/Cmd/Super
}
```

## MouseEvent

For backends with mouse encoding support:

```typescript
interface MouseEvent {
  x: number
  y: number
  button: "left" | "middle" | "right" | "wheelUp" | "wheelDown" | "none"
  action: "press" | "release" | "move"
  shift?: boolean
  ctrl?: boolean
  alt?: boolean
}
```

## SvgScreenshotOptions

```typescript
interface SvgScreenshotOptions {
  fontFamily?: string // CSS font-family
  fontSize?: number // Font size in px
  cellWidth?: number // Cell width in px
  cellHeight?: number // Cell height in px
  theme?: SvgTheme
}

interface SvgTheme {
  foreground?: string // Default text color (hex)
  background?: string // Background color (hex)
  cursor?: string // Cursor color (hex)
  palette?: Record<number, string> // ANSI palette overrides (0-255)
}
```
