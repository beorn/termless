/**
 * Integration tests: wire Terminal + XtermBackend + SVG + Viterm matchers together.
 * These verify the full stack works end-to-end.
 */
import { describe, test, expect } from "vitest"
import { createTerminal } from "../src/terminal.ts"
import { screenshotSvg } from "../src/svg.ts"
import { createXtermBackend } from "../packages/xtermjs/src/backend.ts"
import "../packages/viterm/src/matchers.ts"
import { terminalSnapshot, terminalSerializer } from "../packages/viterm/src/serializer.ts"

expect.addSnapshotSerializer(terminalSerializer)

// Helper: create a terminal with xterm backend
function createXterm(cols = 80, rows = 24) {
  return createTerminal({ backend: createXtermBackend(), cols, rows })
}

describe("Terminal + XtermBackend integration", () => {
  test("feed plain text and read back", () => {
    const term = createXterm()
    term.feed("Hello, termless!")
    expect(term.getText()).toContain("Hello, termless!")
    term.close()
  })

  test("feed ANSI colored text and verify cell colors", () => {
    const term = createXterm()
    // Red foreground: ESC[31m
    term.feed("\x1b[31mRed text\x1b[0m")
    const cell = term.getCell(0, 0)
    expect(cell.text).toBe("R")
    expect(cell.fg).not.toBeNull()
    // ANSI color 1 (red) — exact RGB depends on palette
    expect(cell.fg!.r).toBeGreaterThan(100)
    term.close()
  })

  test("feed bold text and verify attribute", () => {
    const term = createXterm()
    term.feed("\x1b[1mBold\x1b[0m Normal")
    expect(term.getCell(0, 0).bold).toBe(true)
    expect(term.getCell(0, 5).bold).toBe(false)
    term.close()
  })

  test("cursor position tracks after text", () => {
    const term = createXterm()
    term.feed("Hello")
    const cursor = term.getCursor()
    expect(cursor.x).toBe(5)
    expect(cursor.y).toBe(0)
    term.close()
  })

  test("resize changes dimensions", () => {
    const term = createXterm(80, 24)
    expect(term.cols).toBe(80)
    expect(term.rows).toBe(24)
    term.resize(120, 40)
    expect(term.cols).toBe(120)
    expect(term.rows).toBe(40)
    term.close()
  })

  test("find() locates text in terminal", () => {
    const term = createXterm()
    term.feed("Line 1\r\nLine 2\r\nTarget text here")
    const pos = term.find("Target")
    expect(pos).not.toBeNull()
    expect(pos!.row).toBe(2)
    expect(pos!.col).toBe(0)
    term.close()
  })

  test("findAll() with regex", () => {
    const term = createXterm()
    term.feed("apple banana apple cherry apple")
    const matches = term.findAll(/apple/g)
    expect(matches.length).toBe(3)
    term.close()
  })

  test("alt screen mode detection", () => {
    const term = createXterm()
    expect(term.getMode("altScreen")).toBe(false)
    term.feed("\x1b[?1049h") // Enter alt screen
    expect(term.getMode("altScreen")).toBe(true)
    term.feed("\x1b[?1049l") // Exit alt screen
    expect(term.getMode("altScreen")).toBe(false)
    term.close()
  })

  test("title change via OSC 2", () => {
    const term = createXterm()
    term.feed("\x1b]2;My Terminal Title\x07")
    expect(term.getTitle()).toBe("My Terminal Title")
    term.close()
  })
})

describe("Terminal + Viterm matchers integration", () => {
  test("toContainText works with screen region", () => {
    const term = createXterm()
    term.feed("Hello World")
    expect(term.screen).toContainText("Hello World")
    expect(term.screen).not.toContainText("Goodbye")
    term.close()
  })

  test("toHaveText works with row", () => {
    const term = createXterm()
    term.feed("ABCDE")
    expect(term.row(0)).toContainText("ABCDE")
    term.close()
  })

  test("toBeBold works with cell", () => {
    const term = createXterm()
    term.feed("\x1b[1mBold\x1b[0m")
    expect(term.cell(0, 0)).toBeBold()
    term.close()
  })

  test("toHaveFg works with cell", () => {
    const term = createXterm()
    // Truecolor: ESC[38;2;255;0;0m
    term.feed("\x1b[38;2;255;0;0mRed\x1b[0m")
    expect(term.cell(0, 0)).toHaveFg("#ff0000")
    term.close()
  })

  test("toHaveCursorAt works with terminal", () => {
    const term = createXterm()
    term.feed("Hi")
    expect(term).toHaveCursorAt(2, 0)
    term.close()
  })

  test("toBeInMode works with terminal", () => {
    const term = createXterm()
    expect(term).not.toBeInMode("altScreen")
    term.feed("\x1b[?1049h")
    expect(term).toBeInMode("altScreen")
    term.close()
  })

  test("toHaveTitle works with terminal", () => {
    const term = createXterm()
    term.feed("\x1b]2;Test Title\x07")
    expect(term).toHaveTitle("Test Title")
    term.close()
  })

  test("toContainText works with row region", () => {
    const term = createXterm()
    term.feed("Line 0\r\nLine 1\r\nLine 2")
    expect(term.row(1)).toContainText("Line 1")
    expect(term.row(0)).not.toContainText("Line 1")
    term.close()
  })

  test("toHaveText works for empty row", () => {
    const term = createXterm()
    term.feed("Content")
    expect(term.row(5)).toHaveText("") // Row 5 should be empty
    term.close()
  })
})

describe("SVG screenshot integration", () => {
  test("generates valid SVG from xterm backend terminal", () => {
    const term = createXterm(40, 10)
    term.feed("Hello SVG!")
    const svg = term.screenshotSvg()
    expect(svg).toContain("<svg")
    expect(svg).toContain("</svg>")
    expect(svg).toContain("Hello SVG!")
    term.close()
  })

  test("SVG captures colored text", () => {
    const term = createXterm(40, 10)
    term.feed("\x1b[38;2;255;85;85mRed text\x1b[0m")
    const svg = term.screenshotSvg()
    expect(svg).toContain("#ff5555")
    expect(svg).toContain("Red text")
    term.close()
  })

  test("SVG captures bold text", () => {
    const term = createXterm(40, 10)
    term.feed("\x1b[1mBold\x1b[0m")
    const svg = term.screenshotSvg()
    expect(svg).toContain('font-weight="bold"')
    expect(svg).toContain("Bold")
    term.close()
  })

  test("SVG respects custom theme", () => {
    const term = createXterm(40, 10)
    term.feed("Themed")
    const svg = term.screenshotSvg({
      theme: { background: "#282a36", foreground: "#f8f8f2" },
    })
    expect(svg).toContain("#282a36")
    term.close()
  })

  test("screenshotSvg standalone function works with terminal", () => {
    const term = createXterm(40, 10)
    term.feed("Direct call")
    const svg = screenshotSvg(term)
    expect(svg).toContain("Direct call")
    term.close()
  })
})

describe("Snapshot serializer integration", () => {
  test("terminal snapshot renders with real backend", () => {
    const term = createXterm(40, 5)
    term.feed("\x1b[1mTitle\x1b[0m\r\nContent line")

    const snapshot = terminalSnapshot(term)
    const serialized = terminalSerializer.serialize(snapshot)

    expect(serialized).toContain("terminal 40x5")
    expect(serialized).toContain("Title")
    expect(serialized).toContain("Content line")
    term.close()
  })
})

describe("Cross-backend test structure", () => {
  test("same assertions work regardless of backend creation method", () => {
    // This test demonstrates the pattern: write test logic once,
    // vary backend via setup files
    const backends = [
      { name: "xterm", create: () => createXtermBackend() },
      // When ghostty is ready: { name: "ghostty", create: () => createGhosttyBackend() }
    ]

    for (const { name, create } of backends) {
      const term = createTerminal({ backend: create(), cols: 80, rows: 24 })
      term.feed("Cross-backend test")
      expect(term.screen).toContainText("Cross-backend test")
      expect(term.getCursor().x).toBe(18) // "Cross-backend test" is 18 chars
      term.close()
    }
  })
})

describe("Region selectors with real backend", () => {
  test("screen vs buffer vs scrollback regions", () => {
    const term = createXterm(40, 4)

    // Feed more lines than the terminal can hold to create scrollback
    for (let i = 0; i < 10; i++) {
      term.feed(`Line ${i}\r\n`)
    }

    // Buffer should contain all lines
    expect(term.buffer).toContainText("Line 0")
    expect(term.buffer).toContainText("Line 9")

    // Screen should only show the bottom rows
    expect(term.screen).toContainText("Line 9")

    // Scrollback should have early lines
    expect(term.scrollback).toContainText("Line 0")

    term.close()
  })

  test("cell style assertions with real xterm backend", () => {
    const term = createXterm()
    term.feed("\x1b[1;38;2;255;0;0mStyled\x1b[0m")

    const cell = term.cell(0, 0)
    expect(cell).toBeBold()
    expect(cell).toHaveFg("#ff0000")
    expect(cell.text).toBe("S")

    term.close()
  })

  test("row view with cellAt()", () => {
    const term = createXterm()
    term.feed("\x1b[1mBold\x1b[0m Normal")

    const row = term.row(0)
    expect(row).toContainText("Bold")
    expect(row.cellAt(0)).toBeBold()
    expect(row.cellAt(5)).not.toBeBold()

    term.close()
  })

  test("toMatchLines with screen region", () => {
    const term = createXterm(20, 3)
    term.feed("Alpha\r\nBeta\r\nGamma")

    expect(term.screen).toMatchLines(["Alpha", "Beta", "Gamma"])

    term.close()
  })
})
