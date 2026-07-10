/**
 * Visual-state snapshotting for terminal change detection.
 *
 * Captures the full visual state of a terminal (cell styles, cursor, modes,
 * title) as a deterministic string, so frame recorders can detect non-text
 * changes like cursor style, color, and mode transitions.
 *
 * The captured-session model itself lives in `recording.ts` (the unified
 * `Recording` type) and its format codecs (`asciicast/recording-codec.ts`,
 * `tape/compile.ts`, `native/native-rec.ts`). This module is only the
 * buffer-snapshot helper used by the `record` verb's change-detection loop.
 */

import type { Cell, RGB, TerminalReadable, TerminalMode, UnderlineStyle } from "../terminal/types.ts"

// =============================================================================
// Visual State Snapshotting
// =============================================================================

/** Modes that affect visual appearance and should be tracked for change detection. */
const VISUAL_MODES: TerminalMode[] = ["altScreen", "cursorVisible", "reverseVideo"]

function rgbToString(color: RGB | null): string {
  if (color === null) return "-"
  return `${color.r},${color.g},${color.b}`
}

function underlineToString(u: UnderlineStyle): string {
  return u === false ? "0" : u
}

function cellToString(cell: Cell): string {
  // Encode all visually-relevant cell properties into a compact string.
  // Order: char|fg|bg|bold|dim|italic|underline|underlineColor|strikethrough|inverse|blink|hidden|wide|hyperlink
  return `${cell.char}|${rgbToString(cell.fg)}|${rgbToString(cell.bg)}|${cell.bold ? 1 : 0}${cell.dim ? 1 : 0}${cell.italic ? 1 : 0}${underlineToString(cell.underline)}|${rgbToString(cell.underlineColor)}|${cell.strikethrough ? 1 : 0}${cell.inverse ? 1 : 0}${cell.blink ? 1 : 0}${cell.hidden ? 1 : 0}${cell.wide ? 1 : 0}|${cell.hyperlink ?? "-"}`
}

/**
 * Snapshot the full visual state of a terminal as a deterministic string.
 *
 * Captures everything that affects what the user sees:
 * - Cell content AND styles (fg, bg, bold, italic, underline, etc.)
 * - Cursor position, style, and visibility
 * - Terminal modes (alt screen, reverse video)
 * - Window title
 *
 * Two terminals that look identical produce identical snapshots.
 * Any visual difference — even just a color change on one cell —
 * produces a different snapshot.
 *
 * Use this for frame change detection instead of text-only comparison:
 *
 * @example
 * ```ts
 * let previousSnapshot: string | null = null
 * // ... in capture loop:
 * const snapshot = snapshotVisualState(terminal)
 * if (snapshot !== previousSnapshot) {
 *   captureFrame()
 *   previousSnapshot = snapshot
 * }
 * ```
 */
export function snapshotVisualState(readable: TerminalReadable): string {
  const parts: string[] = []

  // Cursor state
  const cursor = readable.getCursor()
  parts.push(`C:${cursor.col},${cursor.row},${cursor.visible},${cursor.style}`)

  // Title
  parts.push(`T:${readable.getTitle()}`)

  // Visual modes
  const modeFlags = VISUAL_MODES.map((m) => (readable.getMode(m) ? "1" : "0")).join("")
  parts.push(`M:${modeFlags}`)

  // Cell grid — every cell's full visual state
  const lines = readable.getRows()
  for (let row = 0; row < lines.length; row++) {
    const rowCells = lines[row]!
    const cellStrings: string[] = []
    for (let col = 0; col < rowCells.length; col++) {
      cellStrings.push(cellToString(rowCells[col]!))
    }
    parts.push(`R${row}:${cellStrings.join(";")}`)
  }

  return parts.join("\n")
}
