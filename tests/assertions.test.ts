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
  assertIsDim,
  assertIsStrikethrough,
  assertIsInverse,
  assertIsWide,
  assertHasUnderline,
  assertHasFg,
  assertHasBg,
  assertHaveAttrs,
  assertCursorAt,
  assertCursorStyle,
  assertCursorVisible,
  assertCursorHidden,
  assertHaveCursor,
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
    strikethrough: false,
    inverse: false,
    blink: false,
    hidden: false,
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
        strikethrough: false,
        inverse: false,
        blink: false,
        hidden: false,
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
          strikethrough: false,
          inverse: false,
          blink: false,
          hidden: false,
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

describe("assertIsDim", () => {
  test("passes for dim cell", () => {
    const result = assertIsDim(mockCell({ dim: true }))
    expect(result.pass).toBe(true)
  })

  test("fails for non-dim cell", () => {
    const result = assertIsDim(mockCell({ dim: false }))
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
  test("counts only scrollback lines, not screen lines", () => {
    // 100 total lines, 24 screen lines → 76 scrollback lines
    const term = createMockTerminal({ scrollback: { totalLines: 100, screenLines: 24 } })
    const result = assertScrollbackLines(term, 76)
    expect(result.pass).toBe(true)
  })

  test("fails when expected count does not match scrollback-only lines", () => {
    // 100 total lines, 24 screen lines → 76 scrollback lines, not 100
    const term = createMockTerminal({ scrollback: { totalLines: 100, screenLines: 24 } })
    const result = assertScrollbackLines(term, 100)
    expect(result.pass).toBe(false)
    expect(result.message).toContain("100")
    expect(result.message).toContain("76")
  })

  test("returns 0 scrollback lines when totalLines equals screenLines", () => {
    const term = createMockTerminal({ scrollback: { totalLines: 24, screenLines: 24 } })
    const result = assertScrollbackLines(term, 0)
    expect(result.pass).toBe(true)
  })

  test("returns 0 scrollback lines when totalLines < screenLines", () => {
    // Edge case: fewer total lines than screen (e.g., terminal just started)
    const term = createMockTerminal({ scrollback: { totalLines: 10, screenLines: 24 } })
    const result = assertScrollbackLines(term, 0)
    expect(result.pass).toBe(true)
  })
})

describe("assertAtBottomOfScrollback", () => {
  test("passes when viewport is at bottom", () => {
    // With no scrollback, totalLines = screenLines, so bottom = 0
    const term = createMockTerminal({ scrollback: { viewportOffset: 0 } })
    const result = assertAtBottomOfScrollback(term)
    expect(result.pass).toBe(true)
  })

  test("passes when viewport is at bottom with scrollback", () => {
    // totalLines=30, screenLines=10, bottom = 20
    const term = createMockTerminal({
      scrollback: { viewportOffset: 20, totalLines: 30, screenLines: 10 },
    })
    const result = assertAtBottomOfScrollback(term)
    expect(result.pass).toBe(true)
  })

  test("fails when scrolled up from bottom", () => {
    // totalLines=30, screenLines=10, bottom = 20, but viewport is at 10 (scrolled up)
    const term = createMockTerminal({
      scrollback: { viewportOffset: 10, totalLines: 30, screenLines: 10 },
    })
    const result = assertAtBottomOfScrollback(term)
    expect(result.pass).toBe(false)
    expect(result.message).toContain("10")
  })
})

// =============================================================================
// Composable Cell Assertion: assertHaveAttrs
// =============================================================================

describe("assertHaveAttrs", () => {
  test("passes with single matching attr", () => {
    const result = assertHaveAttrs(mockCell({ bold: true }), { bold: true })
    expect(result.pass).toBe(true)
  })

  test("fails with single non-matching attr", () => {
    const result = assertHaveAttrs(mockCell({ bold: false }), { bold: true })
    expect(result.pass).toBe(false)
    expect(result.message).toContain("bold")
    expect(result.message).toContain("expected true")
    expect(result.message).toContain("got false")
  })

  test("passes with multiple matching attrs", () => {
    const result = assertHaveAttrs(mockCell({ bold: true, italic: true, fg: { r: 255, g: 0, b: 0 } }), {
      bold: true,
      italic: true,
      fg: "#ff0000",
    })
    expect(result.pass).toBe(true)
  })

  test("fails when one of multiple attrs mismatches", () => {
    const result = assertHaveAttrs(mockCell({ bold: true, italic: false }), { bold: true, italic: true })
    expect(result.pass).toBe(false)
    expect(result.message).toContain("bold")
    expect(result.message).toContain("matched")
    expect(result.message).toContain("italic")
    expect(result.message).toContain("expected true")
  })

  test("checks all boolean attrs", () => {
    const cell = mockCell({
      bold: true,
      italic: true,
      dim: true,
      strikethrough: true,
      inverse: true,
      wide: true,
    })
    const result = assertHaveAttrs(cell, {
      bold: true,
      italic: true,
      dim: true,
      strikethrough: true,
      inverse: true,
      wide: true,
    })
    expect(result.pass).toBe(true)
  })

  test("underline: true matches any underline style", () => {
    const result = assertHaveAttrs(mockCell({ underline: "curly" }), { underline: true })
    expect(result.pass).toBe(true)
  })

  test("underline: true fails when no underline", () => {
    const result = assertHaveAttrs(mockCell({ underline: false }), { underline: true })
    expect(result.pass).toBe(false)
  })

  test("underline: specific style matches exactly", () => {
    const result = assertHaveAttrs(mockCell({ underline: "double" }), { underline: "double" })
    expect(result.pass).toBe(true)
  })

  test("underline: specific style fails on different style", () => {
    const result = assertHaveAttrs(mockCell({ underline: "single" }), { underline: "curly" })
    expect(result.pass).toBe(false)
  })

  test("underline: false matches no underline", () => {
    const result = assertHaveAttrs(mockCell({ underline: false }), { underline: false })
    expect(result.pass).toBe(true)
  })

  test("fg with hex string", () => {
    const result = assertHaveAttrs(mockCell({ fg: { r: 255, g: 0, b: 0 } }), { fg: "#ff0000" })
    expect(result.pass).toBe(true)
  })

  test("fg with RGB object", () => {
    const result = assertHaveAttrs(mockCell({ fg: { r: 0, g: 255, b: 0 } }), { fg: { r: 0, g: 255, b: 0 } })
    expect(result.pass).toBe(true)
  })

  test("bg with hex string", () => {
    const result = assertHaveAttrs(mockCell({ bg: { r: 0, g: 0, b: 255 } }), { bg: "#0000ff" })
    expect(result.pass).toBe(true)
  })

  test("fg fails when null", () => {
    const result = assertHaveAttrs(mockCell({ fg: null }), { fg: "#ff0000" })
    expect(result.pass).toBe(false)
    expect(result.message).toContain("fg")
    expect(result.message).toContain("null")
  })

  test("only checks specified fields (partial matching)", () => {
    // Cell has bold=false, italic=false, etc. but we only check bold=false
    const result = assertHaveAttrs(mockCell(), { bold: false })
    expect(result.pass).toBe(true)
  })

  test("negation message for pass=true", () => {
    const result = assertHaveAttrs(mockCell({ bold: true }), { bold: true })
    expect(result.pass).toBe(true)
    expect(result.message).toContain("not to have attrs")
  })
})

// =============================================================================
// Composable Cursor Assertion: assertHaveCursor
// =============================================================================

describe("assertHaveCursor", () => {
  test("passes with matching position", () => {
    const term = createMockTerminal({ cursor: { x: 5, y: 10 } })
    const result = assertHaveCursor(term, { x: 5, y: 10 })
    expect(result.pass).toBe(true)
  })

  test("fails with wrong position", () => {
    const term = createMockTerminal({ cursor: { x: 5, y: 10 } })
    const result = assertHaveCursor(term, { x: 0, y: 0 })
    expect(result.pass).toBe(false)
    expect(result.message).toContain("x")
    expect(result.message).toContain("expected 0")
    expect(result.message).toContain("got 5")
  })

  test("passes with visible: true", () => {
    const term = createMockTerminal({ cursor: { visible: true } })
    const result = assertHaveCursor(term, { visible: true })
    expect(result.pass).toBe(true)
  })

  test("fails with visible mismatch", () => {
    const term = createMockTerminal({ cursor: { visible: false } })
    const result = assertHaveCursor(term, { visible: true })
    expect(result.pass).toBe(false)
    expect(result.message).toContain("visible")
  })

  test("passes with matching style", () => {
    const term = createMockTerminal({ cursor: { style: "beam" } })
    const result = assertHaveCursor(term, { style: "beam" })
    expect(result.pass).toBe(true)
  })

  test("fails with wrong style", () => {
    const term = createMockTerminal({ cursor: { style: "block" } })
    const result = assertHaveCursor(term, { style: "beam" })
    expect(result.pass).toBe(false)
    expect(result.message).toContain("style")
    expect(result.message).toContain("beam")
    expect(result.message).toContain("block")
  })

  test("passes with all properties matching", () => {
    const term = createMockTerminal({ cursor: { x: 3, y: 7, visible: true, style: "underline" } })
    const result = assertHaveCursor(term, { x: 3, y: 7, visible: true, style: "underline" })
    expect(result.pass).toBe(true)
  })

  test("fails when one of multiple properties mismatches", () => {
    const term = createMockTerminal({ cursor: { x: 3, y: 7, visible: true, style: "block" } })
    const result = assertHaveCursor(term, { x: 3, y: 7, visible: true, style: "beam" })
    expect(result.pass).toBe(false)
    expect(result.message).toContain("x")
    expect(result.message).toContain("matched")
    expect(result.message).toContain("style")
    expect(result.message).toContain("beam")
  })

  test("only checks specified fields (partial matching)", () => {
    const term = createMockTerminal({ cursor: { x: 99, y: 99 } })
    const result = assertHaveCursor(term, { visible: true })
    expect(result.pass).toBe(true)
  })

  test("handles null visible from backend", () => {
    // createMockTerminal uses ?? which coalesces null, so build a terminal with null visible directly
    const term = createMockTerminal()
    const origGetCursor = term.getCursor.bind(term)
    term.getCursor = () => ({ ...origGetCursor(), visible: null })
    const result = assertHaveCursor(term, { visible: true })
    expect(result.pass).toBe(false)
    expect(result.message).toContain("null")
  })

  test("handles null style from backend", () => {
    const term = createMockTerminal()
    const origGetCursor = term.getCursor.bind(term)
    term.getCursor = () => ({ ...origGetCursor(), style: null })
    const result = assertHaveCursor(term, { style: "block" })
    expect(result.pass).toBe(false)
    expect(result.message).toContain("null")
  })

  test("negation message for pass=true", () => {
    const term = createMockTerminal({ cursor: { x: 0, y: 0 } })
    const result = assertHaveCursor(term, { x: 0, y: 0 })
    expect(result.pass).toBe(true)
    expect(result.message).toContain("not to have cursor")
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
