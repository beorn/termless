/**
 * View factories for composable terminal regions.
 *
 * Views are lightweight wrappers that read from a TerminalReadable on demand.
 * They compute the correct absolute buffer row positions for each region
 * (screen, scrollback, buffer, viewport) using getScrollback() metadata.
 */

import type { Cell, CellView, RegionView, RowView, TerminalReadable, UnderlineStyle } from "./types.ts"

// ── Helpers ──

/** Convert a Cell[] to trimmed text. */
function cellsToText(cells: Cell[]): string {
  return cells
    .map((c) => c.text || " ")
    .join("")
    .trimEnd()
}

/** Get rows of text from a TerminalReadable for an absolute row range. */
function getRowTexts(readable: TerminalReadable, startRow: number, endRow: number): string[] {
  const lines: string[] = []
  for (let i = startRow; i < endRow; i++) {
    lines.push(cellsToText(readable.getLine(i)))
  }
  return lines
}

// ── CellView ──

/** Create a CellView from a Cell with positional context. */
export function createCellView(cell: Cell, row: number, col: number): CellView {
  return {
    text: cell.text,
    row,
    col,
    fg: cell.fg,
    bg: cell.bg,
    bold: cell.bold,
    faint: cell.faint,
    italic: cell.italic,
    underline: cell.underline,
    strikethrough: cell.strikethrough,
    inverse: cell.inverse,
    wide: cell.wide,
  }
}

// ── RegionView ──

/** Create a RegionView for an absolute row range [startRow, endRow). */
export function createRegionView(readable: TerminalReadable, startRow: number, endRow: number): RegionView {
  return {
    getText(): string {
      return getRowTexts(readable, startRow, endRow).join("\n")
    },
    getLines(): string[] {
      return getRowTexts(readable, startRow, endRow)
    },
    containsText(text: string): boolean {
      return this.getText().includes(text)
    },
  }
}

// ── RowView ──

/** Create a RowView for an absolute row position. screenRow is the display row number. */
export function createRowView(readable: TerminalReadable, absRow: number, screenRow: number): RowView {
  return {
    get row() {
      return screenRow
    },
    get cells() {
      return readable.getLine(absRow)
    },
    getText(): string {
      return cellsToText(readable.getLine(absRow))
    },
    getLines(): string[] {
      return [this.getText()]
    },
    containsText(text: string): boolean {
      return this.getText().includes(text)
    },
    cellAt(col: number): CellView {
      return createCellView(readable.getCell(absRow, col), screenRow, col)
    },
  }
}

// ── Specialized Region Views ──

/**
 * Screen view: the fixed rows × cols grid at the bottom of the buffer.
 * In alt mode, this is the entire alt buffer.
 */
export function createScreenView(readable: TerminalReadable): RegionView {
  const { totalLines, screenLines } = readable.getScrollback()
  const base = totalLines - screenLines
  return createRegionView(readable, base, base + screenLines)
}

/**
 * Scrollback view: history lines above the screen.
 * Empty in alt screen mode.
 * @param n - If provided, only the last N scrollback lines.
 */
export function createScrollbackView(readable: TerminalReadable, n?: number): RegionView {
  const { totalLines, screenLines } = readable.getScrollback()
  const base = totalLines - screenLines
  if (base <= 0) {
    return createRegionView(readable, 0, 0)
  }
  const start = n != null ? Math.max(0, base - n) : 0
  return createRegionView(readable, start, base)
}

/**
 * Buffer view: everything (scrollback + screen).
 * Delegates to getText() for the full buffer content.
 */
export function createBufferView(readable: TerminalReadable): RegionView {
  return {
    getText(): string {
      return readable.getText()
    },
    getLines(): string[] {
      return readable.getText().split("\n")
    },
    containsText(text: string): boolean {
      return readable.getText().includes(text)
    },
  }
}

/**
 * Viewport view: what's visible at the current scroll position.
 * At bottom: same as screen. Scrolled up: shows scrollback lines.
 */
export function createViewportView(readable: TerminalReadable): RegionView {
  const { viewportOffset, screenLines } = readable.getScrollback()
  return createRegionView(readable, viewportOffset, viewportOffset + screenLines)
}

/**
 * Range view: a rectangular region of the screen.
 * Coordinates are screen-relative.
 */
export function createRangeView(
  readable: TerminalReadable,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): RegionView {
  const { totalLines, screenLines } = readable.getScrollback()
  const base = totalLines - screenLines
  return {
    getText(): string {
      return readable.getTextRange(base + r1, c1, base + r2, c2)
    },
    getLines(): string[] {
      return this.getText().split("\n")
    },
    containsText(text: string): boolean {
      return this.getText().includes(text)
    },
  }
}
