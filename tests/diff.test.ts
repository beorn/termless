/**
 * Tests for diffBuffers() -- cell-by-cell terminal buffer comparison.
 *
 * Uses mock TerminalReadable instances to verify diff detection for text,
 * color, and style changes across buffers of same and different sizes.
 */

import { describe, test, expect } from "vitest"
import { diffBuffers } from "../src/diff.ts"
import type { Cell, CursorState, ScrollbackState, TerminalMode, TerminalReadable } from "../src/types.ts"

// =============================================================================
// Mock Terminal Factory
// =============================================================================

const DEFAULT_CELL: Cell = {
  text: " ",
  fg: null,
  bg: null,
  bold: false,
  faint: false,
  italic: false,
  underline: "none",
  strikethrough: false,
  inverse: false,
  wide: false,
}

interface MockOptions {
  lines?: string[]
  cells?: Map<string, Partial<Cell>>
}

function createMockTerminal(options: MockOptions = {}): TerminalReadable {
  const { lines = [""], cells = new Map() } = options
  const maxCols = Math.max(...lines.map((l) => l.length), 1)

  const grid: Cell[][] = lines.map((line, row) => {
    const rowCells: Cell[] = []
    for (let col = 0; col < maxCols; col++) {
      const key = `${row},${col}`
      const overrides = cells.get(key) ?? {}
      rowCells.push({ ...DEFAULT_CELL, text: line[col] ?? " ", ...overrides })
    }
    return rowCells
  })

  return {
    getText: () => grid.map((r) => r.map((c) => c.text || " ").join("")).join("\n"),
    getTextRange: () => "",
    getCell: (row, col) => grid[row]?.[col] ?? { ...DEFAULT_CELL },
    getLine: (row) => grid[row] ?? [],
    getLines: () => grid,
    getCursor: (): CursorState => ({ x: 0, y: 0, visible: true, style: "block" }),
    getMode: (_mode: TerminalMode) => false,
    getTitle: () => "",
    getScrollback: (): ScrollbackState => ({ viewportOffset: 0, totalLines: grid.length, screenLines: grid.length }),
  }
}

// =============================================================================
// Tests
// =============================================================================

describe("diffBuffers", () => {
  test("identical buffers produce no diffs", () => {
    const a = createMockTerminal({ lines: ["Hello", "World"] })
    const b = createMockTerminal({ lines: ["Hello", "World"] })
    const result = diffBuffers(a, b)

    expect(result.equal).toBe(true)
    expect(result.diffs).toHaveLength(0)
    expect(result.formatted).toBe("Buffers are identical")
  })

  test("detects text differences", () => {
    const a = createMockTerminal({ lines: ["Hello"] })
    const b = createMockTerminal({ lines: ["Hxllo"] })
    const result = diffBuffers(a, b)

    expect(result.equal).toBe(false)
    expect(result.diffs).toHaveLength(1)
    expect(result.diffs[0]!.row).toBe(0)
    expect(result.diffs[0]!.col).toBe(1)
    expect(result.diffs[0]!.old.text).toBe("e")
    expect(result.diffs[0]!.new.text).toBe("x")
  })

  test("detects multiple text differences", () => {
    const a = createMockTerminal({ lines: ["abc"] })
    const b = createMockTerminal({ lines: ["xbz"] })
    const result = diffBuffers(a, b)

    expect(result.equal).toBe(false)
    expect(result.diffs).toHaveLength(2)
    expect(result.diffs[0]!.col).toBe(0) // a -> x
    expect(result.diffs[1]!.col).toBe(2) // c -> z
  })

  test("detects foreground color differences", () => {
    const cellsA = new Map([["0,0", { fg: { r: 255, g: 0, b: 0 } }]])
    const cellsB = new Map([["0,0", { fg: { r: 0, g: 255, b: 0 } }]])
    const a = createMockTerminal({ lines: ["X"], cells: cellsA })
    const b = createMockTerminal({ lines: ["X"], cells: cellsB })
    const result = diffBuffers(a, b)

    expect(result.equal).toBe(false)
    expect(result.diffs).toHaveLength(1)
    expect(result.formatted).toContain("fg:")
    expect(result.formatted).toContain("#ff0000")
    expect(result.formatted).toContain("#00ff00")
  })

  test("detects background color differences", () => {
    const cellsA = new Map([["0,0", { bg: { r: 0, g: 0, b: 0 } }]])
    const cellsB = new Map([["0,0", { bg: null }]])
    const a = createMockTerminal({ lines: ["X"], cells: cellsA as Map<string, Partial<Cell>> })
    const b = createMockTerminal({ lines: ["X"], cells: cellsB as Map<string, Partial<Cell>> })
    const result = diffBuffers(a, b)

    expect(result.equal).toBe(false)
    expect(result.diffs).toHaveLength(1)
    expect(result.formatted).toContain("bg:")
  })

  test("detects bold style differences", () => {
    const cellsA = new Map([["0,0", { bold: true }]])
    const cellsB = new Map([["0,0", { bold: false }]])
    const a = createMockTerminal({ lines: ["X"], cells: cellsA })
    const b = createMockTerminal({ lines: ["X"], cells: cellsB })
    const result = diffBuffers(a, b)

    expect(result.equal).toBe(false)
    expect(result.formatted).toContain("bold: true -> false")
  })

  test("detects italic style differences", () => {
    const cellsA = new Map<string, Partial<Cell>>([["0,0", { italic: false }]])
    const cellsB = new Map<string, Partial<Cell>>([["0,0", { italic: true }]])
    const a = createMockTerminal({ lines: ["X"], cells: cellsA })
    const b = createMockTerminal({ lines: ["X"], cells: cellsB })
    const result = diffBuffers(a, b)

    expect(result.equal).toBe(false)
    expect(result.formatted).toContain("italic: false -> true")
  })

  test("detects underline style differences", () => {
    const cellsA = new Map<string, Partial<Cell>>([["0,0", { underline: "none" }]])
    const cellsB = new Map<string, Partial<Cell>>([["0,0", { underline: "single" }]])
    const a = createMockTerminal({ lines: ["X"], cells: cellsA })
    const b = createMockTerminal({ lines: ["X"], cells: cellsB })
    const result = diffBuffers(a, b)

    expect(result.equal).toBe(false)
    expect(result.formatted).toContain("underline: none -> single")
  })

  test("handles buffers with different row counts", () => {
    const a = createMockTerminal({ lines: ["Hello"] })
    const b = createMockTerminal({ lines: ["Hello", "World"] })
    const result = diffBuffers(a, b)

    expect(result.equal).toBe(false)
    // Row 1 in b has content, row 1 in a is empty
    expect(result.diffs.some((d) => d.row === 1)).toBe(true)
  })

  test("handles buffers with different column counts", () => {
    const a = createMockTerminal({ lines: ["Hi"] })
    const b = createMockTerminal({ lines: ["Hello"] })
    const result = diffBuffers(a, b)

    expect(result.equal).toBe(false)
    // Differs in cols beyond the shorter buffer's width
    expect(result.diffs.length).toBeGreaterThanOrEqual(3) // 'l', 'l', 'o'
  })

  test("formatted output includes position coordinates", () => {
    const a = createMockTerminal({ lines: ["ab"] })
    const b = createMockTerminal({ lines: ["xb"] })
    const result = diffBuffers(a, b)

    expect(result.formatted).toContain("(0,0)")
    expect(result.formatted).toContain("text: 'a' -> 'x'")
  })

  test("empty buffers are equal", () => {
    const a = createMockTerminal({ lines: [""] })
    const b = createMockTerminal({ lines: [""] })
    const result = diffBuffers(a, b)

    expect(result.equal).toBe(true)
  })

  test("multi-row diff lists all differences", () => {
    const a = createMockTerminal({ lines: ["ab", "cd"] })
    const b = createMockTerminal({ lines: ["xb", "cy"] })
    const result = diffBuffers(a, b)

    expect(result.diffs).toHaveLength(2)
    expect(result.diffs[0]!.row).toBe(0)
    expect(result.diffs[0]!.col).toBe(0)
    expect(result.diffs[1]!.row).toBe(1)
    expect(result.diffs[1]!.col).toBe(1)
  })
})
