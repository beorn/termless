/**
 * Pure cells → ANSI serializer. No browser globals, no native deps.
 *
 * Given a snapshot of a `TerminalReadable`'s cell grid, produce ANSI bytes that —
 * when fed to a fresh terminal — produce the same visible state. The inverse of
 * "feed bytes → parse → cells".
 *
 * This is the bridge used by `renderTerminalPng()` (in `./render.ts`) to feed
 * an already-parsed terminal back into ghostty-web's parser for the canvas
 * renderer. It's also useful standalone for round-tripping snapshots.
 *
 * Note: this is a *visual* serialization. It doesn't preserve cursor moves,
 * scroll history, or original SGR sequencing — just the final visible grid.
 */

import type { Cell, CursorState, RGB, TerminalReadable } from "../../../src/types.ts"

function rgbToSgr(role: "fg" | "bg", color: RGB): string {
  const code = role === "fg" ? 38 : 48
  return `${code};2;${color.r};${color.g};${color.b}`
}

interface SgrState {
  fg: RGB | null
  bg: RGB | null
  bold: boolean
  dim: boolean
  italic: boolean
  underline: Cell["underline"]
  strikethrough: boolean
  inverse: boolean
  hidden: boolean
}

const INITIAL_SGR: SgrState = {
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  strikethrough: false,
  inverse: false,
  hidden: false,
}

function sgrFor(cell: Cell): SgrState {
  return {
    fg: cell.fg,
    bg: cell.bg,
    bold: cell.bold,
    dim: cell.dim,
    italic: cell.italic,
    underline: cell.underline,
    strikethrough: cell.strikethrough,
    inverse: cell.inverse,
    hidden: cell.hidden,
  }
}

function rgbEqual(a: RGB | null, b: RGB | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.r === b.r && a.g === b.g && a.b === b.b
}

function sgrCodesBetween(prev: SgrState, next: SgrState): string {
  // If anything turns off, just emit a full reset + reapply the active set.
  const turnedOff =
    (prev.bold && !next.bold) ||
    (prev.dim && !next.dim) ||
    (prev.italic && !next.italic) ||
    (prev.underline && !next.underline) ||
    (prev.strikethrough && !next.strikethrough) ||
    (prev.inverse && !next.inverse) ||
    (prev.hidden && !next.hidden) ||
    (prev.fg !== null && next.fg === null) ||
    (prev.bg !== null && next.bg === null)
  const parts: string[] = []
  if (turnedOff) {
    parts.push("0")
    if (next.bold) parts.push("1")
    if (next.dim) parts.push("2")
    if (next.italic) parts.push("3")
    if (next.underline) parts.push("4")
    if (next.inverse) parts.push("7")
    if (next.hidden) parts.push("8")
    if (next.strikethrough) parts.push("9")
    if (next.fg) parts.push(rgbToSgr("fg", next.fg))
    if (next.bg) parts.push(rgbToSgr("bg", next.bg))
  } else {
    if (!prev.bold && next.bold) parts.push("1")
    if (!prev.dim && next.dim) parts.push("2")
    if (!prev.italic && next.italic) parts.push("3")
    if (!prev.underline && next.underline) parts.push("4")
    if (!prev.inverse && next.inverse) parts.push("7")
    if (!prev.hidden && next.hidden) parts.push("8")
    if (!prev.strikethrough && next.strikethrough) parts.push("9")
    if (!rgbEqual(prev.fg, next.fg) && next.fg) parts.push(rgbToSgr("fg", next.fg))
    if (!rgbEqual(prev.bg, next.bg) && next.bg) parts.push(rgbToSgr("bg", next.bg))
  }
  if (parts.length === 0) return ""
  return `\x1b[${parts.join(";")}m`
}

function nonDefault(s: SgrState): boolean {
  return (
    s.bold ||
    s.dim ||
    s.italic ||
    !!s.underline ||
    s.strikethrough ||
    s.inverse ||
    s.hidden ||
    s.fg !== null ||
    s.bg !== null
  )
}

/**
 * Serialize a TerminalReadable's cell grid back to ANSI escape sequences.
 *
 * The output begins with a deterministic preamble:
 *   \x1b[H     — cursor home (1,1)
 *   \x1b[2J    — clear entire display
 *   \x1b[?7l   — DECAWM off: writing exactly `cols` chars to a row must NOT
 *                enter the pending-wrap state. ghostty-web (with DECAWM on)
 *                double-advances when a row fills the right margin and the
 *                next byte is CR — losing the top N rows of the buffer
 *                when every row emits exactly cols glyphs.
 *   \x1b[?25l  — hide cursor so the cursor box doesn't paint over content
 *
 * After the cells are emitted, the cursor is repositioned via CSI H so callers
 * that re-enable the cursor see it where the source terminal had it.
 */
export function cellsToAnsi(terminal: TerminalReadable, opts: { rows?: number; cols?: number } = {}): string {
  const lines = terminal.getLines()
  const rowCount = opts.rows ?? lines.length
  // Use only the last `rowCount` rows to match a screen-shaped render.
  const screenRows = lines.slice(Math.max(0, lines.length - rowCount))
  const colCount = opts.cols ?? screenRows[0]?.length ?? 0
  const cursor: CursorState | null = (() => {
    try {
      return terminal.getCursor()
    } catch {
      return null
    }
  })()

  let prev: SgrState = INITIAL_SGR
  let out = "\x1b[H\x1b[2J\x1b[?7l\x1b[?25l"
  for (let r = 0; r < screenRows.length; r++) {
    const row = screenRows[r]
    for (let c = 0; c < colCount; c++) {
      const cell = row?.[c]
      if (!cell) {
        // Blank cell — emit space with default attrs (after a reset if needed).
        if (prev !== INITIAL_SGR && nonDefault(prev)) {
          out += "\x1b[0m"
          prev = INITIAL_SGR
        }
        out += " "
        continue
      }
      if (cell.continuation) continue // wide-char trailing cell — skip
      const next = sgrFor(cell)
      out += sgrCodesBetween(prev, next)
      out += cell.char.length > 0 ? cell.char : " "
      prev = next
    }
    if (r < screenRows.length - 1) {
      // Reset + CRLF at row boundary so colors don't bleed into next line.
      out += "\x1b[0m\r\n"
      prev = INITIAL_SGR
    }
  }
  // Trailing reset.
  out += "\x1b[0m"
  // Position cursor.
  if (cursor && cursor.x >= 0 && cursor.y >= 0) {
    // ANSI is 1-indexed.
    out += `\x1b[${cursor.y + 1};${cursor.x + 1}H`
  }
  return out
}
