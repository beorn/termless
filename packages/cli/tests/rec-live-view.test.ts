/**
 * Unit tests for the {@link RecorderLive} live-chrome overlay — pure helpers
 * only.
 *
 * Asserts the static cell-grid extraction + chrome-presentation logic
 * directly, without mounting through Silvery's React reconciler. The actual
 * `<RecorderLive>` component composes these two pure functions with
 * Silvery's Box / Text / Border primitives, all of which are independently
 * tested in the Silvery suite — there is nothing to re-verify here that
 * isn't covered by the unit-test below + Silvery's own tests.
 *
 * Why not mount? `@silvery/ag-react@0.4.x`'s `src/components/Box.tsx` uses
 * JSX without an explicit `import React`, which fails standalone-clone
 * resolution under Bun's vitest. The runtime mount works fine in production
 * (Bun's CLI has React in scope from the entry point), but the standalone
 * test environment can't evaluate it. See
 * `@km/termless/ci-preexisting-failures` for the full standalone-CI inventory.
 */

import { describe, it, expect } from "vitest"
import { chromePresentation, rowToString } from "../src/rec-live-view-helpers.ts"
import type { Cell } from "../../../src/terminal/types.ts"

/** Build a synthetic {@link Cell} with optional overrides. */
function cell(char: string, overrides: Partial<Cell> = {}): Cell {
  return {
    char,
    continuation: false,
    fg: undefined,
    bg: undefined,
    bold: false,
    italic: false,
    underline: false,
    reverse: false,
    strike: false,
    dim: false,
    blink: false,
    invisible: false,
    ...overrides,
  } as Cell
}

describe("chromePresentation", () => {
  it("macos → round border + title bar + traffic-light dots", () => {
    expect(chromePresentation("macos")).toEqual({
      borderStyle: "round",
      showTitleBar: true,
      showDots: true,
    })
  })

  it("windows → single border + title bar + no dots", () => {
    expect(chromePresentation("windows")).toEqual({
      borderStyle: "single",
      showTitleBar: true,
      showDots: false,
    })
  })

  it("none → no border, no title bar, no dots", () => {
    expect(chromePresentation("none")).toEqual({
      borderStyle: null,
      showTitleBar: false,
      showDots: false,
    })
  })
})

describe("rowToString", () => {
  it("renders plain ASCII cells in order", () => {
    const row = "hello".split("").map((c) => cell(c))
    expect(rowToString(row, 5)).toBe("hello")
  })

  it("pads missing trailing cells with spaces", () => {
    const row = ["a", "b"].map((c) => cell(c))
    expect(rowToString(row, 5)).toBe("ab   ")
  })

  it("substitutes a space for empty-char cells", () => {
    const row = [cell("x"), cell(""), cell("y")]
    expect(rowToString(row, 3)).toBe("x y")
  })

  it("skips wide-cell continuation cells (avoids double-paint)", () => {
    // Wide char at col 0 occupies cols 0+1; col 1 is a continuation cell that
    // must NOT contribute a second glyph.
    const row = [cell("漢"), cell("", { continuation: true }), cell("z")]
    expect(rowToString(row, 3)).toBe("漢z")
  })

  it("returns all spaces for an empty row", () => {
    expect(rowToString([], 4)).toBe("    ")
  })

  it("respects the cols cap — extra cells beyond cols are dropped", () => {
    const row = "abcdef".split("").map((c) => cell(c))
    expect(rowToString(row, 3)).toBe("abc")
  })
})
