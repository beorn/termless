/**
 * Cell-grid → ANSI byte stream encoder.
 *
 * Used by the live recorder overlay to mirror a headless terminal's grid onto
 * the host terminal as raw escape sequences. The encoder is deduplicating —
 * it only emits an SGR sequence when an attribute actually changes between
 * consecutive cells. A run of identical-style cells produces one SGR followed
 * by the run's glyphs.
 *
 * This module is intentionally side-effect-free and host-agnostic — callers
 * (e.g. {@link "../../packages/cli/src/rec-live-overlay.ts"}) decide where the
 * bytes go (stdout, a buffer, a test sink). It does NOT touch process.stdout,
 * setRawMode, or alt-screen state.
 */

import type { Cell, RGB } from "../terminal/types.ts"

/** ANSI SGR reset — clears every attribute. */
export const SGR_RESET = "\x1b[0m"

/** Bytes for "move cursor to top-left of the screen" (CUP 1;1). */
export const CSI_HOME = "\x1b[H"

/** Bytes for "hide cursor" (DECTCEM off). */
export const CSI_HIDE_CURSOR = "\x1b[?25l"

/** Bytes for "show cursor" (DECTCEM on). */
export const CSI_SHOW_CURSOR = "\x1b[?25h"

/** Bytes for "switch to alternate screen buffer" (SMCUP). */
export const CSI_ENTER_ALT_SCREEN = "\x1b[?1049h"

/** Bytes for "leave alternate screen buffer" (RMCUP). */
export const CSI_LEAVE_ALT_SCREEN = "\x1b[?1049l"

/** Bytes for "clear entire screen" (ED 2). */
export const CSI_CLEAR_SCREEN = "\x1b[2J"

/**
 * Move the cursor to a 1-based (row, col) on the host terminal.
 * Out-of-bounds values are clamped to a minimum of 1.
 */
export function ansiCursorTo(row: number, col: number): string {
  const r = Math.max(1, Math.floor(row))
  const c = Math.max(1, Math.floor(col))
  return `\x1b[${r};${c}H`
}

/**
 * Style descriptor — the subset of {@link Cell} attributes that map to SGR.
 * The optional shape lets {@link cellsToAnsi} carry forward "current state"
 * without committing to a default for any individual flag.
 */
export interface CellStyle {
  fg: RGB | null
  bg: RGB | null
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
  strikethrough: boolean
  inverse: boolean
  blink: boolean
}

/** Style produced by SGR 0 — used to seed a row's state-machine. */
export function freshStyle(): CellStyle {
  return {
    fg: null,
    bg: null,
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    strikethrough: false,
    inverse: false,
    blink: false,
  }
}

function rgbEq(a: RGB | null, b: RGB | null): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  return a.r === b.r && a.g === b.g && a.b === b.b
}

/**
 * Compute the SGR delta — the minimum SGR sequence that transitions
 * {@link prev} into {@link next}. Returns the empty string when the two
 * states match. Always emits SGR 0 first if any flag needs to drop, because
 * SGR has no individual "off" code for some attributes (notably, you can
 * turn bold off, but a clean reset is shorter than tracking the four
 * separate intensity codes).
 */
export function sgrDelta(prev: CellStyle, next: CellStyle): string {
  const needsReset =
    (prev.bold && !next.bold) ||
    (prev.dim && !next.dim) ||
    (prev.italic && !next.italic) ||
    (prev.underline && !next.underline) ||
    (prev.strikethrough && !next.strikethrough) ||
    (prev.inverse && !next.inverse) ||
    (prev.blink && !next.blink) ||
    (prev.fg !== null && next.fg === null) ||
    (prev.bg !== null && next.bg === null)

  const codes: string[] = []
  let base = prev

  if (needsReset) {
    codes.push("0")
    base = freshStyle()
  }

  if (next.bold && !base.bold) codes.push("1")
  if (next.dim && !base.dim) codes.push("2")
  if (next.italic && !base.italic) codes.push("3")
  if (next.underline && !base.underline) codes.push("4")
  if (next.blink && !base.blink) codes.push("5")
  if (next.inverse && !base.inverse) codes.push("7")
  if (next.strikethrough && !base.strikethrough) codes.push("9")

  if (next.fg && !rgbEq(base.fg, next.fg)) {
    codes.push(`38;2;${next.fg.r};${next.fg.g};${next.fg.b}`)
  }
  if (next.bg && !rgbEq(base.bg, next.bg)) {
    codes.push(`48;2;${next.bg.r};${next.bg.g};${next.bg.b}`)
  }

  if (codes.length === 0) return ""
  return `\x1b[${codes.join(";")}m`
}

/** Pull the style-relevant subset of a {@link Cell}. */
function styleOf(cell: Cell): CellStyle {
  return {
    fg: cell.fg,
    bg: cell.bg,
    bold: cell.bold,
    dim: cell.dim,
    italic: cell.italic,
    underline: cell.underline !== false,
    strikethrough: cell.strikethrough,
    inverse: cell.inverse,
    blink: cell.blink,
  }
}

/**
 * Render a row of cells as ANSI bytes with state-deduplicated SGR sequences.
 * Always pads or truncates to exactly `cols` glyph-cells wide, so the caller
 * can position-and-print each row at a fixed column without trailing junk.
 *
 * Wide-cell continuation cells are skipped (their leading half already
 * contributed the glyph + advanced the cursor by 2). Empty / null cells
 * render as a single space carrying their bg (so background colour bleeds
 * correctly across blank regions).
 *
 * The row ends with SGR 0 so any subsequent text (chrome border, status
 * line) starts on a known-clean style.
 */
export function rowToAnsi(row: readonly Cell[], cols: number): string {
  let out = ""
  let state = freshStyle()
  let written = 0

  for (let c = 0; c < cols && c < row.length; c++) {
    const cell = row[c]
    if (!cell) {
      // No cell at this column — paint a default space.
      const delta = sgrDelta(state, freshStyle())
      if (delta) out += delta
      state = freshStyle()
      out += " "
      written++
      continue
    }
    if (cell.continuation) continue

    const want = styleOf(cell)
    const delta = sgrDelta(state, want)
    if (delta) out += delta
    state = want

    const ch = cell.char || " "
    out += ch
    written += cell.wide ? 2 : 1
  }

  // Pad to cols.
  if (written < cols) {
    const delta = sgrDelta(state, freshStyle())
    if (delta) out += delta
    state = freshStyle()
    out += " ".repeat(cols - written)
  }

  if (
    state.fg ||
    state.bg ||
    state.bold ||
    state.dim ||
    state.italic ||
    state.underline ||
    state.strikethrough ||
    state.inverse ||
    state.blink
  ) {
    out += SGR_RESET
  }
  return out
}
