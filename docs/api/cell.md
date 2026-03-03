# API: Cell, Cursor, Colors

```typescript
import type { Cell, CursorState, CursorStyle, RGB, UnderlineStyle, TerminalMode, ScrollbackState } from "@termless/core"
```

## Cell

Represents a single terminal cell with text content and style attributes.

```typescript
interface Cell {
  text: string              // Character(s) in this cell
  fg: RGB | null            // Foreground color (null = default)
  bg: RGB | null            // Background color (null = default)
  bold: boolean
  faint: boolean            // Dim/half-bright
  italic: boolean
  underline: UnderlineStyle // "none" | "single" | "double" | "curly" | "dotted" | "dashed"
  strikethrough: boolean
  inverse: boolean          // Foreground/background swapped
  wide: boolean             // Double-width character (CJK, emoji)
}
```

## RGB

```typescript
type RGB = { r: number; g: number; b: number }
```

Values are 0-255 per channel.

## UnderlineStyle

```typescript
type UnderlineStyle = "none" | "single" | "double" | "curly" | "dotted" | "dashed"
```

## CursorState

```typescript
interface CursorState {
  x: number       // Column (0-based)
  y: number       // Row (0-based)
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
  | "altScreen"         // Alternate screen buffer (fullscreen TUI)
  | "cursorVisible"     // DECTCEM cursor visibility
  | "bracketedPaste"    // Bracketed paste mode
  | "applicationCursor" // Application cursor keys (DECCKM)
  | "applicationKeypad" // Application keypad mode (DECKPAM)
  | "autoWrap"          // Auto-wrap at end of line
  | "mouseTracking"     // Mouse event reporting
  | "focusTracking"     // Focus in/out reporting
  | "originMode"        // DECOM origin mode
  | "insertMode"        // IRM insert mode
  | "reverseVideo"      // DECSCNM reverse video
```

## ScrollbackState

```typescript
interface ScrollbackState {
  viewportOffset: number  // Lines scrolled up from bottom (0 = at bottom)
  totalLines: number      // Total lines in buffer (screen + scrollback)
  screenLines: number     // Visible screen height
}
```

## KeyDescriptor

Used by `parseKey()` and `keyToAnsi()`:

```typescript
interface KeyDescriptor {
  key: string        // Main key name (e.g. "a", "ArrowUp", "F5")
  shift?: boolean
  ctrl?: boolean
  alt?: boolean
  super?: boolean    // Meta/Cmd/Super
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
  fontFamily?: string   // CSS font-family
  fontSize?: number     // Font size in px
  cellWidth?: number    // Cell width in px
  cellHeight?: number   // Cell height in px
  theme?: SvgTheme
}

interface SvgTheme {
  foreground?: string                 // Default text color (hex)
  background?: string                 // Background color (hex)
  cursor?: string                     // Cursor color (hex)
  palette?: Record<number, string>    // ANSI palette overrides (0-255)
}
```
