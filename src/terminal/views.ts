/**
 * View factories for composable terminal regions.
 *
 * Views are lightweight wrappers that read a picture on demand. All row-based
 * views are lazy — they recompute buffer offsets on every access, so
 * auto-retry matchers see fresh data when polled across time.
 *
 * The picture a view reads is the read half of the io {@link Emulator}:
 * `getText`, `getCell`, `size` and the `scrollback` extent. One implementation
 * serves every reader — an Emulator, the legacy {@link Terminal} read contract
 * for the migration window, and the matchers that move to viterm in unterm
 * phase B2 — so nobody grows a second region implementation over `getText()`.
 */

import type { Emulator } from "../io/emulator.ts"
import type { Cell, CellView, Region, Row, Terminal } from "./types.ts"

// ── What a view reads ──

/**
 * The read half of an io {@link Emulator}: the picture a view reads. Every
 * Emulator satisfies it structurally, and nothing beyond it is required.
 */
export type PictureReadable = Pick<Emulator, "getText" | "getCell" | "size" | "scrollback">

/**
 * What a view reads from — a {@link PictureReadable}, or the legacy
 * {@link Terminal} read contract.
 *
 * The `Terminal` half is migration scaffolding: REMOVING in unterm phase A4,
 * when the legacy contract goes and views read only the picture.
 */
export type ViewReadable = PictureReadable | Terminal

/** Buffer geometry in absolute rows: the screen is `[base, base + screenRows)`. */
interface Extent {
  base: number
  screenRows: number
  viewportTop: number
}

function isLegacyTerminal(readable: ViewReadable): readable is Terminal {
  return typeof (readable as Terminal).getScrollback === "function"
}

function extentOf(readable: ViewReadable): Extent {
  if (isLegacyTerminal(readable)) {
    const { totalRows, screenRows, viewportTop } = readable.getScrollback()
    return { base: totalRows - screenRows, screenRows, viewportTop }
  }
  // An Emulator has no viewport scroll: what is visible is the screen.
  return { base: readable.scrollback, screenRows: readable.size.rows, viewportTop: readable.scrollback }
}

/** The cells of one absolute buffer row. */
function rowCells(readable: ViewReadable, row: number): Cell[] {
  if (isLegacyTerminal(readable)) return readable.getRow(row)
  const cells: Cell[] = []
  for (let col = 0; col < readable.size.cols; col++) cells.push(readable.getCell(row, col))
  return cells
}

// ── Helpers ──

/** Convert a Cell[] to trimmed text. */
function cellsToText(cells: Cell[]): string {
  return cells
    .map((c) => c.char || " ")
    .join("")
    .trimEnd()
}

/** Get rows of text for an absolute row range [startRow, endRow). */
function getRowTexts(readable: ViewReadable, startRow: number, endRow: number): string[] {
  const lines: string[] = []
  for (let i = startRow; i < endRow; i++) {
    lines.push(cellsToText(rowCells(readable, i)))
  }
  return lines
}

/**
 * Text in a rectangular range of absolute buffer rows, inclusive of both
 * rows. `startCol`/`endCol` apply to the first/last row respectively (end
 * exclusive); intermediate rows are full width. The legacy contract answers
 * this itself; the picture path composes it from cells.
 */
function getTextRange(
  readable: ViewReadable,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
): string {
  if (isLegacyTerminal(readable)) return readable.getTextRange(startRow, startCol, endRow, endCol)
  const lines: string[] = []
  for (let row = startRow; row <= endRow; row++) {
    const cells = rowCells(readable, row)
    const colStart = row === startRow ? startCol : 0
    const colEnd = row === endRow ? endCol : cells.length
    lines.push(cellsToText(cells.slice(colStart, colEnd)))
  }
  return lines.join("\n")
}

/**
 * Create a lazy {@link Region} from a row-range resolver.
 * The resolver is called on every getText()/getLines() access,
 * so the view always reflects current terminal state.
 */
function createLazyRegion(readable: ViewReadable, resolveRange: () => [start: number, end: number]): Region {
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
 * @deprecated REMOVING in unterm phase A4 — the positioned-cell concept is folded into {@link Cell}; this
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
export function createRegion(readable: ViewReadable, startRow: number, endRow: number): Region {
  return createLazyRegion(readable, () => [startRow, endRow])
}

// ── Row ──

/** Create a {@link Row} for an absolute row position. screenRow is the display row number. */
export function createRow(readable: ViewReadable, absRow: number, screenRow: number): Row {
  return {
    get row() {
      return screenRow
    },
    get cells() {
      return rowCells(readable, absRow)
    },
    getText(): string {
      return cellsToText(rowCells(readable, absRow))
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

// ── Specialized Region Views ──

/**
 * Screen view: the fixed rows × cols grid at the bottom of the buffer.
 * In alt mode, this is the entire alt buffer.
 */
export function createScreenView(readable: ViewReadable): Region {
  return createLazyRegion(readable, () => {
    const { base, screenRows } = extentOf(readable)
    return [base, base + screenRows]
  })
}

/**
 * Scrollback view: history rows above the screen.
 * Empty in alt screen mode.
 * @param n - If provided, only the last N scrollback rows.
 */
export function createScrollbackView(readable: ViewReadable, n?: number): Region {
  return createLazyRegion(readable, () => {
    const { base } = extentOf(readable)
    if (base <= 0) return [0, 0]
    const start = n != null ? Math.max(0, base - n) : 0
    return [start, base]
  })
}

/**
 * Buffer view: everything (scrollback + screen).
 * Uses readable.getText() directly — not row-based.
 */
export function createBufferView(readable: ViewReadable): Region {
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
 * Scrolled up: shows older scrollback rows. An Emulator has no scroll
 * position, so over one this is the screen.
 */
export function createViewportView(readable: ViewReadable): Region {
  return createLazyRegion(readable, () => {
    const { viewportTop, screenRows } = extentOf(readable)
    return [viewportTop, viewportTop + screenRows]
  })
}

/**
 * Range view: a rectangular region of the screen.
 * Coordinates are screen-relative; columns are end-exclusive on the last row.
 */
export function createRangeView(readable: ViewReadable, r1: number, c1: number, r2: number, c2: number): Region {
  return {
    getText(): string {
      const { base } = extentOf(readable)
      return getTextRange(readable, base + r1, c1, base + r2, c2)
    },
    getLines(): string[] {
      return this.getText().split("\n")
    },
    containsText(text: string): boolean {
      return this.getText().includes(text)
    },
  }
}
