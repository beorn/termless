/**
 * Tests for visual-state snapshotting — frame change detection.
 *
 * Verifies `snapshotVisualState` produces a deterministic string that captures
 * every visually-relevant property (cell styles, cursor, modes, title), so two
 * terminals that look identical snapshot identically and any visual difference
 * produces a different snapshot.
 */

import { describe, test, expect } from "vitest"
import { snapshotVisualState } from "../src/recording/visual-snapshot.ts"
import type { Cell, CursorState, ScrollbackState, TerminalMode, TerminalReadable } from "../src/index.ts"

// =============================================================================
// snapshotVisualState
// =============================================================================

const DEFAULT_CELL: Cell = {
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

function createReadable(
  opts: {
    lines?: string[]
    cells?: Map<string, Partial<Cell>>
    cursor?: Partial<CursorState>
    modes?: Partial<Record<TerminalMode, boolean>>
    title?: string
  } = {},
): TerminalReadable {
  const { lines = [""], cells = new Map(), cursor = {}, modes = {}, title = "" } = opts
  const maxCols = Math.max(...lines.map((l) => l.length), 1)

  const grid: Cell[][] = lines.map((line, row) => {
    const rowCells: Cell[] = []
    for (let col = 0; col < maxCols; col++) {
      const key = `${row},${col}`
      const overrides = cells.get(key) ?? {}
      rowCells.push({ ...DEFAULT_CELL, char: line[col] ?? " ", ...overrides })
    }
    return rowCells
  })

  const cursorState: CursorState = {
    x: cursor.x ?? 0,
    y: cursor.y ?? 0,
    col: cursor.x ?? 0,
    row: cursor.y ?? 0,
    visible: cursor.visible ?? true,
    style: cursor.style ?? "block",
  }

  return {
    getText: () => grid.map((r) => r.map((c) => c.char || " ").join("")).join("\n"),
    getTextRange: () => "",
    getCell: (row, col) => grid[row]?.[col] ?? { ...DEFAULT_CELL },
    getLine: (row) => grid[row] ?? [],
    getLines: () => grid,
    getRow: (row) => grid[row] ?? [],
    getRows: () => grid,
    getCursor: () => cursorState,
    getMode: (mode: TerminalMode) => modes[mode] ?? false,
    getTitle: () => title,
    getScrollback: (): ScrollbackState => ({
      viewportOffset: 0,
      totalLines: grid.length,
      screenLines: grid.length,
      viewportTop: 0,
      totalRows: grid.length,
      screenRows: grid.length,
    }),
  }
}

describe("snapshotVisualState", () => {
  test("identical terminals produce identical snapshots", () => {
    const a = createReadable({ lines: ["Hello"] })
    const b = createReadable({ lines: ["Hello"] })
    expect(snapshotVisualState(a)).toBe(snapshotVisualState(b))
  })

  test("different text produces different snapshots", () => {
    const a = createReadable({ lines: ["Hello"] })
    const b = createReadable({ lines: ["World"] })
    expect(snapshotVisualState(a)).not.toBe(snapshotVisualState(b))
  })

  test("detects foreground color changes", () => {
    const a = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { fg: { r: 255, g: 0, b: 0 } }]]),
    })
    const b = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { fg: { r: 0, g: 255, b: 0 } }]]),
    })
    // Same text "X" but different fg color — must produce different snapshots
    expect(snapshotVisualState(a)).not.toBe(snapshotVisualState(b))
  })

  test("detects background color changes", () => {
    const a = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { bg: { r: 0, g: 0, b: 255 } }]]),
    })
    const b = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { bg: null }]]),
    })
    expect(snapshotVisualState(a)).not.toBe(snapshotVisualState(b))
  })

  test("detects bold style changes", () => {
    const a = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { bold: true }]]),
    })
    const b = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { bold: false }]]),
    })
    expect(snapshotVisualState(a)).not.toBe(snapshotVisualState(b))
  })

  test("detects italic style changes", () => {
    const a = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { italic: true }]]),
    })
    const b = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { italic: false }]]),
    })
    expect(snapshotVisualState(a)).not.toBe(snapshotVisualState(b))
  })

  test("detects underline style changes", () => {
    const a = createReadable({
      lines: ["X"],
      cells: new Map<string, Partial<Cell>>([["0,0", { underline: "single" }]]),
    })
    const b = createReadable({
      lines: ["X"],
      cells: new Map<string, Partial<Cell>>([["0,0", { underline: false }]]),
    })
    expect(snapshotVisualState(a)).not.toBe(snapshotVisualState(b))
  })

  test("detects cursor position changes", () => {
    const a = createReadable({ lines: ["Hello"], cursor: { x: 0, y: 0 } })
    const b = createReadable({ lines: ["Hello"], cursor: { x: 5, y: 0 } })
    expect(snapshotVisualState(a)).not.toBe(snapshotVisualState(b))
  })

  test("detects cursor style changes", () => {
    const a = createReadable({ lines: ["Hello"], cursor: { style: "block" } })
    const b = createReadable({ lines: ["Hello"], cursor: { style: "beam" } })
    expect(snapshotVisualState(a)).not.toBe(snapshotVisualState(b))
  })

  test("detects cursor visibility changes", () => {
    const a = createReadable({ lines: ["Hello"], cursor: { visible: true } })
    const b = createReadable({ lines: ["Hello"], cursor: { visible: false } })
    expect(snapshotVisualState(a)).not.toBe(snapshotVisualState(b))
  })

  test("detects title changes", () => {
    const a = createReadable({ lines: ["Hello"], title: "Terminal 1" })
    const b = createReadable({ lines: ["Hello"], title: "Terminal 2" })
    expect(snapshotVisualState(a)).not.toBe(snapshotVisualState(b))
  })

  test("detects alt screen mode changes", () => {
    const a = createReadable({ lines: ["Hello"], modes: { altScreen: false } })
    const b = createReadable({ lines: ["Hello"], modes: { altScreen: true } })
    expect(snapshotVisualState(a)).not.toBe(snapshotVisualState(b))
  })

  test("detects inverse style changes", () => {
    const a = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { inverse: true }]]),
    })
    const b = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { inverse: false }]]),
    })
    expect(snapshotVisualState(a)).not.toBe(snapshotVisualState(b))
  })

  test("detects strikethrough style changes", () => {
    const a = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { strikethrough: true }]]),
    })
    const b = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { strikethrough: false }]]),
    })
    expect(snapshotVisualState(a)).not.toBe(snapshotVisualState(b))
  })

  test("detects dim style changes", () => {
    const a = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { dim: true }]]),
    })
    const b = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { dim: false }]]),
    })
    expect(snapshotVisualState(a)).not.toBe(snapshotVisualState(b))
  })

  test("detects hyperlink changes", () => {
    const a = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { hyperlink: "https://example.com" }]]),
    })
    const b = createReadable({
      lines: ["X"],
      cells: new Map([["0,0", { hyperlink: null }]]),
    })
    expect(snapshotVisualState(a)).not.toBe(snapshotVisualState(b))
  })

  test("snapshot is deterministic (multiple calls return same value)", () => {
    const readable = createReadable({
      lines: ["Hello", "World"],
      cells: new Map([["0,0", { bold: true, fg: { r: 255, g: 0, b: 0 } }]]),
      cursor: { x: 3, y: 1, style: "beam", visible: true },
      title: "test",
    })
    const s1 = snapshotVisualState(readable)
    const s2 = snapshotVisualState(readable)
    expect(s1).toBe(s2)
  })
})
