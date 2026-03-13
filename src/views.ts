/**
 * View factories for composable terminal regions.
 *
 * Views are lightweight wrappers that read from a TerminalReadable on demand.
 * They compute the correct absolute buffer row positions for each region
 * (screen, scrollback, buffer, viewport) using getScrollback() metadata.
 */

import type { Cell, CellView, RegionView, RowView, TerminalReadable } from "./types.ts"

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
    blink: cell.blink,
    inverse: cell.inverse,
    hidden: cell.hidden,
    strikethrough: cell.strikethrough,
    wide: cell.wide,
    continuation: cell.continuation,
    hyperlink: cell.hyperlink,
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
 *
 * Lazy: re-queries screen boundaries on each access, so the view
 * reflects content changes after creation (Playwright-style locator).
 */
export function createScreenView(readable: TerminalReadable): RegionView {
  function getRange(): [number, number] {
    const { totalLines, screenLines } = readable.getScrollback()
    const base = totalLines - screenLines
    return [base, base + screenLines]
  }

  return {
    getText(): string {
      const [start, end] = getRange()
      return getRowTexts(readable, start, end).join("\n")
    },
    getLines(): string[] {
      const [start, end] = getRange()
      return getRowTexts(readable, start, end)
    },
    containsText(text: string): boolean {
      return this.getText().includes(text)
    },
  }
}

/**
 * Scrollback view: history lines above the screen.
 * Empty in alt screen mode.
 *
 * Lazy: re-queries scrollback boundaries on each access, so the view
 * reflects new content that scrolls off screen after creation.
 * This makes it work as a Playwright-style locator for auto-retry matchers.
 *
 * @param n - If provided, only the last N scrollback lines.
 */
export function createScrollbackView(readable: TerminalReadable, n?: number): RegionView {
  function getRange(): [number, number] {
    const { totalLines, screenLines } = readable.getScrollback()
    const base = totalLines - screenLines
    if (base <= 0) return [0, 0]
    const start = n != null ? Math.max(0, base - n) : 0
    return [start, base]
  }

  return {
    getText(): string {
      const [start, end] = getRange()
      return getRowTexts(readable, start, end).join("\n")
    },
    getLines(): string[] {
      const [start, end] = getRange()
      return getRowTexts(readable, start, end)
    },
    containsText(text: string): boolean {
      return this.getText().includes(text)
    },
  }
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
 *
 * Lazy: re-queries viewport offset on each access, so the view
 * reflects scroll changes after creation (Playwright-style locator).
 */
export function createViewportView(readable: TerminalReadable): RegionView {
  function getRange(): [number, number] {
    const { viewportOffset, screenLines } = readable.getScrollback()
    return [viewportOffset, viewportOffset + screenLines]
  }

  return {
    getText(): string {
      const [start, end] = getRange()
      return getRowTexts(readable, start, end).join("\n")
    },
    getLines(): string[] {
      const [start, end] = getRange()
      return getRowTexts(readable, start, end)
    },
    containsText(text: string): boolean {
      return this.getText().includes(text)
    },
  }
}

/**
 * Range view: a rectangular region of the screen.
 * Coordinates are screen-relative.
 *
 * Lazy: re-queries screen base on each access, so the view
 * reflects buffer changes after creation (Playwright-style locator).
 */
export function createRangeView(
  readable: TerminalReadable,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): RegionView {
  function getBase(): number {
    const { totalLines, screenLines } = readable.getScrollback()
    return totalLines - screenLines
  }

  return {
    getText(): string {
      const base = getBase()
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
