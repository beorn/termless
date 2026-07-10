/**
 * Terminal snapshots — a frozen copy of a terminal's visible cell grid.
 *
 * A live {@link Terminal} keeps mutating as its process emits output. To
 * record an animation you must *freeze* each frame: deep-copy the cell grid +
 * cursor at capture time, then render the frozen copies afterwards. A
 * {@link TerminalSnapshot} is that frozen copy, and {@link snapshotReadable}
 * wraps one as a {@link TerminalReadable} so any renderer — `screenshotSvg`,
 * swash's `renderCells`, `renderTerminalPng` — can paint it long after the
 * source terminal has closed.
 */

import type { Cell, CursorState, TestTerminal, TerminalReadable } from "./types.ts"

/** A frozen copy of a terminal's visible cell grid + cursor. */
export interface TerminalSnapshot {
  grid: Cell[][]
  cursor: CursorState
  cols: number
  rows: number
  title: string
}

const BLANK_CELL: Cell = {
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

/** Deep-copy a terminal's current visible state into a {@link TerminalSnapshot}. */
export function snapshotTerminal(term: TestTerminal): TerminalSnapshot {
  const grid = term.getRows().map((row) => row.map((cell) => ({ ...cell })))
  let cursor: CursorState
  try {
    cursor = term.getCursor()
  } catch {
    cursor = { col: 0, row: 0, x: 0, y: 0, visible: false, style: null }
  }
  let title = ""
  try {
    title = term.getTitle()
  } catch {
    // ignore — title is optional
  }
  return { grid, cursor, cols: term.cols, rows: term.rows, title }
}

/**
 * Wrap a {@link TerminalSnapshot} as a {@link TerminalReadable}. The snapshot
 * is a frozen copy, so this view is stable even after the source terminal has
 * closed — which is exactly what frame-by-frame rendering needs.
 */
export function snapshotReadable(snap: TerminalSnapshot): TerminalReadable {
  const cellAt = (row: number, col: number): Cell => snap.grid[row]?.[col] ?? BLANK_CELL
  return {
    getText: () => snap.grid.map((row) => row.map((c) => c.char || " ").join("")).join("\n"),
    getTextRange: (r1: number, c1: number, r2: number, c2: number) => {
      const out: string[] = []
      for (let r = r1; r <= r2; r++) {
        let line = ""
        for (let c = c1; c <= c2; c++) line += cellAt(r, c).char || " "
        out.push(line)
      }
      return out.join("\n")
    },
    getCell: cellAt,
    getLine: (row: number) => snap.grid[row] ?? [],
    getLines: () => snap.grid,
    getCursor: () => snap.cursor,
    getMode: () => false,
    getTitle: () => snap.title,
    getScrollback: () => ({ lines: [], total: 0 }),
    cols: snap.cols,
    rows: snap.rows,
  } as unknown as TerminalReadable
}
