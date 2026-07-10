/**
 * View factories for composable terminal regions.
 *
 * Views are lightweight wrappers that read from a {@link Terminal} on demand.
 * All row-based views are lazy — they recompute buffer offsets on every access
 * so auto-retry matchers see fresh data when polled across time.
 */

import type { Cell, CellView, Region, Row, Terminal } from "./types.ts"

// ── Helpers ──

/** Convert a Cell[] to trimmed text. */
function cellsToText(cells: Cell[]): string {
  return cells
    .map((c) => c.char || " ")
    .join("")
    .trimEnd()
}

/** Get rows of text from a Terminal for an absolute row range. */
function getRowTexts(readable: Terminal, startRow: number, endRow: number): string[] {
  const lines: string[] = []
  for (let i = startRow; i < endRow; i++) {
    lines.push(cellsToText(readable.getRow(i)))
  }
  return lines
}

/**
 * Create a lazy {@link Region} from a row-range resolver.
 * The resolver is called on every getText()/getLines() access,
 * so the view always reflects current terminal state.
 */
function createLazyRegion(readable: Terminal, resolveRange: () => [start: number, end: number]): Region {
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

// ── Positioned cell ──

/**
 * Create a positioned cell (a {@link Cell} plus its `row`/`col`).
 *
 * @deprecated The positioned-cell concept is folded into {@link Cell}; this
 * remains so `cell()`/`cellAt()` can still carry position during the migration.
 */
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

// ── Region ──

/** Create a {@link Region} for a fixed absolute row range [startRow, endRow). */
export function createRegion(readable: Terminal, startRow: number, endRow: number): Region {
  return createLazyRegion(readable, () => [startRow, endRow])
}

/** @deprecated Renamed to {@link createRegion}. */
export const createRegionView = createRegion

// ── Row ──

/** Create a {@link Row} for an absolute row position. screenRow is the display row number. */
export function createRow(readable: Terminal, absRow: number, screenRow: number): Row {
  return {
    get row() {
      return screenRow
    },
    get cells() {
      return readable.getRow(absRow)
    },
    getText(): string {
      return cellsToText(readable.getRow(absRow))
    },
    getLines(): string[] {
      return [this.getText()]
    },
    containsText(text: string): boolean {
      return this.getText().includes(text)
    },
    cellAt(col: number): Cell {
      return createCellView(readable.getCell(absRow, col), screenRow, col)
    },
  }
}

/** @deprecated Renamed to {@link createRow}. */
export const createRowView = createRow

// ── Specialized Region Views ──

/**
 * Screen view: the fixed rows × cols grid at the bottom of the buffer.
 * In alt mode, this is the entire alt buffer.
 */
export function createScreenView(readable: Terminal): Region {
  return createLazyRegion(readable, () => {
    const { totalRows, screenRows } = readable.getScrollback()
    const base = totalRows - screenRows
    return [base, base + screenRows]
  })
}

/**
 * Scrollback view: history rows above the screen.
 * Empty in alt screen mode.
 * @param n - If provided, only the last N scrollback rows.
 */
export function createScrollbackView(readable: Terminal, n?: number): Region {
  return createLazyRegion(readable, () => {
    const { totalRows, screenRows } = readable.getScrollback()
    const base = totalRows - screenRows
    if (base <= 0) return [0, 0]
    const start = n != null ? Math.max(0, base - n) : 0
    return [start, base]
  })
}

/**
 * Buffer view: everything (scrollback + screen).
 * Uses readable.getText() directly — not row-based.
 */
export function createBufferView(readable: Terminal): Region {
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
 * At bottom (viewportTop = totalRows - screenRows): same as screen.
 * Scrolled up: shows older scrollback rows.
 */
export function createViewportView(readable: Terminal): Region {
  return createLazyRegion(readable, () => {
    const { viewportTop, screenRows } = readable.getScrollback()
    return [viewportTop, viewportTop + screenRows]
  })
}

/**
 * Range view: a rectangular region of the screen.
 * Coordinates are screen-relative. Uses getTextRange() — not row-based.
 */
export function createRangeView(readable: Terminal, r1: number, c1: number, r2: number, c2: number): Region {
  return {
    getText(): string {
      const { totalRows, screenRows } = readable.getScrollback()
      const base = totalRows - screenRows
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
