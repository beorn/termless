/**
 * View factories for composable terminal regions.
 *
 * Views are lightweight wrappers that read from a TerminalReadable on demand.
 * All row-based views are lazy — they recompute buffer offsets on every access
 * so auto-retry matchers see fresh data when polled across time.
 */

import type { Cell, CellView, RegionView, RowView, TerminalReadable, UnderlineStyle } from "./types.ts"

// ── Helpers ──

/** Convert a Cell[] to trimmed text. */
function cellsToText(cells: Cell[]): string {
  return cells
    .map((c) => c.char || " ")
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

/**
 * Create a lazy RegionView from a row-range resolver.
 * The resolver is called on every getText()/getLines() access,
 * so the view always reflects current terminal state.
 */
function createLazyRegionView(
  readable: TerminalReadable,
  resolveRange: () => [start: number, end: number],
): RegionView {
  return {
    getText(): string {
      const [start, end] = resolveRange()
      return getRowTexts(readable, start, end).join("\n")
    },
    getLines(): string[] {
      const [start, end] = resolveRange()
      return getRowTexts(readable, start, end)
    },
    containsText(text: string): boolean {
      return this.getText().includes(text)
    },
  }
}

// ── CellView ──

/** Create a CellView from a Cell with positional context. */
export function createCellView(cell: Cell, row: number, col: number): CellView {
  return {
    char: cell.char,
    row,
    col,
    fg: cell.fg,
    bg: cell.bg,
    bold: cell.bold,
    dim: cell.dim,
    italic: cell.italic,
    underline: cell.underline,
    underlineColor: cell.underlineColor,
    strikethrough: cell.strikethrough,
    inverse: cell.inverse,
    blink: cell.blink,
    hidden: cell.hidden,
    wide: cell.wide,
    continuation: cell.continuation,
    hyperlink: cell.hyperlink,
  }
}

// ── RegionView ──

/** Create a RegionView for a fixed absolute row range [startRow, endRow). */
export function createRegionView(readable: TerminalReadable, startRow: number, endRow: number): RegionView {
  return createLazyRegionView(readable, () => [startRow, endRow])
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
  return createLazyRegionView(readable, () => {
    const { totalLines, screenLines } = readable.getScrollback()
    const base = totalLines - screenLines
    return [base, base + screenLines]
  })
}

/**
 * Scrollback view: history lines above the screen.
 * Empty in alt screen mode.
 * @param n - If provided, only the last N scrollback lines.
 */
export function createScrollbackView(readable: TerminalReadable, n?: number): RegionView {
  return createLazyRegionView(readable, () => {
    const { totalLines, screenLines } = readable.getScrollback()
    const base = totalLines - screenLines
    if (base <= 0) return [0, 0]
    const start = n != null ? Math.max(0, base - n) : 0
    return [start, base]
  })
}

/**
 * Buffer view: everything (scrollback + screen).
 * Uses readable.getText() directly — not row-based.
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
 * At bottom (viewportOffset = totalLines - screenLines): same as screen.
 * Scrolled up: shows older scrollback lines.
 */
export function createViewportView(readable: TerminalReadable): RegionView {
  return createLazyRegionView(readable, () => {
    const { viewportOffset, screenLines } = readable.getScrollback()
    return [viewportOffset, viewportOffset + screenLines]
  })
}

/**
 * Range view: a rectangular region of the screen.
 * Coordinates are screen-relative. Uses getTextRange() — not row-based.
 */
export function createRangeView(
  readable: TerminalReadable,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): RegionView {
  return {
    getText(): string {
      const { totalLines, screenLines } = readable.getScrollback()
      const base = totalLines - screenLines
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
