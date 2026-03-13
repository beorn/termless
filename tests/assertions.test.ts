/**
 * Tests for pure assertion functions — test-runner-agnostic core logic.
 *
 * These test the AssertionResult return values directly: { pass, message }.
 * No vitest matchers needed — just plain assertions on the result objects.
 */

import { describe, test, expect } from "vitest"
import type {
  CellView,
  CursorState,
  TerminalReadable,
  TerminalMode,
  ScrollbackState,
  RegionView,
  Cell,
  UnderlineStyle,
} from "../src/types.ts"
import {
  assertContainsText,
  assertHasText,
  assertMatchesLines,
  assertIsBold,
  assertIsItalic,
  assertIsFaint,
  assertIsStrikethrough,
  assertIsInverse,
  assertIsWide,
  assertHasUnderline,
  assertHasFg,
  assertHasBg,
  assertCursorAt,
  assertCursorStyle,
  assertCursorVisible,
  assertCursorHidden,
  assertInMode,
  assertTitle,
  assertScrollbackLines,
  assertAtBottomOfScrollback,
  isRegionView,
  isCellView,
  isTerminalReadable,
  assertRegionView,
  assertCellView,
  assertTerminalReadable,
} from "../src/assertions.ts"

// =============================================================================
// Mock Factories
// =============================================================================

function mockRegion(lines: string[]): RegionView {
  const text = lines.join("\n")
  return {
    getText: () => text,
    getLines: () => lines,
    containsText: (t: string) => text.includes(t),
  }
}

function mockCell(overrides: Partial<CellView> = {}): CellView {
  return {
    char: " ",
    row: 0,
    col: 0,
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
    ...overrides,
  }
}

interface MockTerminalOptions {
  lines?: string[]
  cursor?: Partial<CursorState>
  modes?: Partial<Record<TerminalMode, boolean>>
  title?: string
  scrollback?: Partial<ScrollbackState>
}

function createMockTerminal(options: MockTerminalOptions = {}): TerminalReadable {
  const { lines = [""], cursor = {}, modes = {}, title = "", scrollback = {} } = options

  const maxCols = Math.max(...lines.map((l) => l.length), 1)
  const grid: Cell[][] = lines.map((line) => {
    const row: Cell[] = []
    for (let col = 0; col < maxCols; col++) {
      row.push({
        char: line[col] ?? " ",
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
      })
    }
    return row
  })

  const cursorState: CursorState = {
    x: cursor.x ?? 0,
    y: cursor.y ?? 0,
    visible: cursor.visible ?? true,
    style: cursor.style ?? "block",
  }

  const scrollbackState: ScrollbackState = {
    viewportOffset: scrollback.viewportOffset ?? 0,
    totalLines: scrollback.totalLines ?? lines.length,
    screenLines: scrollback.screenLines ?? lines.length,
  }

  return {
    getText(): string {
      return grid.map((row) => row.map((c) => c.char || " ").join("")).join("\n")
    },
    getTextRange(startRow: number, startCol: number, endRow: number, endCol: number): string {
      if (startRow === endRow) {
        return (
          grid[startRow]
            ?.slice(startCol, endCol)
            .map((c) => c.char || " ")
            .join("") ?? ""
        )
      }
      const result: string[] = []
      for (let r = startRow; r <= endRow; r++) {
        const row = grid[r]
        if (!row) continue
        const start = r === startRow ? startCol : 0
        const end = r === endRow ? endCol : row.length
        result.push(
          row
            .slice(start, end)
            .map((c) => c.char || " ")
            .join(""),
        )
      }
      return result.join("\n")
    },
    getCell(row: number, col: number): Cell {
      return (
        grid[row]?.[col] ?? {
          char: " ",
          fg: null,
          bg: null,
          bold: false,
          dim: false,
          italic: false,
          underline: false as UnderlineStyle,
          underlineColor: null,
          blink: false,
          inverse: false,
          hidden: false,
          strikethrough: false,
          wide: false,
          continuation: false,
          hyperlink: null,
        }
      )
    },
    getLine(row: number): Cell[] {
      return grid[row] ?? []
    },
    getLines(): Cell[][] {
      return grid
    },
    getCursor(): CursorState {
      return cursorState
    },
    getMode(mode: TerminalMode): boolean {
      return modes[mode] ?? false
    },
    getTitle(): string {
      return title
    },
    getScrollback(): ScrollbackState {
      return scrollbackState
    },
  }
}

// =============================================================================
// Type Guards
// =============================================================================

describe("type guards", () => {
  test("isRegionView identifies valid RegionView", () => {
    const region = mockRegion(["Hello"])
    expect(isRegionView(region)).toBe(true)
  })

  test("isRegionView rejects primitives", () => {
    expect(isRegionView("string")).toBe(false)
    expect(isRegionView(null)).toBe(false)
    expect(isRegionView(42)).toBe(false)
  })

  test("isCellView identifies valid CellView", () => {
    const cell = mockCell({ bold: true })
    expect(isCellView(cell)).toBe(true)
  })

  test("isCellView rejects RegionView", () => {
    const region = mockRegion(["Hello"])
    expect(isCellView(region)).toBe(false)
  })

  test("isTerminalReadable identifies valid TerminalReadable", () => {
    const term = createMockTerminal()
    expect(isTerminalReadable(term)).toBe(true)
  })

  test("isTerminalReadable rejects RegionView", () => {
    const region = mockRegion(["Hello"])
    expect(isTerminalReadable(region)).toBe(false)
  })
})

// =============================================================================
// Type Assert Functions
// =============================================================================

describe("type assert functions", () => {
  test("assertRegionView throws helpful error for TerminalReadable", () => {
    const term = createMockTerminal()
    expect(() => assertRegionView(term, "toContainText")).toThrow(/region/i)
  })

  test("assertRegionView throws generic error for wrong type", () => {
    expect(() => assertRegionView("string", "toContainText")).toThrow(/RegionView/)
  })

  test("assertCellView throws helpful error for wrong type", () => {
    expect(() => assertCellView(null, "toBeBold")).toThrow(/CellView/)
  })

  test("assertTerminalReadable throws helpful error for wrong type", () => {
    expect(() => assertTerminalReadable("string", "toHaveCursorAt")).toThrow(/TerminalReadable/)
  })
})

// =============================================================================
// Region Assertions
// =============================================================================

describe("assertContainsText", () => {
  test("passes when text is present", () => {
    const region = mockRegion(["Hello World", "Second line"])
    const result = assertContainsText(region, "Hello")
    expect(result.pass).toBe(true)
  })

  test("fails when text is absent", () => {
    const region = mockRegion(["Hello World"])
    const result = assertContainsText(region, "Goodbye")
    expect(result.pass).toBe(false)
    expect(result.message).toContain("Goodbye")
    expect(result.message).toContain("Hello World")
  })

  test("matches across lines", () => {
    const region = mockRegion(["Hello", "World"])
    const result = assertContainsText(region, "Hello\nWorld")
    expect(result.pass).toBe(true)
  })
})

describe("assertHasText", () => {
  test("passes when text matches exactly (trimmed)", () => {
    const region = mockRegion(["Hello  "])
    const result = assertHasText(region, "Hello")
    expect(result.pass).toBe(true)
  })

  test("fails on substring match", () => {
    const region = mockRegion(["Hello World"])
    const result = assertHasText(region, "Hello")
    expect(result.pass).toBe(false)
    expect(result.message).toContain("Hello")
  })

  test("provides expected/actual on failure", () => {
    const region = mockRegion(["Hello World"])
    const result = assertHasText(region, "Goodbye")
    expect(result.expected).toBe("Goodbye")
    expect(result.actual).toBe("Hello World")
  })
})

describe("assertMatchesLines", () => {
  test("passes when lines match (trailing whitespace trimmed)", () => {
    const region = mockRegion(["Hello  ", "World  "])
    const result = assertMatchesLines(region, ["Hello", "World"])
    expect(result.pass).toBe(true)
  })

  test("fails when lines differ", () => {
    const region = mockRegion(["Hello", "World"])
    const result = assertMatchesLines(region, ["Hello", "Earth"])
    expect(result.pass).toBe(false)
    expect(result.message).toContain("Earth")
    expect(result.message).toContain("World")
  })

  test("handles empty lines", () => {
    const region = mockRegion(["Hello", "", "World"])
    const result = assertMatchesLines(region, ["Hello", "", "World"])
    expect(result.pass).toBe(true)
  })

  test("fails on different line count", () => {
    const region = mockRegion(["Hello"])
    const result = assertMatchesLines(region, ["Hello", "World"])
    expect(result.pass).toBe(false)
  })
})

// =============================================================================
// Cell Assertions
// =============================================================================

describe("assertIsBold", () => {
  test("passes for bold cell", () => {
    const result = assertIsBold(mockCell({ bold: true, char: "B", row: 1, col: 2 }))
    expect(result.pass).toBe(true)
    expect(result.message).toContain("not to be bold")
  })

  test("fails for non-bold cell", () => {
    const result = assertIsBold(mockCell({ bold: false }))
    expect(result.pass).toBe(false)
    expect(result.message).toContain("to be bold")
  })
})

describe("assertIsItalic", () => {
  test("passes for italic cell", () => {
    const result = assertIsItalic(mockCell({ italic: true }))
    expect(result.pass).toBe(true)
  })

  test("fails for non-italic cell", () => {
    const result = assertIsItalic(mockCell({ italic: false }))
    expect(result.pass).toBe(false)
  })
})

describe("assertIsFaint", () => {
  test("passes for faint cell", () => {
    const result = assertIsFaint(mockCell({ dim: true }))
    expect(result.pass).toBe(true)
  })

  test("fails for non-faint cell", () => {
    const result = assertIsFaint(mockCell({ dim: false }))
    expect(result.pass).toBe(false)
  })
})

describe("assertIsStrikethrough", () => {
  test("passes for strikethrough cell", () => {
    const result = assertIsStrikethrough(mockCell({ strikethrough: true }))
    expect(result.pass).toBe(true)
  })

  test("fails for non-strikethrough cell", () => {
    const result = assertIsStrikethrough(mockCell({ strikethrough: false }))
    expect(result.pass).toBe(false)
  })
})

describe("assertIsInverse", () => {
  test("passes for inverse cell", () => {
    const result = assertIsInverse(mockCell({ inverse: true }))
    expect(result.pass).toBe(true)
  })

  test("fails for non-inverse cell", () => {
    const result = assertIsInverse(mockCell({ inverse: false }))
    expect(result.pass).toBe(false)
  })
})

describe("assertIsWide", () => {
  test("passes for wide cell", () => {
    const result = assertIsWide(mockCell({ wide: true }))
    expect(result.pass).toBe(true)
  })

  test("fails for non-wide cell", () => {
    const result = assertIsWide(mockCell({ wide: false }))
    expect(result.pass).toBe(false)
  })
})

describe("assertHasUnderline", () => {
  test("passes when cell has any underline", () => {
    const result = assertHasUnderline(mockCell({ underline: "single" }))
    expect(result.pass).toBe(true)
  })

  test("fails when cell has no underline", () => {
    const result = assertHasUnderline(mockCell({ underline: false }))
    expect(result.pass).toBe(false)
  })

  test("passes with specific underline style", () => {
    const result = assertHasUnderline(mockCell({ underline: "curly" }), "curly")
    expect(result.pass).toBe(true)
  })

  test("fails when style does not match", () => {
    const result = assertHasUnderline(mockCell({ underline: "single" }), "double")
    expect(result.pass).toBe(false)
    expect(result.message).toContain("double")
    expect(result.message).toContain("single")
  })
})

describe("assertHasFg", () => {
  test("passes with matching hex color", () => {
    const result = assertHasFg(mockCell({ fg: { r: 255, g: 0, b: 0 } }), "#ff0000")
    expect(result.pass).toBe(true)
  })

  test("passes with matching RGB object", () => {
    const result = assertHasFg(mockCell({ fg: { r: 255, g: 0, b: 0 } }), { r: 255, g: 0, b: 0 })
    expect(result.pass).toBe(true)
  })

  test("fails with wrong color", () => {
    const result = assertHasFg(mockCell({ fg: { r: 255, g: 0, b: 0 } }), "#00ff00")
    expect(result.pass).toBe(false)
    expect(result.message).toContain("#00ff00")
    expect(result.message).toContain("#ff0000")
  })

  test("fails when fg is null", () => {
    const result = assertHasFg(mockCell({ fg: null }), "#ff0000")
    expect(result.pass).toBe(false)
    expect(result.message).toContain("null")
  })
})

describe("assertHasBg", () => {
  test("passes with matching hex color", () => {
    const result = assertHasBg(mockCell({ bg: { r: 0, g: 128, b: 255 } }), "#0080ff")
    expect(result.pass).toBe(true)
  })

  test("passes with matching RGB object", () => {
    const result = assertHasBg(mockCell({ bg: { r: 0, g: 0, b: 0 } }), { r: 0, g: 0, b: 0 })
    expect(result.pass).toBe(true)
  })

  test("fails with wrong color", () => {
    const result = assertHasBg(mockCell({ bg: { r: 0, g: 0, b: 0 } }), "#ffffff")
    expect(result.pass).toBe(false)
  })
})

// =============================================================================
// Terminal Assertions
// =============================================================================

describe("assertCursorAt", () => {
  test("passes at correct position", () => {
    const term = createMockTerminal({ cursor: { x: 5, y: 10 } })
    const result = assertCursorAt(term, 5, 10)
    expect(result.pass).toBe(true)
  })

  test("fails at wrong position", () => {
    const term = createMockTerminal({ cursor: { x: 5, y: 10 } })
    const result = assertCursorAt(term, 0, 0)
    expect(result.pass).toBe(false)
    expect(result.message).toContain("(5,10)")
    expect(result.message).toContain("(0,0)")
  })
})

describe("assertCursorStyle", () => {
  test("passes with matching style", () => {
    const term = createMockTerminal({ cursor: { style: "beam" } })
    const result = assertCursorStyle(term, "beam")
    expect(result.pass).toBe(true)
  })

  test("fails with wrong style", () => {
    const term = createMockTerminal({ cursor: { style: "block" } })
    const result = assertCursorStyle(term, "beam")
    expect(result.pass).toBe(false)
    expect(result.message).toContain("beam")
    expect(result.message).toContain("block")
  })
})

describe("assertCursorVisible", () => {
  test("passes when cursor is visible", () => {
    const term = createMockTerminal({ cursor: { visible: true } })
    const result = assertCursorVisible(term)
    expect(result.pass).toBe(true)
  })

  test("fails when cursor is hidden", () => {
    const term = createMockTerminal({ cursor: { visible: false } })
    const result = assertCursorVisible(term)
    expect(result.pass).toBe(false)
  })
})

describe("assertCursorHidden", () => {
  test("passes when cursor is hidden", () => {
    const term = createMockTerminal({ cursor: { visible: false } })
    const result = assertCursorHidden(term)
    expect(result.pass).toBe(true)
  })

  test("fails when cursor is visible", () => {
    const term = createMockTerminal({ cursor: { visible: true } })
    const result = assertCursorHidden(term)
    expect(result.pass).toBe(false)
  })
})

describe("assertInMode", () => {
  test("passes when mode is enabled", () => {
    const term = createMockTerminal({ modes: { altScreen: true } })
    const result = assertInMode(term, "altScreen")
    expect(result.pass).toBe(true)
  })

  test("fails when mode is disabled", () => {
    const term = createMockTerminal({ modes: {} })
    const result = assertInMode(term, "bracketedPaste")
    expect(result.pass).toBe(false)
    expect(result.message).toContain("bracketedPaste")
  })
})

describe("assertTitle", () => {
  test("passes with matching title", () => {
    const term = createMockTerminal({ title: "My Terminal" })
    const result = assertTitle(term, "My Terminal")
    expect(result.pass).toBe(true)
  })

  test("fails with wrong title", () => {
    const term = createMockTerminal({ title: "My Terminal" })
    const result = assertTitle(term, "Other")
    expect(result.pass).toBe(false)
    expect(result.message).toContain("Other")
    expect(result.message).toContain("My Terminal")
  })

  test("matches empty title", () => {
    const term = createMockTerminal({ title: "" })
    const result = assertTitle(term, "")
    expect(result.pass).toBe(true)
  })
})

describe("assertScrollbackLines", () => {
  test("passes with correct count", () => {
    const term = createMockTerminal({ scrollback: { totalLines: 100 } })
    const result = assertScrollbackLines(term, 100)
    expect(result.pass).toBe(true)
  })

  test("fails with wrong count", () => {
    const term = createMockTerminal({ scrollback: { totalLines: 50 } })
    const result = assertScrollbackLines(term, 100)
    expect(result.pass).toBe(false)
    expect(result.message).toContain("100")
    expect(result.message).toContain("50")
  })
})

describe("assertAtBottomOfScrollback", () => {
  test("passes when offset is 0", () => {
    const term = createMockTerminal({ scrollback: { viewportOffset: 0 } })
    const result = assertAtBottomOfScrollback(term)
    expect(result.pass).toBe(true)
  })

  test("fails when scrolled up", () => {
    const term = createMockTerminal({ scrollback: { viewportOffset: 10 } })
    const result = assertAtBottomOfScrollback(term)
    expect(result.pass).toBe(false)
    expect(result.message).toContain("10")
  })
})

// =============================================================================
// Message format: pass=true message is the "not" case
// =============================================================================

describe("message format contract", () => {
  test("pass=true message describes negation (for .not usage)", () => {
    const region = mockRegion(["Hello"])
    const result = assertContainsText(region, "Hello")
    expect(result.pass).toBe(true)
    expect(result.message).toContain("not to contain")
  })

  test("pass=false message describes what was expected", () => {
    const region = mockRegion(["Hello"])
    const result = assertContainsText(region, "Goodbye")
    expect(result.pass).toBe(false)
    expect(result.message).toContain("to contain")
    expect(result.message).not.toContain("not to contain")
  })
})
