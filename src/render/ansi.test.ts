import { describe, it, expect } from "vitest"
import { freshStyle, rowToAnsi, sgrDelta, SGR_RESET } from "./ansi.ts"
import type { Cell } from "../terminal/types.ts"

function cell(char: string, overrides: Partial<Cell> = {}): Cell {
  return {
    char,
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

describe("sgrDelta", () => {
  it("returns empty string for identical state", () => {
    expect(sgrDelta(freshStyle(), freshStyle())).toBe("")
  })

  it("emits a single SGR turning on bold", () => {
    expect(sgrDelta(freshStyle(), { ...freshStyle(), bold: true })).toBe("\x1b[1m")
  })

  it("emits reset + restore when an attribute drops", () => {
    const a = { ...freshStyle(), bold: true, italic: true }
    const b = { ...freshStyle(), bold: true } // italic dropped
    // We must reset (no per-attribute italic-off) then re-apply bold.
    expect(sgrDelta(a, b)).toBe("\x1b[0;1m")
  })

  it("emits truecolor foreground SGR", () => {
    const next = { ...freshStyle(), fg: { r: 255, g: 128, b: 0 } }
    expect(sgrDelta(freshStyle(), next)).toBe("\x1b[38;2;255;128;0m")
  })

  it("emits truecolor background SGR alongside fg", () => {
    const next = { ...freshStyle(), fg: { r: 1, g: 2, b: 3 }, bg: { r: 4, g: 5, b: 6 } }
    expect(sgrDelta(freshStyle(), next)).toBe("\x1b[38;2;1;2;3;48;2;4;5;6m")
  })

  it("does not re-emit when colour is unchanged", () => {
    const colour = { r: 10, g: 20, b: 30 }
    const a = { ...freshStyle(), fg: colour }
    const b = { ...freshStyle(), fg: colour, bold: true }
    expect(sgrDelta(a, b)).toBe("\x1b[1m")
  })
})

describe("rowToAnsi", () => {
  it("renders plain ASCII cells in order, padded to cols", () => {
    const row = "hi".split("").map((c) => cell(c))
    const out = rowToAnsi(row, 5)
    // Should be "hi   " — three trailing spaces — with no SGR transitions.
    expect(out).toBe("hi   ")
  })

  it("emits one SGR per style change, not per cell", () => {
    const red = { r: 255, g: 0, b: 0 }
    const row = [cell("a", { fg: red }), cell("b", { fg: red }), cell("c", { fg: red })]
    const out = rowToAnsi(row, 3)
    // Single SGR setting fg=red, then "abc", then reset.
    expect(out).toBe(`\x1b[38;2;255;0;0mabc${SGR_RESET}`)
  })

  it("skips continuation cells of a wide glyph", () => {
    const row = [cell("漢", { wide: true }), cell("", { continuation: true }), cell("z")]
    const out = rowToAnsi(row, 3)
    expect(out).toBe("漢z")
  })

  it("pads to cols when row is short", () => {
    const out = rowToAnsi([], 4)
    expect(out).toBe("    ")
  })

  it("truncates when row is wider than cols", () => {
    const row = "abcdef".split("").map((c) => cell(c))
    const out = rowToAnsi(row, 3)
    expect(out).toBe("abc")
  })

  it("emits SGR reset after styled run before the trailing padding", () => {
    const blue = { r: 0, g: 0, b: 255 }
    const row = [cell("x", { fg: blue }), cell("y", { fg: blue })]
    const out = rowToAnsi(row, 5)
    // Style on "xy", reset before padding, then 3 spaces.
    expect(out).toBe(`\x1b[38;2;0;0;255mxy\x1b[0m   `)
  })
})
