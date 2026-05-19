import { describe, test, expect } from "vitest"
import { cellsToAnsi } from "../src/canvas-render.ts"
import type {
  Cell,
  CursorState,
  CursorStyle,
  ScrollbackState,
  TerminalMode,
  TerminalReadable,
  UnderlineStyle,
} from "../src/types.ts"

// ── Helpers (mirrors svg.test.ts) ──

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

function makeReadable(
  rows: Cell[][],
  cursor: Partial<CursorState> = {},
): TerminalReadable {
  const fullCursor: CursorState = {
    x: 0,
    y: 0,
    visible: true,
    style: "block" as CursorStyle,
    ...cursor,
  }
  return {
    getText: () => rows.map((r) => r.map((c) => c.char).join("")).join("\n"),
    getTextRange: () => "",
    getCell: (row, col) => rows[row]?.[col] ?? defaultCell(),
    getLine: (row) => rows[row] ?? [],
    getLines: () => rows,
    getCursor: () => fullCursor,
    getMode: (_m: TerminalMode) => false,
    getTitle: () => "",
    getScrollback: (): ScrollbackState => ({
      viewportOffset: 0,
      totalLines: rows.length,
      screenLines: rows.length,
    }),
  }
}

function row(text: string, overrides?: (cell: Cell, col: number) => void): Cell[] {
  return Array.from(text, (ch, col) => {
    const c = defaultCell(ch)
    overrides?.(c, col)
    return c
  })
}

// ── cellsToAnsi tests ──

describe("cellsToAnsi", () => {
  test("plain text round-trips with CRLF between rows", () => {
    const r = makeReadable([row("hello"), row("world")])
    const out = cellsToAnsi(r)
    expect(out).toContain("hello")
    expect(out).toContain("world")
    expect(out).toContain("\r\n") // CRLF separator
    expect(out.startsWith("hello")).toBe(true)
  })

  test("trailing reset SGR + cursor reposition", () => {
    const r = makeReadable([row("hello")], { x: 2, y: 0 })
    const out = cellsToAnsi(r)
    // Cursor positioning is 1-indexed.
    expect(out).toContain("\x1b[1;3H")
  })

  test("emits SGR fg color on transition", () => {
    const cells = row("ab", (c, col) => {
      if (col === 1) c.fg = { r: 255, g: 0, b: 0 }
    })
    const r = makeReadable([cells])
    const out = cellsToAnsi(r)
    expect(out).toContain("\x1b[38;2;255;0;0m")
    expect(out).toContain("a")
    expect(out).toContain("b")
  })

  test("emits SGR bg color on transition", () => {
    const cells = row("xy", (c, col) => {
      if (col === 1) c.bg = { r: 0, g: 128, b: 255 }
    })
    const r = makeReadable([cells])
    const out = cellsToAnsi(r)
    expect(out).toContain("\x1b[48;2;0;128;255m")
  })

  test("bold turns on with SGR 1", () => {
    const cells = row("AB", (c, col) => {
      if (col === 1) c.bold = true
    })
    const r = makeReadable([cells])
    const out = cellsToAnsi(r)
    expect(out).toContain("\x1b[1m")
  })

  test("attribute turn-off emits reset then re-apply", () => {
    // First cell bold, second cell plain — must reset.
    const cells = row("AB", (c, col) => {
      if (col === 0) c.bold = true
    })
    const r = makeReadable([cells])
    const out = cellsToAnsi(r)
    expect(out).toContain("\x1b[0m")
  })

  test("inverse and italic combine in same SGR sequence when both turn on", () => {
    const cells = row("Z", (c) => {
      c.inverse = true
      c.italic = true
    })
    const r = makeReadable([cells])
    const out = cellsToAnsi(r)
    // Both attrs land in one sequence.
    expect(out).toMatch(/\x1b\[(?:3;7|7;3)m/)
  })

  test("continuation cells are skipped (wide-char trailing)", () => {
    const a = defaultCell("A")
    const wide = defaultCell("漢")
    wide.wide = true
    const trail = defaultCell(" ")
    trail.continuation = true
    const r = makeReadable([[a, wide, trail]])
    const out = cellsToAnsi(r)
    expect(out).toContain("A")
    expect(out).toContain("漢")
    // Should not emit an extra space for the continuation cell.
    expect(out.indexOf("漢 ")).toBe(-1)
  })

  test("empty cell falls back to space", () => {
    const r = makeReadable([[defaultCell("")]])
    const out = cellsToAnsi(r)
    expect(out).toContain(" ")
  })
})

// ── screenshotCanvasPng smoke (skipped unless deps installed) ──

describe.skipIf(
  // Skip if either optional dep is missing — keeps non-canvas CI green.
  // The smoke test attempts a real chromium launch and is intentionally
  // slow; the cells→ANSI tests above are the per-PR contract.
  !canImportSync("playwright") || !canImportSync("ghostty-web"),
)("screenshotCanvasPng (integration)", () => {
  test("returns PNG bytes for a simple fixture", async () => {
    const { screenshotCanvasPng } = await import("../src/canvas-render.ts")
    const r = makeReadable([row("hello canvas")])
    const png = await screenshotCanvasPng(r, { cols: 40, rows: 5 })
    expect(png).toBeInstanceOf(Uint8Array)
    expect(png.byteLength).toBeGreaterThan(1000)
    // PNG signature: 89 50 4E 47.
    expect(png[0]).toBe(0x89)
    expect(png[1]).toBe(0x50)
    expect(png[2]).toBe(0x4e)
    expect(png[3]).toBe(0x47)
  }, 30_000)
})

function canImportSync(name: string): boolean {
  try {
    // require.resolve via Bun's CJS shim works for both node + bun
    require.resolve(name)
    return true
  } catch {
    return false
  }
}
