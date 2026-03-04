/**
 * Tests for the SVG terminal snapshot serializer and toMatchSvgSnapshot matcher.
 *
 * Verifies that:
 * - The serializer identifies SVG snapshot markers correctly
 * - SVG output is valid and contains expected elements
 * - Custom themes are applied
 * - The toMatchSvgSnapshot matcher works with TerminalReadable
 */

import { describe, test, expect } from "vitest"
import { svgTerminalSerializer, svgTerminalSnapshot } from "../src/svg-serializer.ts"
import "../src/matchers.ts" // Auto-register matchers (includes toMatchSvgSnapshot)
import type { TerminalReadable, Cell, CursorState, ScrollbackState, TerminalMode } from "../../../src/types.ts"

// =============================================================================
// Mock Terminal
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
      row.push({ ...DEFAULT_CELL, text: line[col] ?? " " })
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
    getText: () => grid.map((r) => r.map((c) => c.text || " ").join("")).join("\n"),
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
// svgTerminalSerializer
// =============================================================================

describe("svgTerminalSerializer", () => {
  test("test() returns true for SVG snapshot markers", () => {
    const term = createMockTerminal({ lines: ["Hello"] })
    const marker = svgTerminalSnapshot(term)
    expect(svgTerminalSerializer.test(marker)).toBe(true)
  })

  test("test() returns false for plain objects", () => {
    expect(svgTerminalSerializer.test({})).toBe(false)
    expect(svgTerminalSerializer.test(null)).toBe(false)
    expect(svgTerminalSerializer.test("string")).toBe(false)
    expect(svgTerminalSerializer.test(42)).toBe(false)
  })

  test("test() returns false for object with wrong marker value", () => {
    expect(svgTerminalSerializer.test({ __svgTerminalSnapshot: false })).toBe(false)
  })

  test("test() returns false for text snapshot markers", () => {
    // Ensure SVG serializer does not match text snapshot markers
    expect(svgTerminalSerializer.test({ __terminalSnapshot: true })).toBe(false)
  })

  test("serialize() produces valid SVG", () => {
    const term = createMockTerminal({ lines: ["Hello"] })
    const marker = svgTerminalSnapshot(term)
    const svg = svgTerminalSerializer.serialize(marker)

    expect(svg).toContain("<svg")
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain("</svg>")
  })

  test("serialize() includes text content", () => {
    const term = createMockTerminal({ lines: ["Hello"] })
    const marker = svgTerminalSnapshot(term)
    const svg = svgTerminalSerializer.serialize(marker)

    expect(svg).toContain("Hello")
  })

  test("serialize() includes background rect", () => {
    const term = createMockTerminal({ lines: ["Hi"] })
    const marker = svgTerminalSnapshot(term)
    const svg = svgTerminalSerializer.serialize(marker)

    // The default theme background fill
    expect(svg).toContain('fill="#1e1e1e"')
  })

  test("serialize() includes cursor when visible", () => {
    const term = createMockTerminal({
      lines: ["Test"],
      cursor: { x: 2, y: 0, visible: true, style: "block" },
    })
    const marker = svgTerminalSnapshot(term)
    const svg = svgTerminalSerializer.serialize(marker)

    // Block cursor renders as a rect with opacity
    expect(svg).toContain('opacity="0.5"')
  })

  test("serialize() omits cursor when hidden", () => {
    const term = createMockTerminal({
      lines: ["Test"],
      cursor: { visible: false },
    })
    const marker = svgTerminalSnapshot(term)
    const svg = svgTerminalSerializer.serialize(marker)

    // Count rects: background + no cursor = just the background rect
    const rects = svg.match(/<rect /g) ?? []
    // Should have exactly 1 rect (the background)
    expect(rects.length).toBe(1)
  })

  test("serialize() prepends name as XML comment when provided", () => {
    const term = createMockTerminal({ lines: ["Test"] })
    const marker = svgTerminalSnapshot(term, { name: "after-edit" })
    const svg = svgTerminalSerializer.serialize(marker)

    expect(svg).toContain("<!-- after-edit -->")
    expect(svg.startsWith("<!-- after-edit -->")).toBe(true)
  })

  test("serialize() does not include comment when no name", () => {
    const term = createMockTerminal({ lines: ["Test"] })
    const marker = svgTerminalSnapshot(term)
    const svg = svgTerminalSerializer.serialize(marker)

    expect(svg).not.toContain("<!--")
  })
})

// =============================================================================
// svgTerminalSnapshot
// =============================================================================

describe("svgTerminalSnapshot", () => {
  test("creates a valid marker object", () => {
    const term = createMockTerminal({ lines: ["Hello"] })
    const marker = svgTerminalSnapshot(term)

    expect(marker.__svgTerminalSnapshot).toBe(true)
    expect(marker.terminal).toBe(term)
  })

  test("includes optional name", () => {
    const term = createMockTerminal({ lines: ["Hello"] })
    const marker = svgTerminalSnapshot(term, { name: "step-1" })

    expect(marker.name).toBe("step-1")
  })

  test("includes SVG options when provided", () => {
    const term = createMockTerminal({ lines: ["Hello"] })
    const marker = svgTerminalSnapshot(term, {
      theme: { foreground: "#ffffff", background: "#000000" },
    })

    expect(marker.options).toBeDefined()
    expect(marker.options?.theme?.foreground).toBe("#ffffff")
    expect(marker.options?.theme?.background).toBe("#000000")
  })

  test("omits options when only name is provided", () => {
    const term = createMockTerminal({ lines: ["Hello"] })
    const marker = svgTerminalSnapshot(term, { name: "just-name" })

    expect(marker.name).toBe("just-name")
    expect(marker.options).toBeUndefined()
  })
})

// =============================================================================
// Custom themes
// =============================================================================

describe("custom themes", () => {
  test("custom theme colors appear in SVG output", () => {
    const term = createMockTerminal({ lines: ["Hello"] })
    const marker = svgTerminalSnapshot(term, {
      theme: { foreground: "#00ff00", background: "#000033" },
    })
    const svg = svgTerminalSerializer.serialize(marker)

    expect(svg).toContain('fill="#000033"')
    expect(svg).toContain('fill="#00ff00"')
  })

  test("custom cursor color appears for visible cursor", () => {
    const term = createMockTerminal({
      lines: ["Hi"],
      cursor: { x: 0, y: 0, visible: true, style: "block" },
    })
    const marker = svgTerminalSnapshot(term, {
      theme: { cursor: "#ff0000" },
    })
    const svg = svgTerminalSerializer.serialize(marker)

    expect(svg).toContain('fill="#ff0000"')
  })
})

// =============================================================================
// Styled cells in SVG
// =============================================================================

describe("styled cells", () => {
  test("bold cells get font-weight in SVG", () => {
    const cells = new Map([["0,0", { bold: true }]])
    const term = createMockTerminal({ lines: ["B"], cells })
    const marker = svgTerminalSnapshot(term)
    const svg = svgTerminalSerializer.serialize(marker)

    expect(svg).toContain('font-weight="bold"')
  })

  test("italic cells get font-style in SVG", () => {
    const cells = new Map([["0,0", { italic: true }]])
    const term = createMockTerminal({ lines: ["I"], cells })
    const marker = svgTerminalSnapshot(term)
    const svg = svgTerminalSerializer.serialize(marker)

    expect(svg).toContain('font-style="italic"')
  })

  test("cells with custom fg color get fill attribute", () => {
    const cells = new Map([["0,0", { fg: { r: 255, g: 0, b: 0 } }]])
    const term = createMockTerminal({ lines: ["R"], cells })
    const marker = svgTerminalSnapshot(term)
    const svg = svgTerminalSerializer.serialize(marker)

    expect(svg).toContain('fill="#ff0000"')
  })

  test("cells with custom bg color get background rect", () => {
    const cells = new Map([["0,0", { bg: { r: 0, g: 0, b: 255 } }]])
    const term = createMockTerminal({ lines: ["B"], cells })
    const marker = svgTerminalSnapshot(term)
    const svg = svgTerminalSerializer.serialize(marker)

    expect(svg).toContain('fill="#0000ff"')
  })
})

// =============================================================================
// toMatchSvgSnapshot matcher
// =============================================================================

describe("toMatchSvgSnapshot matcher", () => {
  test("produces SVG output from TerminalReadable", () => {
    const term = createMockTerminal({ lines: ["Hello", "World"] })
    // The matcher integrates with vitest snapshot — just verify it doesn't throw
    expect(() => expect(term).toMatchSvgSnapshot()).not.toThrow()
  })

  test("accepts name option", () => {
    const term = createMockTerminal({ lines: ["Test"] })
    expect(() => expect(term).toMatchSvgSnapshot({ name: "basic" })).not.toThrow()
  })

  test("accepts theme option", () => {
    const term = createMockTerminal({ lines: ["Test"] })
    expect(() =>
      expect(term).toMatchSvgSnapshot({
        theme: { foreground: "#ffffff", background: "#000000" },
      }),
    ).not.toThrow()
  })

  test("rejects non-TerminalReadable values", () => {
    expect(() => expect("not a terminal").toMatchSvgSnapshot()).toThrow(/TerminalReadable/)
  })

  test("rejects null", () => {
    expect(() => expect(null).toMatchSvgSnapshot()).toThrow()
  })
})
