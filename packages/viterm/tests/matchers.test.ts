/**
 * Tests for @termless/test custom Vitest matchers — composable view API.
 *
 * Matchers operate on views (RegionView, CellView, RowView) and
 * TerminalReadable, not flat (row, col) arguments. Tests use lightweight
 * mock factories — no real backend needed.
 */

import { describe, test, expect } from "vitest"
import "../src/matchers.ts" // Auto-register matchers
import type {
  TerminalReadable,
  Cell,
  CursorState,
  CursorStyle,
  TerminalMode,
  ScrollbackState,
  RGB,
  UnderlineStyle,
  RegionView,
  CellView,
  RowView,
} from "../../../src/types.ts"

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Assert a matcher fails. Works with both sync matchers (throws) and
 * async auto-retry matchers (returns rejected Promise).
 *
 * With auto-retry, matchers on retryable subjects (RegionView, TerminalReadable)
 * return a Promise on failure instead of throwing. Pass `{ timeout: 0 }` to
 * the matcher to avoid waiting for retry on static mocks.
 */
async function expectToFail(fn: () => unknown): Promise<void> {
  try {
    const result = fn()
    if (result && typeof (result as Record<string, unknown>).then === "function") {
      await (result as Promise<unknown>)
    }
    expect.unreachable("Expected assertion to fail")
  } catch (e) {
    if ((e as Error).message?.includes("expected to be unreachable")) throw e
    // Assertion error — expected
  }
}

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

function mockRow(text: string, row = 0): RowView {
  const cells: Cell[] = [...text].map((ch) => ({
    char: ch,
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
  }))
  return {
    row,
    cells,
    getText: () => text,
    getLines: () => [text],
    containsText: (t: string) => text.includes(t),
    cellAt: (col: number): CellView => mockCell({ char: text[col] ?? " ", row, col }),
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
// Text Matchers (RegionView / RowView)
// =============================================================================

describe("text matchers", () => {
  test("toContainText passes when text is present", () => {
    const region = mockRegion(["Hello World", "Second line"])
    expect(region).toContainText("Hello")
    expect(region).toContainText("World")
    expect(region).toContainText("Second")
  })

  test("toContainText fails when text is absent", async () => {
    const region = mockRegion(["Hello World"])
    await expectToFail(() => expect(region).toContainText("Goodbye", { timeout: 0 }))
  })

  test("toContainText with .not negation", () => {
    const region = mockRegion(["Hello World"])
    expect(region).not.toContainText("Goodbye")
  })

  test("toContainText .not fails when text IS present", async () => {
    const region = mockRegion(["Hello World"])
    await expectToFail(() => expect(region).not.toContainText("Hello", { timeout: 0 }))
  })

  test("toContainText works on RowView", () => {
    const row = mockRow("Hello World")
    expect(row).toContainText("Hello")
    expect(row).not.toContainText("Goodbye")
  })

  test("toHaveText matches trimmed text exactly", () => {
    const region = mockRegion(["Hello  "])
    expect(region).toHaveText("Hello")
  })

  test("toHaveText fails on substring match", async () => {
    const region = mockRegion(["Hello World"])
    await expectToFail(() => expect(region).toHaveText("Hello", { timeout: 0 }))
  })

  test("toHaveText with .not negation", () => {
    const region = mockRegion(["Hello World"])
    expect(region).not.toHaveText("Hello")
  })

  test("toHaveText works on RowView", () => {
    const row = mockRow("Hello World")
    expect(row).toHaveText("Hello World")
    expect(row).not.toHaveText("Hello")
  })

  test("toMatchLines matches line-by-line with trailing whitespace trimmed", () => {
    const region = mockRegion(["Hello  ", "World  "])
    expect(region).toMatchLines(["Hello", "World"])
  })

  test("toMatchLines fails when lines differ", async () => {
    const region = mockRegion(["Hello", "World"])
    await expectToFail(() => expect(region).toMatchLines(["Hello", "Earth"], { timeout: 0 }))
  })

  test("toMatchLines with .not negation", () => {
    const region = mockRegion(["Hello", "World"])
    expect(region).not.toMatchLines(["Goodbye", "World"])
  })

  test("toMatchLines handles empty lines", () => {
    const region = mockRegion(["Hello", "", "World"])
    expect(region).toMatchLines(["Hello", "", "World"])
  })
})

// =============================================================================
// Style Matchers (CellView)
// =============================================================================

describe("style matchers", () => {
  test("toBeBold passes when cell is bold", () => {
    const cell = mockCell({ bold: true })
    expect(cell).toBeBold()
  })

  test("toBeBold fails when cell is not bold", () => {
    const cell = mockCell({ bold: false })
    expect(() => expect(cell).toBeBold()).toThrow()
  })

  test("toBeBold .not works", () => {
    const cell = mockCell({ bold: false })
    expect(cell).not.toBeBold()
  })

  test("toBeItalic passes when cell is italic", () => {
    const cell = mockCell({ italic: true })
    expect(cell).toBeItalic()
  })

  test("toBeItalic fails when cell is not italic", () => {
    const cell = mockCell({ italic: false })
    expect(() => expect(cell).toBeItalic()).toThrow()
  })

  test("toBeDim passes when cell is dim", () => {
    const cell = mockCell({ dim: true })
    expect(cell).toBeDim()
  })

  test("toBeDim fails when cell is not dim", () => {
    const cell = mockCell({ dim: false })
    expect(() => expect(cell).toBeDim()).toThrow()
  })

  test("toBeStrikethrough passes when cell is strikethrough", () => {
    const cell = mockCell({ strikethrough: true })
    expect(cell).toBeStrikethrough()
  })

  test("toBeStrikethrough fails when cell is not strikethrough", () => {
    const cell = mockCell({ strikethrough: false })
    expect(() => expect(cell).toBeStrikethrough()).toThrow()
  })

  test("toBeInverse passes when cell is inverse", () => {
    const cell = mockCell({ inverse: true })
    expect(cell).toBeInverse()
  })

  test("toBeInverse fails when cell is not inverse", () => {
    const cell = mockCell({ inverse: false })
    expect(() => expect(cell).toBeInverse()).toThrow()
  })

  test("toBeWide passes when cell is wide", () => {
    const cell = mockCell({ wide: true })
    expect(cell).toBeWide()
  })

  test("toBeWide fails when cell is not wide", () => {
    const cell = mockCell({ wide: false })
    expect(() => expect(cell).toBeWide()).toThrow()
  })

  test("toHaveUnderline passes when cell has any underline", () => {
    const cell = mockCell({ underline: "single" })
    expect(cell).toHaveUnderline()
  })

  test("toHaveUnderline passes with specific style", () => {
    const cell = mockCell({ underline: "curly" })
    expect(cell).toHaveUnderline("curly")
  })

  test("toHaveUnderline fails when style does not match", () => {
    const cell = mockCell({ underline: "single" })
    expect(() => expect(cell).toHaveUnderline("double")).toThrow()
  })

  test("toHaveUnderline fails when not underlined", () => {
    const cell = mockCell({ underline: false })
    expect(() => expect(cell).toHaveUnderline()).toThrow()
  })

  test("toHaveFg with hex string", () => {
    const cell = mockCell({ fg: { r: 255, g: 0, b: 0 } })
    expect(cell).toHaveFg("#ff0000")
  })

  test("toHaveFg with RGB object", () => {
    const cell = mockCell({ fg: { r: 255, g: 0, b: 0 } })
    expect(cell).toHaveFg({ r: 255, g: 0, b: 0 })
  })

  test("toHaveFg fails with wrong color", () => {
    const cell = mockCell({ fg: { r: 255, g: 0, b: 0 } })
    expect(() => expect(cell).toHaveFg("#00ff00")).toThrow()
  })

  test("toHaveFg fails when fg is null", () => {
    const cell = mockCell({ fg: null })
    expect(() => expect(cell).toHaveFg("#ff0000")).toThrow()
  })

  test("toHaveBg with hex string", () => {
    const cell = mockCell({ bg: { r: 0, g: 128, b: 255 } })
    expect(cell).toHaveBg("#0080ff")
  })

  test("toHaveBg with RGB object", () => {
    const cell = mockCell({ bg: { r: 0, g: 0, b: 0 } })
    expect(cell).toHaveBg({ r: 0, g: 0, b: 0 })
  })
})

// =============================================================================
// Cursor Matchers (TerminalReadable)
// =============================================================================

describe("cursor matchers", () => {
  test("toHaveCursorAt verifies cursor position", () => {
    const term = createMockTerminal({ cursor: { x: 5, y: 10 } })
    expect(term).toHaveCursorAt(5, 10)
  })

  test("toHaveCursorAt fails with wrong position", async () => {
    const term = createMockTerminal({ cursor: { x: 5, y: 10 } })
    await expectToFail(() => expect(term).toHaveCursorAt(0, 0, { timeout: 0 }))
  })

  test("toHaveCursorVisible passes when cursor is visible", () => {
    const term = createMockTerminal({ cursor: { visible: true } })
    expect(term).toHaveCursorVisible()
  })

  test("toHaveCursorVisible fails when cursor is hidden", async () => {
    const term = createMockTerminal({ cursor: { visible: false } })
    await expectToFail(() => expect(term).toHaveCursorVisible({ timeout: 0 }))
  })

  test("toHaveCursorHidden passes when cursor is hidden", () => {
    const term = createMockTerminal({ cursor: { visible: false } })
    expect(term).toHaveCursorHidden()
  })

  test("toHaveCursorHidden fails when cursor is visible", async () => {
    const term = createMockTerminal({ cursor: { visible: true } })
    await expectToFail(() => expect(term).toHaveCursorHidden({ timeout: 0 }))
  })

  test("toHaveCursorStyle checks block style", () => {
    const term = createMockTerminal({ cursor: { style: "block" } })
    expect(term).toHaveCursorStyle("block")
  })

  test("toHaveCursorStyle checks underline style", () => {
    const term = createMockTerminal({ cursor: { style: "underline" } })
    expect(term).toHaveCursorStyle("underline")
  })

  test("toHaveCursorStyle checks beam style", () => {
    const term = createMockTerminal({ cursor: { style: "beam" } })
    expect(term).toHaveCursorStyle("beam")
  })

  test("toHaveCursorStyle fails with wrong style", async () => {
    const term = createMockTerminal({ cursor: { style: "block" } })
    await expectToFail(() => expect(term).toHaveCursorStyle("beam", { timeout: 0 }))
  })
})

// =============================================================================
// Terminal Mode Matchers (TerminalReadable)
// =============================================================================

describe("terminal mode matchers", () => {
  test("toBeInMode passes when altScreen is enabled", () => {
    const term = createMockTerminal({ modes: { altScreen: true } })
    expect(term).toBeInMode("altScreen")
  })

  test("toBeInMode fails when altScreen is disabled", async () => {
    const term = createMockTerminal({ modes: { altScreen: false } })
    await expectToFail(() => expect(term).toBeInMode("altScreen", { timeout: 0 }))
  })

  test("toBeInMode passes when bracketedPaste is enabled", () => {
    const term = createMockTerminal({ modes: { bracketedPaste: true } })
    expect(term).toBeInMode("bracketedPaste")
  })

  test("toBeInMode fails when bracketedPaste is disabled", async () => {
    const term = createMockTerminal({ modes: {} })
    await expectToFail(() => expect(term).toBeInMode("bracketedPaste", { timeout: 0 }))
  })

  test("toBeInMode passes when applicationCursor is enabled", () => {
    const term = createMockTerminal({ modes: { applicationCursor: true } })
    expect(term).toBeInMode("applicationCursor")
  })

  test("toBeInMode with .not negation", () => {
    const term = createMockTerminal({ modes: {} })
    expect(term).not.toBeInMode("mouseTracking")
  })

  test("toBeInMode .not fails when mode IS enabled", async () => {
    const term = createMockTerminal({ modes: { altScreen: true } })
    await expectToFail(() => expect(term).not.toBeInMode("altScreen", { timeout: 0 }))
  })
})

// =============================================================================
// Title Matcher (TerminalReadable)
// =============================================================================

describe("title matcher", () => {
  test("toHaveTitle passes with matching title", () => {
    const term = createMockTerminal({ title: "My Terminal" })
    expect(term).toHaveTitle("My Terminal")
  })

  test("toHaveTitle fails with wrong title", async () => {
    const term = createMockTerminal({ title: "My Terminal" })
    await expectToFail(() => expect(term).toHaveTitle("Other Terminal", { timeout: 0 }))
  })

  test("toHaveTitle matches empty title", () => {
    const term = createMockTerminal({ title: "" })
    expect(term).toHaveTitle("")
  })
})

// =============================================================================
// Scrollback Matchers (TerminalReadable)
// =============================================================================

describe("scrollback matchers", () => {
  test("toHaveScrollbackLines checks total line count", () => {
    const term = createMockTerminal({
      lines: ["a", "b", "c"],
      scrollback: { totalLines: 100 },
    })
    expect(term).toHaveScrollbackLines(100)
  })

  test("toHaveScrollbackLines fails with wrong count", async () => {
    const term = createMockTerminal({ scrollback: { totalLines: 50 } })
    await expectToFail(() => expect(term).toHaveScrollbackLines(100, { timeout: 0 }))
  })

  test("toBeAtBottomOfScrollback passes when offset is 0", () => {
    const term = createMockTerminal({ scrollback: { viewportOffset: 0 } })
    expect(term).toBeAtBottomOfScrollback()
  })

  test("toBeAtBottomOfScrollback fails when scrolled up", async () => {
    const term = createMockTerminal({ scrollback: { viewportOffset: 10 } })
    await expectToFail(() => expect(term).toBeAtBottomOfScrollback({ timeout: 0 }))
  })
})

// =============================================================================
// Snapshot Matchers (TerminalReadable)
// =============================================================================

describe("snapshot matchers", () => {
  test("toMatchTerminalSnapshot creates and matches snapshot", () => {
    const term = createMockTerminal({
      lines: ["Hello World", "Line 2"],
      cursor: { x: 5, y: 0, visible: true, style: "block" },
    })
    // Should not throw — matcher constructs snapshot from terminal state
    expect(term).toMatchTerminalSnapshot()
  })

  test("toMatchTerminalSnapshot with custom name", () => {
    const term = createMockTerminal({
      lines: ["Hello World", "Line 2"],
      cursor: { x: 5, y: 0, visible: true, style: "block" },
    })
    expect(term).toMatchTerminalSnapshot({ name: "my-snapshot" })
  })
})

// =============================================================================
// Error Handling — wrong type errors
// =============================================================================

describe("error handling", () => {
  test("text matcher on string gives generic error", () => {
    expect(() => expect("not a region").toContainText("foo")).toThrow()
  })

  test("text matcher on TerminalReadable gives helpful region error", () => {
    const term = createMockTerminal({ lines: ["Hello"] })
    expect(() => expect(term).toContainText("Hello")).toThrow(/region/i)
  })

  test("cell matcher on RegionView gives helpful cell error", () => {
    const region = mockRegion(["Hello"])
    expect(() => expect(region).toBeBold()).toThrow(/cell/i)
  })

  test("cell matcher on null gives generic error", () => {
    expect(() => expect(null).toBeBold()).toThrow()
  })
})
