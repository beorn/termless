import { describe, test, expect } from "vitest"
import { screenshotSvg, rgbToHex, rgbToString } from "../src/svg.ts"
import type {
  TerminalReadable,
  Cell,
  CursorState,
  CursorStyle,
  TerminalMode,
  ScrollbackState,
  UnderlineStyle,
} from "../src/types.ts"

// ── Helpers ──

function defaultCell(char = " "): Cell {
  return {
    char,
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
}

interface MockOptions {
  cursor?: Partial<CursorState>
  cellOverrides?: Record<string, Partial<Cell>> // "row,col" -> overrides
}

/** Create a mock TerminalReadable from lines of text. */
function createMockReadable(lines: string[], opts?: MockOptions): TerminalReadable {
  const cursorDefaults: CursorState = {
    x: 0,
    y: 0,
    visible: false,
    style: "block" as CursorStyle,
  }
  const cursor: CursorState = { ...cursorDefaults, ...opts?.cursor }
  const overrides = opts?.cellOverrides ?? {}

  const cellLines: Cell[][] = lines.map((line, row) => {
    const cells: Cell[] = []
    for (let col = 0; col < line.length; col++) {
      const cell = defaultCell(line[col])
      const key = `${row},${col}`
      if (overrides[key]) {
        Object.assign(cell, overrides[key])
      }
      cells.push(cell)
    }
    return cells
  })

  return {
    getText: () => lines.join("\n"),
    getTextRange: (sr, sc, er, ec) => {
      const result: string[] = []
      for (let r = sr; r <= er && r < lines.length; r++) {
        const start = r === sr ? sc : 0
        const end = r === er ? ec : lines[r]!.length
        result.push(lines[r]!.slice(start, end))
      }
      return result.join("\n")
    },
    getCell: (row, col): Cell => {
      if (row < cellLines.length && col < cellLines[row]!.length) {
        return cellLines[row]![col]!
      }
      return defaultCell()
    },
    getLine: (row): Cell[] => (row < cellLines.length ? cellLines[row]! : []),
    getLines: () => cellLines,
    getCursor: () => cursor,
    getMode: (_mode: TerminalMode) => false,
    getTitle: () => "",
    getScrollback: (): ScrollbackState => ({
      viewportOffset: 0,
      totalLines: lines.length,
      screenLines: lines.length,
    }),
  }
}

// ── Color helper tests ──

describe("rgbToHex", () => {
  test("converts RGB to hex string", () => {
    expect(rgbToHex({ r: 255, g: 0, b: 0 })).toBe("#ff0000")
    expect(rgbToHex({ r: 0, g: 255, b: 0 })).toBe("#00ff00")
    expect(rgbToHex({ r: 0, g: 0, b: 255 })).toBe("#0000ff")
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe("#000000")
    expect(rgbToHex({ r: 212, g: 212, b: 212 })).toBe("#d4d4d4")
  })
})

describe("rgbToString", () => {
  test("returns hex for non-null color", () => {
    expect(rgbToString({ r: 255, g: 0, b: 0 }, "#fallback")).toBe("#ff0000")
  })

  test("returns fallback for null", () => {
    expect(rgbToString(null, "#fallback")).toBe("#fallback")
  })
})

// ── SVG renderer tests ──

describe("screenshotSvg", () => {
  test("empty terminal renders valid SVG with background rect", () => {
    const term = createMockReadable([])
    const svg = screenshotSvg(term)
    expect(svg).toContain("<svg")
    expect(svg).toContain("xmlns=")
    expect(svg).toContain(`fill="#1e1e1e"`)
    expect(svg).toContain("</svg>")
  })

  test("single line of text appears in SVG output", () => {
    const term = createMockReadable(["Hello"])
    const svg = screenshotSvg(term)
    expect(svg).toContain("Hello")
    expect(svg).toContain("<text")
    expect(svg).toContain("<tspan")
  })

  test("text with < and & characters is properly escaped", () => {
    const term = createMockReadable(["a<b&c"])
    const svg = screenshotSvg(term)
    expect(svg).toContain("a&lt;b&amp;c")
    expect(svg).not.toContain("<b&c")
  })

  test("bold cell gets font-weight bold attribute", () => {
    const term = createMockReadable(["ab"], {
      cellOverrides: { "0,0": { bold: true } },
    })
    const svg = screenshotSvg(term)
    expect(svg).toContain(`font-weight="bold"`)
  })

  test("italic cell gets font-style italic attribute", () => {
    const term = createMockReadable(["ab"], {
      cellOverrides: { "0,0": { italic: true } },
    })
    const svg = screenshotSvg(term)
    expect(svg).toContain(`font-style="italic"`)
  })

  test("cell with fg color gets correct fill attribute", () => {
    const term = createMockReadable(["ab"], {
      cellOverrides: { "0,0": { fg: { r: 255, g: 0, b: 0 } } },
    })
    const svg = screenshotSvg(term)
    expect(svg).toContain(`fill="#ff0000"`)
  })

  test("cell with bg color generates background rect", () => {
    const term = createMockReadable(["ab"], {
      cellOverrides: { "0,0": { bg: { r: 0, g: 128, b: 0 } } },
    })
    const svg = screenshotSvg(term)
    // Should have a rect with the bg color (besides the full-background rect)
    const bgRectPattern = /rect.*fill="#008000"/
    expect(svg).toMatch(bgRectPattern)
  })

  test("adjacent cells with same bg color merge into single rect", () => {
    const greenBg = { bg: { r: 0, g: 128, b: 0 } }
    const term = createMockReadable(["abcd"], {
      cellOverrides: {
        "0,0": greenBg,
        "0,1": greenBg,
        "0,2": greenBg,
      },
    })
    const svg = screenshotSvg(term)
    // Should have exactly one rect with green bg (merged), not three
    const greenRects = svg.match(/#008000/g) ?? []
    expect(greenRects.length).toBe(1)
  })

  test("cursor visible at position renders cursor rect", () => {
    const term = createMockReadable(["Hello"], {
      cursor: { x: 2, y: 0, visible: true, style: "block" },
    })
    const svg = screenshotSvg(term)
    // Block cursor: rect at cursor position with cursor color and opacity
    expect(svg).toContain(`fill="#aeafad"`)
    expect(svg).toContain(`opacity="0.5"`)
  })

  test("cursor hidden renders no cursor rect", () => {
    const term = createMockReadable(["Hello"], {
      cursor: { x: 2, y: 0, visible: false, style: "block" },
    })
    const svg = screenshotSvg(term)
    // No cursor-colored rect
    expect(svg).not.toContain(`fill="#aeafad"`)
  })

  test("custom theme colors are applied", () => {
    const term = createMockReadable(["Hi"])
    const svg = screenshotSvg(term, {
      theme: {
        foreground: "#ffffff",
        background: "#000000",
      },
    })
    expect(svg).toContain(`fill="#000000"`) // background rect
    expect(svg).toContain(`fill="#ffffff"`) // text fill
  })

  test("custom font family is applied", () => {
    const term = createMockReadable(["Hi"])
    const svg = screenshotSvg(term, { fontFamily: "Fira Code" })
    expect(svg).toContain(`font-family="Fira Code"`)
  })

  test("dim cell gets opacity 0.5", () => {
    const term = createMockReadable(["ab"], {
      cellOverrides: { "0,0": { dim: true } },
    })
    const svg = screenshotSvg(term)
    expect(svg).toContain(`opacity="0.5"`)
  })

  test("inverse cell swaps fg and bg", () => {
    const term = createMockReadable(["a"], {
      cellOverrides: {
        "0,0": {
          fg: { r: 255, g: 0, b: 0 },
          bg: { r: 0, g: 0, b: 255 },
          inverse: true,
        },
      },
    })
    const svg = screenshotSvg(term)
    // After inversion: fg becomes blue (#0000ff), bg becomes red (#ff0000)
    // Text fill should be blue
    expect(svg).toContain(`fill="#0000ff"`)
    // Background rect should be red
    expect(svg).toContain(`fill="#ff0000"`)
  })

  test("SVG dimensions match cols*cellWidth x rows*cellHeight", () => {
    const term = createMockReadable(["abcde", "fghij"])
    const svg = screenshotSvg(term)
    // 5 cols * 9.6 = 48, 2 rows * 20 = 40
    expect(svg).toContain(`width="48"`)
    expect(svg).toContain(`height="40"`)
  })

  test("underline cell gets text-decoration underline", () => {
    const term = createMockReadable(["ab"], {
      cellOverrides: { "0,0": { underline: "single" } },
    })
    const svg = screenshotSvg(term)
    expect(svg).toContain(`text-decoration="underline"`)
  })

  test("strikethrough cell gets text-decoration line-through", () => {
    const term = createMockReadable(["ab"], {
      cellOverrides: { "0,0": { strikethrough: true } },
    })
    const svg = screenshotSvg(term)
    expect(svg).toContain(`text-decoration="line-through"`)
  })

  test("underline + strikethrough combines decorations", () => {
    const term = createMockReadable(["ab"], {
      cellOverrides: { "0,0": { underline: "single", strikethrough: true } },
    })
    const svg = screenshotSvg(term)
    expect(svg).toContain(`text-decoration="underline line-through"`)
  })

  test("beam cursor renders thin vertical rect", () => {
    const term = createMockReadable(["Hello"], {
      cursor: { x: 1, y: 0, visible: true, style: "beam" },
    })
    const svg = screenshotSvg(term)
    // Beam: width=2, full height
    expect(svg).toContain(`width="2"`)
    expect(svg).toContain(`height="20"`)
    expect(svg).toContain(`fill="#aeafad"`)
  })

  test("underline cursor renders thin horizontal rect at bottom", () => {
    const term = createMockReadable(["Hello"], {
      cursor: { x: 1, y: 0, visible: true, style: "underline" },
    })
    const svg = screenshotSvg(term)
    // Underline: height=2 at bottom of cell (y = 0*20 + 20 - 2 = 18)
    expect(svg).toContain(`y="18"`)
    expect(svg).toContain(`height="2"`)
    expect(svg).toContain(`fill="#aeafad"`)
  })

  test("wide (double-width) character renders in SVG", () => {
    // Wide char occupies two columns; the second cell is a continuation (empty text)
    // Use a CJK character that is a single JS char (U+4E16 = 世)
    const term = createMockReadable(["世x"], {
      cellOverrides: { "0,0": { wide: true }, "0,1": { char: "" } },
    })
    const svg = screenshotSvg(term)
    // The wide char should appear; the continuation cell (col 1) should be skipped
    expect(svg).toContain("世")
    expect(svg).toContain("<tspan")

    // Verify continuation cell is properly handled:
    // The continuation cell (col 1, empty text) should be skipped, so
    // the output contains "世x" (or merged span), not "世 x" with a space
    // from the continuation cell. "x" starts at col 2 position (wide char = 2 cols).
    expect(svg).toContain("x")
    // The continuation cell should NOT produce a visible character —
    // verify no extra space between 世 and x by checking the merged text
    const tspanMatches = svg.match(/<tspan[^>]*>([^<]+)<\/tspan>/g) ?? []
    const allText = tspanMatches.map((m) => m.replace(/<[^>]+>/g, "")).join("")
    expect(allText).not.toContain("世 x") // no space from continuation cell
  })

  test("whitespace-only lines render valid SVG", () => {
    const term = createMockReadable(["     "])
    const svg = screenshotSvg(term)
    expect(svg).toContain("<svg")
    expect(svg).toContain("xmlns=")
    expect(svg).toContain("</svg>")
    // Whitespace-only line still gets a text element
    expect(svg).toContain("<text")
  })

  test("curly, dotted, and dashed underline styles all render as text-decoration underline", () => {
    // svg.ts treats all non-false underline values identically as underline=true
    for (const style of ["curly", "dotted", "dashed"] as UnderlineStyle[]) {
      const term = createMockReadable(["ab"], {
        cellOverrides: { "0,0": { underline: style } },
      })
      const svg = screenshotSvg(term)
      expect(svg).toContain(`text-decoration="underline"`)
    }
  })

  // ── Visual polish ──

  test("padding increases SVG dimensions and offsets content", () => {
    const term = createMockReadable(["ab"])
    const svg = screenshotSvg(term, { padding: 16 })
    // 2 cols * 9.6 = 19.2 content + 32 padding = 51.2 width
    // 1 row * 20 = 20 content + 32 padding = 52 height
    expect(svg).toContain(`width="51.2"`)
    expect(svg).toContain(`height="52"`)
    // Content should be translated by padding
    expect(svg).toContain(`translate(16, 16)`)
  })

  test("borderRadius adds rx/ry to background rect and clipPath", () => {
    const term = createMockReadable(["Hi"])
    const svg = screenshotSvg(term, { borderRadius: 8 })
    expect(svg).toContain(`rx="8"`)
    expect(svg).toContain(`ry="8"`)
    expect(svg).toContain(`<clipPath id="terminal-clip">`)
    expect(svg).toContain(`clip-path="url(#terminal-clip)"`)
  })

  test("windowBar colorful renders three filled circles", () => {
    const term = createMockReadable(["Hi"])
    const svg = screenshotSvg(term, { windowBar: "colorful" })
    expect(svg).toContain(`fill="#ff5f57"`)
    expect(svg).toContain(`fill="#febc2e"`)
    expect(svg).toContain(`fill="#28c840"`)
    // Window bar adds height
    expect(svg).toContain(`height="60"`) // 20 content + 40 bar
  })

  test("windowBar rings renders three outlined circles", () => {
    const term = createMockReadable(["Hi"])
    const svg = screenshotSvg(term, { windowBar: "rings" })
    expect(svg).toContain(`stroke="#ff5f57"`)
    expect(svg).toContain(`stroke="#febc2e"`)
    expect(svg).toContain(`stroke="#28c840"`)
    expect(svg).toContain(`fill="none"`)
  })

  test("windowBar none produces no circles", () => {
    const term = createMockReadable(["Hi"])
    const svg = screenshotSvg(term, { windowBar: "none" })
    expect(svg).not.toContain(`fill="#ff5f57"`)
    expect(svg).not.toContain(`fill="#febc2e"`)
    expect(svg).not.toContain(`fill="#28c840"`)
  })

  test("margin adds space around the terminal", () => {
    const term = createMockReadable(["ab"])
    const svg = screenshotSvg(term, { margin: 10 })
    // 2*9.6 content + 0 padding + 20 margin = 39.2 width
    // 20 content + 0 padding + 20 margin = 40 height
    expect(svg).toContain(`width="39.2"`)
    expect(svg).toContain(`height="40"`)
    // Content translated by margin
    expect(svg).toContain(`translate(10, 10)`)
  })

  test("marginFill renders outer margin rect", () => {
    const term = createMockReadable(["Hi"])
    const svg = screenshotSvg(term, { margin: 10, marginFill: "#1a1a2e" })
    expect(svg).toContain(`fill="#1a1a2e"`)
  })

  test("combined padding + borderRadius + windowBar + margin", () => {
    const term = createMockReadable(["Hi"])
    const svg = screenshotSvg(term, {
      padding: 16,
      borderRadius: 8,
      windowBar: "colorful",
      windowBarSize: 40,
      margin: 20,
    })
    // Content: 2*9.6=19.2 wide, 1*20=20 tall
    // Inner: 19.2+32=51.2 wide, 20+32+40=92 tall
    // Total: 51.2+40=91.2 wide, 92+40=132 tall
    expect(svg).toContain(`width="91.2"`)
    expect(svg).toContain(`height="132"`)
    expect(svg).toContain(`fill="#ff5f57"`) // window bar dots
    expect(svg).toContain(`rx="8"`) // border radius
    expect(svg).toContain(`translate(36, 76)`) // margin(20) + padding(16), margin(20) + padding(16) + bar(40)
  })

  test("no chrome produces same output as before (backward compat)", () => {
    const term = createMockReadable(["Hello"])
    const svg = screenshotSvg(term)
    // Classic format: no translate group, 100% width/height bg rect
    expect(svg).toContain(`width="100%"`)
    expect(svg).toContain(`height="100%"`)
    expect(svg).not.toContain(`translate`)
    expect(svg).not.toContain(`clipPath`)
  })

  test("windowBarSize controls window bar height", () => {
    const term = createMockReadable(["Hi"])
    const svg = screenshotSvg(term, { windowBar: "colorful", windowBarSize: 30 })
    // Content: 20 + bar: 30 = 50
    expect(svg).toContain(`height="50"`)
  })
})
