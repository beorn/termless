/**
 * Visual diff between two terminal buffers.
 *
 * Compares two TerminalReadable instances cell-by-cell and produces a
 * structured diff result plus a human-readable formatted string.
 */

import type { Cell, RGB, TerminalReadable, UnderlineStyle } from "./types.ts"

// =============================================================================
// Types
// =============================================================================

/** A single cell difference between two buffers. */
export interface CellDiff {
  row: number
  col: number
  old: CellSummary
  new: CellSummary
}

/** Compact representation of a cell's visible properties. */
export interface CellSummary {
  char: string
  fg: RGB | null
  bg: RGB | null
  bold: boolean
  italic: boolean
  underline: UnderlineStyle
}

/** Result of comparing two terminal buffers. */
export interface DiffResult {
  /** Whether the buffers are identical. */
  equal: boolean
  /** Positions that differ, with old and new cell values. */
  diffs: CellDiff[]
  /** Human-readable formatted diff string. */
  formatted: string
}

// =============================================================================
// Helpers
// =============================================================================

function cellToSummary(cell: Cell): CellSummary {
  return {
    char: cell.char,
    fg: cell.fg,
    bg: cell.bg,
    bold: cell.bold,
    italic: cell.italic,
    underline: cell.underline,
  }
}

function cellsEqual(a: Cell, b: Cell): boolean {
  return (
    a.char === b.char &&
    rgbEqual(a.fg, b.fg) &&
    rgbEqual(a.bg, b.bg) &&
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.underlineColor === b.underlineColor &&
    a.strikethrough === b.strikethrough &&
    a.inverse === b.inverse &&
    a.blink === b.blink &&
    a.hidden === b.hidden &&
    a.wide === b.wide &&
    a.continuation === b.continuation &&
    a.hyperlink === b.hyperlink
  )
}

function rgbEqual(a: RGB | null, b: RGB | null): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  return a.r === b.r && a.g === b.g && a.b === b.b
}

function formatRgb(color: RGB | null): string {
  if (!color) return "default"
  return `#${color.r.toString(16).padStart(2, "0")}${color.g.toString(16).padStart(2, "0")}${color.b.toString(16).padStart(2, "0")}`
}

function describeCellDiff(diff: CellDiff): string {
  const parts: string[] = []

  if (diff.old.char !== diff.new.char) {
    const oldChar = diff.old.char || " "
    const newChar = diff.new.char || " "
    parts.push(`text: '${oldChar}' -> '${newChar}'`)
  }

  if (!rgbEqual(diff.old.fg, diff.new.fg)) {
    parts.push(`fg: ${formatRgb(diff.old.fg)} -> ${formatRgb(diff.new.fg)}`)
  }

  if (!rgbEqual(diff.old.bg, diff.new.bg)) {
    parts.push(`bg: ${formatRgb(diff.old.bg)} -> ${formatRgb(diff.new.bg)}`)
  }

  if (diff.old.bold !== diff.new.bold) {
    parts.push(`bold: ${diff.old.bold} -> ${diff.new.bold}`)
  }

  if (diff.old.italic !== diff.new.italic) {
    parts.push(`italic: ${diff.old.italic} -> ${diff.new.italic}`)
  }

  if (diff.old.underline !== diff.new.underline) {
    parts.push(`underline: ${diff.old.underline} -> ${diff.new.underline}`)
  }

  return parts.join(", ")
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Compare two terminal buffers cell-by-cell.
 *
 * Returns positions that differ with old/new values, plus a formatted diff
 * string for human-readable output.
 *
 * @example
 * ```ts
 * const result = diffBuffers(termA, termB)
 * if (!result.equal) {
 *   console.log(result.formatted)
 *   // (0,5) text: 'a' -> 'b'
 *   // (1,0) fg: #ff0000 -> default
 * }
 * ```
 */
export function diffBuffers(a: TerminalReadable, b: TerminalReadable): DiffResult {
  const linesA = a.getLines()
  const linesB = b.getLines()
  const maxRows = Math.max(linesA.length, linesB.length)

  const diffs: CellDiff[] = []

  for (let row = 0; row < maxRows; row++) {
    const rowA = linesA[row] ?? []
    const rowB = linesB[row] ?? []
    const maxCols = Math.max(rowA.length, rowB.length)

    for (let col = 0; col < maxCols; col++) {
      const cellA = rowA[col] ?? emptyCell()
      const cellB = rowB[col] ?? emptyCell()

      if (!cellsEqual(cellA, cellB)) {
        diffs.push({
          row,
          col,
          old: cellToSummary(cellA),
          new: cellToSummary(cellB),
        })
      }
    }
  }

  const formatted =
    diffs.length === 0
      ? "Buffers are identical"
      : diffs.map((d) => `(${d.row},${d.col}) ${describeCellDiff(d)}`).join("\n")

  return {
    equal: diffs.length === 0,
    diffs,
    formatted,
  }
}

function emptyCell(): Cell {
  return {
    char: " ",
    fg: null,
    bg: null,
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    underlineColor: null,
    strikethrough: false,
    inverse: false,
    blink: false,
    hidden: false,
    wide: false,
    continuation: false,
    hyperlink: null,
  }
}
