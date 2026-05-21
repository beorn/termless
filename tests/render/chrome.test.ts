import { describe, test, expect } from "vitest"
import { chromeOptions, isChromeStyle, CHROME_STYLES } from "../../src/render/chrome.ts"
import { screenshotSvg } from "../../src/render/svg.ts"
import type { TerminalReadable, Cell, CursorState, CursorStyle, UnderlineStyle } from "../../src/terminal/types.ts"

// ── Minimal mock terminal ──

function cell(char = " "): Cell {
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

function mockTerm(lines: string[]): TerminalReadable {
  const cursor: CursorState = { x: 0, y: 0, visible: false, style: "block" as CursorStyle }
  const cellLines = lines.map((l) => [...l].map((c) => cell(c)))
  return {
    getText: () => lines.join("\n"),
    getTextRange: () => "",
    getCell: () => cell(),
    getLine: (r) => cellLines[r] ?? [],
    getLines: () => cellLines,
    getCursor: () => cursor,
    getMode: () => false,
    getTitle: () => "",
    getScrollback: () => ({ viewportOffset: 0, totalLines: lines.length, screenLines: lines.length }),
  }
}

// ── isChromeStyle ──

describe("isChromeStyle", () => {
  test("accepts the known styles", () => {
    for (const s of CHROME_STYLES) expect(isChromeStyle(s)).toBe(true)
  })
  test("rejects unknown values", () => {
    expect(isChromeStyle("mac")).toBe(false)
    expect(isChromeStyle("")).toBe(false)
    expect(isChromeStyle("MACOS")).toBe(false)
  })
})

// ── chromeOptions ──

describe("chromeOptions", () => {
  test("none resolves to empty options (no chrome)", () => {
    expect(chromeOptions("none")).toEqual({})
  })

  test("macos preset enables traffic-light bar, rounded corners, shadow, margin", () => {
    const o = chromeOptions("macos")
    expect(o.windowBar).toBe("colorful")
    expect(o.borderRadius).toBeGreaterThan(0)
    expect(o.shadow).toBeGreaterThan(0)
    expect(o.margin).toBeGreaterThan(0)
  })

  test("windows preset enables a flat title bar, square corners, no shadow", () => {
    const o = chromeOptions("windows")
    expect(o.windowBar).toBe("windows")
    expect(o.borderRadius).toBe(0)
    expect(o.shadow).toBeUndefined()
  })

  test("title is threaded into the preset when provided", () => {
    expect(chromeOptions("macos", "bun km view").windowTitle).toBe("bun km view")
    expect(chromeOptions("windows", "demo").windowTitle).toBe("demo")
    expect(chromeOptions("macos").windowTitle).toBeUndefined()
  })
})

// ── End-to-end: preset → rendered SVG ──

describe("chrome preset → screenshotSvg", () => {
  test("none is byte-identical to the bare grid", () => {
    const term = mockTerm(["Hello", "World"])
    const bare = screenshotSvg(term)
    const viaPreset = screenshotSvg(term, chromeOptions("none"))
    expect(viaPreset).toBe(bare)
  })

  test("macos preset produces traffic lights, rounded corners, and a shadow", () => {
    const term = mockTerm(["Hello"])
    const svg = screenshotSvg(term, chromeOptions("macos", "bun km view"))
    expect(svg).toContain("#ff5f57") // traffic-light dot
    expect(svg).toContain("feDropShadow")
    expect(svg).toContain("clipPath") // rounded-corner clip
    expect(svg).toContain("bun km view")
  })

  test("windows preset produces a flat title bar with controls", () => {
    const term = mockTerm(["Hello"])
    const svg = screenshotSvg(term, chromeOptions("windows", "demo.sh"))
    expect(svg).toContain("#e81123") // close glyph
    expect(svg).toContain("demo.sh")
    expect(svg).not.toContain("#ff5f57") // no macOS dots
  })
})
