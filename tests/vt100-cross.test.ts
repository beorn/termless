/**
 * Cross-comparison tests: TypeScript vt100 vs Rust vt100.
 *
 * Feeds identical ANSI sequences to both backends and compares cell-by-cell
 * output. Differences indicate bugs in one implementation. The Rust vt100
 * crate (doy/vt100-rust) serves as the reference — disagreements are worth
 * investigating in the TypeScript port.
 *
 * Skipped automatically when the vt100-rust native module is not built.
 */
import { describe, test, expect, afterEach } from "vitest"
import { createVt100Backend } from "../packages/vt100/src/backend.ts"
import type { TerminalBackend, Cell } from "../src/types.ts"

// ── Native module availability check ──────────────────────────────

let available = false
let createVt100RustBackend: () => TerminalBackend

try {
  const mod = await import("../packages/vt100-rust/src/backend.ts")
  createVt100RustBackend = mod.createVt100RustBackend
  const probe = createVt100RustBackend()
  probe.init({ cols: 80, rows: 24 })
  probe.destroy()
  available = true
} catch {
  // Native module not built — all tests will be skipped
}

const describeIfAvailable = available ? describe : describe.skip

// ── Helpers ───────────────────────────────────────────────────────

function feedText(backend: TerminalBackend, text: string): void {
  backend.feed(new TextEncoder().encode(text))
}

function feedBoth(ts: TerminalBackend, rust: TerminalBackend, text: string): void {
  const bytes = new TextEncoder().encode(text)
  ts.feed(bytes)
  rust.feed(bytes)
}

/** Normalize empty/null char to space for comparison */
function cellChar(cell: Cell): string {
  return cell.char || " "
}

/**
 * Compare a single cell between the two backends.
 * Asserts on text content and all style attributes.
 */
function compareCells(ts: TerminalBackend, rust: TerminalBackend, row: number, col: number, label?: string): void {
  const tsCell = ts.getCell(row, col)
  const rustCell = rust.getCell(row, col)
  const tag = label ? ` (${label})` : ""
  const pos = `[${row},${col}]${tag}`

  expect(cellChar(tsCell), `char at ${pos}`).toBe(cellChar(rustCell))
  expect(tsCell.bold, `bold at ${pos}`).toBe(rustCell.bold)
  expect(tsCell.italic, `italic at ${pos}`).toBe(rustCell.italic)
  expect(tsCell.underline, `underline at ${pos}`).toBe(rustCell.underline)
  expect(tsCell.strikethrough, `strikethrough at ${pos}`).toBe(rustCell.strikethrough)
  expect(tsCell.inverse, `inverse at ${pos}`).toBe(rustCell.inverse)
  expect(tsCell.wide, `wide at ${pos}`).toBe(rustCell.wide)
  expect(tsCell.fg, `fg at ${pos}`).toEqual(rustCell.fg)
  expect(tsCell.bg, `bg at ${pos}`).toEqual(rustCell.bg)
}

/**
 * Compare a range of cells between both backends.
 */
function compareCellRange(
  ts: TerminalBackend,
  rust: TerminalBackend,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
): void {
  for (let row = startRow; row <= endRow; row++) {
    const colEnd = row === endRow ? endCol : ts.getLine(row).length - 1
    for (let col = row === startRow ? startCol : 0; col <= colEnd; col++) {
      compareCells(ts, rust, row, col)
    }
  }
}

// ── Tests ─────────────────────────────────────────────────────────

describeIfAvailable("vt100 cross-comparison (TypeScript vs Rust)", () => {
  const activeBackends: TerminalBackend[] = []

  function init(cols = 80, rows = 24): { ts: TerminalBackend; rust: TerminalBackend } {
    const ts = createVt100Backend()
    ts.init({ cols, rows })
    activeBackends.push(ts)

    const rust = createVt100RustBackend()
    rust.init({ cols, rows })
    activeBackends.push(rust)

    return { ts, rust }
  }

  afterEach(() => {
    for (const b of activeBackends) b.destroy()
    activeBackends.length = 0
  })

  // ── Text rendering ──────────────────────────────────────────────

  describe("text rendering", () => {
    test("plain text", () => {
      const { ts, rust } = init()
      feedBoth(ts, rust, "Hello, world!")
      expect(ts.getText()).toContain("Hello, world!")
      expect(rust.getText()).toContain("Hello, world!")
      for (let col = 0; col < 13; col++) {
        compareCells(ts, rust, 0, col)
      }
    })

    test("multiline text", () => {
      const { ts, rust } = init()
      feedBoth(ts, rust, "Line 1\r\nLine 2\r\nLine 3")
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 6; col++) {
          compareCells(ts, rust, row, col)
        }
      }
    })

    test("CUP positioning (ESC[row;colH)", () => {
      const { ts, rust } = init(40, 10)
      feedBoth(ts, rust, "\x1b[3;10HX")
      compareCells(ts, rust, 2, 9, "CUP target")
    })

    test("line wrap at terminal width", () => {
      const { ts, rust } = init(10, 5)
      feedBoth(ts, rust, "1234567890WRAP")
      // "WRAP" should appear on row 1 after wrapping
      for (let col = 0; col < 4; col++) {
        compareCells(ts, rust, 1, col, "wrapped text")
      }
    })
  })

  // ── Cell styles (SGR) ──────────────────────────────────────────

  describe("cell styles (SGR)", () => {
    test("bold", () => {
      const { ts, rust } = init()
      feedBoth(ts, rust, "\x1b[1mB\x1b[0mN")
      compareCells(ts, rust, 0, 0, "bold B")
      compareCells(ts, rust, 0, 1, "normal N")
    })

    test("italic", () => {
      const { ts, rust } = init()
      feedBoth(ts, rust, "\x1b[3mI\x1b[0mN")
      compareCells(ts, rust, 0, 0, "italic I")
      compareCells(ts, rust, 0, 1, "normal N")
    })

    test("faint/dim", () => {
      const { ts, rust } = init()
      feedBoth(ts, rust, "\x1b[2mF\x1b[0mN")
      // Compare char content — dim flag may differ in representation
      expect(cellChar(ts.getCell(0, 0))).toBe(cellChar(rust.getCell(0, 0)))
    })

    test("strikethrough", () => {
      const { ts, rust } = init()
      feedBoth(ts, rust, "\x1b[9mS\x1b[0mN")
      compareCells(ts, rust, 0, 0, "strikethrough S")
      compareCells(ts, rust, 0, 1, "normal N")
    })

    test("inverse", () => {
      const { ts, rust } = init()
      feedBoth(ts, rust, "\x1b[7mI\x1b[0mN")
      compareCells(ts, rust, 0, 0, "inverse I")
      compareCells(ts, rust, 0, 1, "normal N")
    })

    test("underline (single)", () => {
      const { ts, rust } = init()
      feedBoth(ts, rust, "\x1b[4mU\x1b[0mN")
      compareCells(ts, rust, 0, 0, "underline U")
      compareCells(ts, rust, 0, 1, "normal N")
    })

    test("truecolor foreground", () => {
      const { ts, rust } = init()
      feedBoth(ts, rust, "\x1b[38;2;255;128;0mR\x1b[0m")
      compareCells(ts, rust, 0, 0, "truecolor fg")
    })

    test("truecolor background", () => {
      const { ts, rust } = init()
      feedBoth(ts, rust, "\x1b[48;2;0;128;255mB\x1b[0m")
      compareCells(ts, rust, 0, 0, "truecolor bg")
    })

    test("combined bold+italic+truecolor", () => {
      const { ts, rust } = init()
      feedBoth(ts, rust, "\x1b[1;3;38;2;255;0;0mX\x1b[0m")
      compareCells(ts, rust, 0, 0, "combined styles")
    })

    test("SGR 0 resets all styles", () => {
      const { ts, rust } = init()
      feedBoth(ts, rust, "\x1b[1;3;4;9mStyled\x1b[0mPlain")
      // Compare the 'P' in 'Plain' — should have no styles
      compareCells(ts, rust, 0, 6, "reset P")
    })
  })

  // ── Cursor ─────────────────────────────────────────────────────

  describe("cursor", () => {
    test("position after text", () => {
      const { ts, rust } = init()
      feedBoth(ts, rust, "Hello")
      expect(ts.getCursor().x).toBe(rust.getCursor().x)
      expect(ts.getCursor().y).toBe(rust.getCursor().y)
    })

    test("position after CUP", () => {
      const { ts, rust } = init()
      feedBoth(ts, rust, "\x1b[10;20H")
      expect(ts.getCursor().x).toBe(rust.getCursor().x)
      expect(ts.getCursor().y).toBe(rust.getCursor().y)
    })

    test("CUF forward (ESC[5C)", () => {
      const { ts, rust } = init()
      feedBoth(ts, rust, "\x1b[5C")
      expect(ts.getCursor().x).toBe(rust.getCursor().x)
      expect(ts.getCursor().y).toBe(rust.getCursor().y)
    })
  })

  // ── Modes ──────────────────────────────────────────────────────

  describe("modes", () => {
    test("alt screen toggle", () => {
      const { ts, rust } = init()
      expect(ts.getMode("altScreen")).toBe(rust.getMode("altScreen"))
      feedBoth(ts, rust, "\x1b[?1049h")
      expect(ts.getMode("altScreen")).toBe(rust.getMode("altScreen"))
      feedBoth(ts, rust, "\x1b[?1049l")
      expect(ts.getMode("altScreen")).toBe(rust.getMode("altScreen"))
    })

    test("bracketed paste", () => {
      const { ts, rust } = init()
      feedBoth(ts, rust, "\x1b[?2004h")
      expect(ts.getMode("bracketedPaste")).toBe(rust.getMode("bracketedPaste"))
    })
  })

  // ── Reset ──────────────────────────────────────────────────────

  describe("reset", () => {
    test("reset() clears content", () => {
      const { ts, rust } = init()
      feedBoth(ts, rust, "Content here")
      ts.reset()
      rust.reset()
      expect(ts.getText()).not.toContain("Content here")
      expect(rust.getText()).not.toContain("Content here")
    })

    test("RIS (ESC c) clears screen", () => {
      const { ts, rust } = init()
      feedBoth(ts, rust, "Content\x1bc")
      expect(ts.getText()).not.toContain("Content")
      expect(rust.getText()).not.toContain("Content")
    })
  })
})
