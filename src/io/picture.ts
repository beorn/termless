/**
 * The readable picture — the value types an {@link "./emulator.ts" | Emulator}
 * exposes.
 *
 * These are the shapes a caller reads *out* of an emulator: the grid geometry,
 * a cell, the cursor, the mode vocabulary. They live here, at the bottom of
 * the io module, because the emulator contract cannot be stated without them
 * and io depends on nothing.
 *
 * `terminal/types.ts` re-exports every name in this file, so the existing
 * `@termless/core` surface is unchanged — there is exactly one declaration of
 * each shape in the package.
 */

// ── Geometry ──

/** Terminal grid geometry in character cells. */
export interface Size {
  cols: number
  rows: number
}

// ── Cell ──

export interface Cell {
  char: string
  fg: Color | null
  bg: Color | null
  bold: boolean
  dim: boolean
  italic: boolean
  underline: UnderlineStyle
  underlineColor: Color | null
  strikethrough: boolean
  inverse: boolean
  blink: boolean
  hidden: boolean
  wide: boolean
  continuation: boolean
  hyperlink: string | null
}

/**
 * Underline rendering style. `"none"` means no underline.
 *
 * `false` is the **deprecated** legacy spelling of `"none"`; it remains an
 * accepted value at boundaries so existing backends keep compiling during the
 * schema-major migration. New code should read/write `"none"`.
 */
export type UnderlineStyle = "none" | "single" | "double" | "curly" | "dotted" | "dashed" | false

/**
 * A terminal color. `r`/`g`/`b` are always present (0–255); `index` optionally
 * preserves the origin palette slot (0–255) when the color came from an indexed
 * palette entry. Painters read `r`/`g`/`b` unconditionally; only identity-aware
 * code touches `index`.
 */
export type Color = { r: number; g: number; b: number; index?: number }

// ── Cursor ──

export interface Cursor {
  /** Cursor column (0-based). */
  col: number
  /** Cursor row (0-based). */
  row: number
  /** Whether the cursor is visible. `null` if the backend doesn't know. */
  visible: boolean | null
  /** Cursor shape. `null` if the backend doesn't know. */
  style: CursorStyle | null
  /** @deprecated REMOVING in unterm phase A4 — renamed to {@link Cursor.col}. Kept required during the migration window. */
  x: number
  /** @deprecated REMOVING in unterm phase A4 — renamed to {@link Cursor.row}. Kept required during the migration window. */
  y: number
}

export type CursorStyle = "block" | "underline" | "beam"

// ── Modes ──

/**
 * A terminal mode an emulator can report.
 *
 * The full-word mode vocabulary. `terminal/types.ts` re-exports this as the
 * deprecated `TerminalMode`.
 */
export type Mode =
  | "altScreen"
  | "cursorVisible"
  | "bracketedPaste"
  | "applicationCursor"
  | "applicationKeypad"
  | "autoWrap"
  | "mouseTracking"
  | "focusTracking"
  | "originMode"
  | "insertMode"
  | "reverseVideo"

/** Every {@link Mode}, in declaration order — the exhaustive mode vocabulary. */
export const MODES: readonly Mode[] = [
  "altScreen",
  "cursorVisible",
  "bracketedPaste",
  "applicationCursor",
  "applicationKeypad",
  "autoWrap",
  "mouseTracking",
  "focusTracking",
  "originMode",
  "insertMode",
  "reverseVideo",
]

/**
 * A snapshot of every mode's state. Every {@link Mode} is present — a mode the
 * emulator does not track reports `false`, never absent, so a reader can never
 * confuse "off" with "unknown by omission".
 */
export type Modes = Readonly<Record<Mode, boolean>>
