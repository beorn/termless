/**
 * Tests for the terminal snapshot serializer.
 *
 * Verifies that the serializer correctly identifies terminal snapshot markers
 * and formats terminal state as readable text snapshots.
 */

import { describe, test, expect } from "vitest"
import { terminalSerializer, terminalSnapshot } from "../src/serializer.ts"
import type {
  TerminalReadable,
  Cell,
  CursorState,
  ScrollbackState,
  TerminalMode,
  RGB,
  UnderlineStyle,
} from "../../../src/types.ts"

// =============================================================================
// Mock Terminal (same as matchers test)
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
  blink: false,
  inverse: false,
  hidden: false,
  strikethrough: false,
  wide: false,
  continuation: false,
  hyperlink: null,
}

function createMockTerminal(
  options: {
    lines?: string[]
    cells?: Map<string, Partial<Cell>>
    cursor?: Partial<CursorState>
    modes?: Partial<Record<TerminalMode, boolean>>
    title?: string
  } = {},
): TerminalReadable {
  const { lines = [""], cells = new Map(), cursor = {}, modes = {} } = options

  const maxCols = Math.max(...lines.map((l) => l.length), 1)
  const grid: Cell[][] = lines.map((line) => {
    const row: Cell[] = []
    for (let col = 0; col < maxCols; col++) {
      row.push({ ...DEFAULT_CELL, char: line[col] ?? " " })
    }
    return row
  })

  for (const [key, overrides] of cells) {
    const [r, c] = key.split(",").map(Number) as [number, number]
    if (grid[r]?.[c]) {
      grid[r]![c] = { ...grid[r]![c]!, ...overrides }
    }
  }

  const cursorState: CursorState = {
    x: cursor.x ?? 0,
    y: cursor.y ?? 0,
    visible: cursor.visible ?? true,
    style: cursor.style ?? "block",
  }

  return {
    getText: () => grid.map((r) => r.map((c) => c.char || " ").join("")).join("\n"),
    getTextRange: () => "",
    getCell: (row, col) => grid[row]?.[col] ?? { ...DEFAULT_CELL },
    getLine: (row) => grid[row] ?? [],
    getLines: () => grid,
    getCursor: () => cursorState,
    getMode: (mode: TerminalMode) => modes[mode] ?? false,
    getTitle: () => options.title ?? "",
    getScrollback: () => ({ viewportOffset: 0, totalLines: grid.length, screenLines: grid.length }),
  }
}

// =============================================================================
// Tests
// =============================================================================

describe("terminalSerializer", () => {
  test("test() returns true for terminal snapshot markers", () => {
    const term = createMockTerminal({ lines: ["Hello"] })
    const marker = terminalSnapshot(term)
    expect(terminalSerializer.test(marker)).toBe(true)
  })

  test("test() returns false for plain objects", () => {
    expect(terminalSerializer.test({})).toBe(false)
    expect(terminalSerializer.test(null)).toBe(false)
    expect(terminalSerializer.test("string")).toBe(false)
    expect(terminalSerializer.test(42)).toBe(false)
  })

  test("test() returns false for object with wrong marker value", () => {
    expect(terminalSerializer.test({ __terminalSnapshot: false })).toBe(false)
  })

  test("serialize() renders header with dimensions and cursor", () => {
    const term = createMockTerminal({
      lines: ["Hello", "World"],
      cursor: { x: 3, y: 1, visible: true, style: "block" },
    })
    const result = terminalSerializer.serialize(terminalSnapshot(term))

    expect(result).toContain("# terminal 5x2")
    expect(result).toContain("cursor (3,1) visible block")
  })

  test("serialize() includes altScreen in header when active", () => {
    const term = createMockTerminal({
      lines: ["Test"],
      modes: { altScreen: true },
    })
    const result = terminalSerializer.serialize(terminalSnapshot(term))
    expect(result).toContain("| altScreen")
  })

  test("serialize() does not include altScreen when inactive", () => {
    const term = createMockTerminal({ lines: ["Test"] })
    const result = terminalSerializer.serialize(terminalSnapshot(term))
    expect(result).not.toContain("altScreen")
  })

  test("serialize() includes line numbers", () => {
    const term = createMockTerminal({ lines: ["First", "Second", "Third"] })
    const result = terminalSerializer.serialize(terminalSnapshot(term))

    expect(result).toContain(" 1\u2502First")
    expect(result).toContain(" 2\u2502Secon")
    expect(result).toContain(" 3\u2502Third")
  })

  test("serialize() includes separator line", () => {
    const term = createMockTerminal({ lines: ["Test"] })
    const result = terminalSerializer.serialize(terminalSnapshot(term))
    expect(result).toContain("\u2500".repeat(50))
  })

  test("serialize() annotates styled cells", () => {
    const cells = new Map([["0,0", { bold: true, fg: { r: 255, g: 0, b: 0 } }]])
    const term = createMockTerminal({ lines: ["X"], cells })
    const result = terminalSerializer.serialize(terminalSnapshot(term))

    expect(result).toContain("fg:#ff0000")
    expect(result).toContain("bold")
  })

  test("serialize() annotates multiple styles on same cell", () => {
    const cells = new Map([["0,0", { italic: true, strikethrough: true }]])
    const term = createMockTerminal({ lines: ["X"], cells })
    const result = terminalSerializer.serialize(terminalSnapshot(term))

    expect(result).toContain("italic")
    expect(result).toContain("strike")
  })

  test("serialize() includes custom name in header", () => {
    const term = createMockTerminal({ lines: ["Test"] })
    const result = terminalSerializer.serialize(terminalSnapshot(term, "after-edit"))
    expect(result).toContain("| after-edit")
  })

  test("serialize() handles hidden cursor", () => {
    const term = createMockTerminal({
      lines: ["Test"],
      cursor: { visible: false, style: "beam" },
    })
    const result = terminalSerializer.serialize(terminalSnapshot(term))
    expect(result).toContain("hidden beam")
  })
})

describe("terminalSnapshot", () => {
  test("creates a valid marker object", () => {
    const term = createMockTerminal({ lines: ["Hello"] })
    const marker = terminalSnapshot(term)

    expect(marker.__terminalSnapshot).toBe(true)
    expect(marker.terminal).toBe(term)
  })

  test("includes optional name", () => {
    const term = createMockTerminal({ lines: ["Hello"] })
    const marker = terminalSnapshot(term, "step-1")

    expect(marker.name).toBe("step-1")
  })
})
