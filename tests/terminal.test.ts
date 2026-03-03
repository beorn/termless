/**
 * Tests for key-mapping and terminal modules.
 *
 * Uses a minimal in-memory mock backend to test the Terminal API without
 * requiring xterm.js or a real PTY.
 */

import { describe, test, expect } from "vitest"
import { parseKey, keyToAnsi } from "../src/key-mapping.ts"
import { createTerminal } from "../src/terminal.ts"
import type {
  Cell,
  CursorState,
  KeyDescriptor,
  ScrollbackState,
  TerminalBackend,
  TerminalCapabilities,
  TerminalMode,
  TerminalOptions,
  RGB,
} from "../src/types.ts"

// ═══════════════════════════════════════════════════════
// Mock Backend
// ═══════════════════════════════════════════════════════

/** Minimal in-memory TerminalBackend for testing. Stores fed data as a flat text grid. */
function createMockBackend(): TerminalBackend {
  let cols = 80
  let rows = 24
  // Grid stored as array of rows, each row is an array of single characters
  let grid: string[][] = []
  let cursorX = 0
  let cursorY = 0
  let title = ""

  function initGrid(c: number, r: number): void {
    cols = c
    rows = r
    grid = Array.from({ length: r }, () => Array.from({ length: c }, () => " "))
    cursorX = 0
    cursorY = 0
  }

  function writeChar(ch: string): void {
    if (ch === "\n" || ch === "\r") {
      cursorX = 0
      if (ch === "\n") {
        cursorY++
        if (cursorY >= rows) cursorY = rows - 1
      }
      return
    }
    if (cursorX < cols && cursorY < rows) {
      grid[cursorY]![cursorX] = ch
      cursorX++
      if (cursorX >= cols) {
        cursorX = 0
        cursorY++
        if (cursorY >= rows) cursorY = rows - 1
      }
    }
  }

  const defaultCell: Cell = {
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

  function cellAt(row: number, col: number): Cell {
    const ch = grid[row]?.[col] ?? " "
    return { ...defaultCell, text: ch }
  }

  const capabilities: TerminalCapabilities = {
    name: "mock",
    version: "1.0.0",
    truecolor: true,
    kittyKeyboard: false,
    kittyGraphics: false,
    sixel: false,
    osc8Hyperlinks: false,
    semanticPrompts: false,
    unicode: "14.0",
    reflow: false,
    extensions: new Set(),
  }

  return {
    name: "mock",

    init(opts: TerminalOptions): void {
      initGrid(opts.cols, opts.rows)
    },

    destroy(): void {
      grid = []
    },

    feed(data: Uint8Array): void {
      const text = new TextDecoder().decode(data)
      for (const ch of text) {
        writeChar(ch)
      }
    },

    resize(c: number, r: number): void {
      initGrid(c, r)
    },

    reset(): void {
      initGrid(cols, rows)
    },

    getText(): string {
      return grid.map((row) => row.join("")).join("\n")
    },

    getTextRange(startRow: number, startCol: number, endRow: number, endCol: number): string {
      const lines: string[] = []
      for (let r = startRow; r <= endRow; r++) {
        const start = r === startRow ? startCol : 0
        const end = r === endRow ? endCol : cols
        lines.push((grid[r] ?? []).slice(start, end).join(""))
      }
      return lines.join("\n")
    },

    getCell(row: number, col: number): Cell {
      return cellAt(row, col)
    },

    getLine(row: number): Cell[] {
      return Array.from({ length: cols }, (_, col) => cellAt(row, col))
    },

    getLines(): Cell[][] {
      return Array.from({ length: rows }, (_, row) =>
        Array.from({ length: cols }, (_, col) => cellAt(row, col)),
      )
    },

    getCursor(): CursorState {
      return { x: cursorX, y: cursorY, visible: true, style: "block" }
    },

    getMode(_mode: TerminalMode): boolean {
      return false
    },

    getTitle(): string {
      return title
    },

    getRowText(row: number): string {
      return (grid[row] ?? []).join("").trimEnd()
    },

    getViewportText(): string {
      return grid.map((row) => row.join("").trimEnd()).join("\n")
    },

    getScrollbackText(_lineCount?: number): string {
      return "" // Mock has no scrollback
    },

    getScrollback(): ScrollbackState {
      return { viewportOffset: 0, totalLines: rows, screenLines: rows }
    },

    encodeKey(key: KeyDescriptor): Uint8Array {
      // Delegate to keyToAnsi for the mock — a real backend might use kitty encoding
      const ansi = keyToAnsi(key)
      return new TextEncoder().encode(ansi)
    },

    scrollViewport(_delta: number): void {
      // No-op for mock
    },

    capabilities,
  }
}

// ═══════════════════════════════════════════════════════
// parseKey tests
// ═══════════════════════════════════════════════════════

describe("parseKey", () => {
  test("single character", () => {
    const result = parseKey("a")
    expect(result).toEqual({ key: "a" })
  })

  test("uppercase character", () => {
    const result = parseKey("A")
    expect(result).toEqual({ key: "A" })
  })

  test("Ctrl modifier", () => {
    const result = parseKey("Ctrl+a")
    expect(result).toEqual({ key: "a", ctrl: true })
  })

  test("Alt modifier", () => {
    const result = parseKey("Alt+x")
    expect(result).toEqual({ key: "x", alt: true })
  })

  test("Shift modifier", () => {
    const result = parseKey("Shift+Tab")
    expect(result).toEqual({ key: "Tab", shift: true })
  })

  test("Meta/Cmd modifier maps to super", () => {
    const result = parseKey("Meta+k")
    expect(result).toEqual({ key: "k", super: true })
  })

  test("Cmd alias for super", () => {
    const result = parseKey("Cmd+s")
    expect(result).toEqual({ key: "s", super: true })
  })

  test("Option alias for alt", () => {
    const result = parseKey("Option+a")
    expect(result).toEqual({ key: "a", alt: true })
  })

  test("multiple modifiers", () => {
    const result = parseKey("Ctrl+Shift+a")
    expect(result).toEqual({ key: "a", ctrl: true, shift: true })
  })

  test("named key without modifier", () => {
    const result = parseKey("ArrowUp")
    expect(result).toEqual({ key: "ArrowUp" })
  })

  test("named key with modifier", () => {
    const result = parseKey("Ctrl+ArrowUp")
    expect(result).toEqual({ key: "ArrowUp", ctrl: true })
  })
})

// ═══════════════════════════════════════════════════════
// keyToAnsi tests
// ═══════════════════════════════════════════════════════

describe("keyToAnsi", () => {
  test("single character returns itself", () => {
    expect(keyToAnsi("a")).toBe("a")
    expect(keyToAnsi("z")).toBe("z")
    expect(keyToAnsi("1")).toBe("1")
  })

  test("Ctrl+a returns control code \\x01", () => {
    expect(keyToAnsi("Ctrl+a")).toBe("\x01")
  })

  test("Ctrl+c returns control code \\x03", () => {
    expect(keyToAnsi("Ctrl+c")).toBe("\x03")
  })

  test("Ctrl+z returns control code \\x1a", () => {
    expect(keyToAnsi("Ctrl+z")).toBe("\x1a")
  })

  test("ArrowUp returns ESC[A", () => {
    expect(keyToAnsi("ArrowUp")).toBe("\x1b[A")
  })

  test("ArrowDown returns ESC[B", () => {
    expect(keyToAnsi("ArrowDown")).toBe("\x1b[B")
  })

  test("ArrowLeft returns ESC[D", () => {
    expect(keyToAnsi("ArrowLeft")).toBe("\x1b[D")
  })

  test("ArrowRight returns ESC[C", () => {
    expect(keyToAnsi("ArrowRight")).toBe("\x1b[C")
  })

  test("Alt+x returns ESC + x", () => {
    expect(keyToAnsi("Alt+x")).toBe("\x1bx")
  })

  test("Enter returns \\r", () => {
    expect(keyToAnsi("Enter")).toBe("\r")
  })

  test("Ctrl+Enter returns \\n", () => {
    expect(keyToAnsi("Ctrl+Enter")).toBe("\n")
  })

  test("Tab returns \\t", () => {
    expect(keyToAnsi("Tab")).toBe("\t")
  })

  test("Shift+Tab returns CSI Z", () => {
    expect(keyToAnsi("Shift+Tab")).toBe("\x1b[Z")
  })

  test("Backspace returns \\x7f", () => {
    expect(keyToAnsi("Backspace")).toBe("\x7f")
  })

  test("Delete returns ESC[3~", () => {
    expect(keyToAnsi("Delete")).toBe("\x1b[3~")
  })

  test("Escape returns ESC", () => {
    expect(keyToAnsi("Escape")).toBe("\x1b")
  })

  test("Space returns space character", () => {
    expect(keyToAnsi("Space")).toBe(" ")
  })

  test("Home returns ESC[H", () => {
    expect(keyToAnsi("Home")).toBe("\x1b[H")
  })

  test("End returns ESC[F", () => {
    expect(keyToAnsi("End")).toBe("\x1b[F")
  })

  test("PageUp returns ESC[5~", () => {
    expect(keyToAnsi("PageUp")).toBe("\x1b[5~")
  })

  test("PageDown returns ESC[6~", () => {
    expect(keyToAnsi("PageDown")).toBe("\x1b[6~")
  })

  describe("function keys F1-F12", () => {
    const expected: [string, string][] = [
      ["F1", "\x1bOP"],
      ["F2", "\x1bOQ"],
      ["F3", "\x1bOR"],
      ["F4", "\x1bOS"],
      ["F5", "\x1b[15~"],
      ["F6", "\x1b[17~"],
      ["F7", "\x1b[18~"],
      ["F8", "\x1b[19~"],
      ["F9", "\x1b[20~"],
      ["F10", "\x1b[21~"],
      ["F11", "\x1b[23~"],
      ["F12", "\x1b[24~"],
    ]

    test.each(expected)("%s returns correct ANSI sequence", (key, ansi) => {
      expect(keyToAnsi(key)).toBe(ansi)
    })
  })

  test("accepts KeyDescriptor directly", () => {
    const desc: KeyDescriptor = { key: "a", ctrl: true }
    expect(keyToAnsi(desc)).toBe("\x01")
  })

  test("pure modifier keys return empty string", () => {
    expect(keyToAnsi("Control")).toBe("")
    expect(keyToAnsi("Shift")).toBe("")
    expect(keyToAnsi("Alt")).toBe("")
    expect(keyToAnsi("Meta")).toBe("")
  })
})

// ═══════════════════════════════════════════════════════
// Terminal tests (with mock backend)
// ═══════════════════════════════════════════════════════

describe("createTerminal", () => {
  test("initializes with given dimensions", () => {
    const backend = createMockBackend()
    const term = createTerminal({ backend, cols: 40, rows: 10 })

    expect(term.cols).toBe(40)
    expect(term.rows).toBe(10)
    expect(term.backend).toBe(backend)

    // Cleanup
    term.close()
  })

  test("defaults to 80x24", () => {
    const backend = createMockBackend()
    const term = createTerminal({ backend })

    expect(term.cols).toBe(80)
    expect(term.rows).toBe(24)

    term.close()
  })

  test("feed string data appears in getText", () => {
    const backend = createMockBackend()
    const term = createTerminal({ backend, cols: 20, rows: 5 })

    term.feed("Hello, world!")

    const text = term.getText()
    expect(text).toContain("Hello, world!")

    term.close()
  })

  test("feed Uint8Array data appears in getText", () => {
    const backend = createMockBackend()
    const term = createTerminal({ backend, cols: 20, rows: 5 })

    term.feed(new TextEncoder().encode("Binary data"))

    const text = term.getText()
    expect(text).toContain("Binary data")

    term.close()
  })

  test("find locates text in terminal", () => {
    const backend = createMockBackend()
    const term = createTerminal({ backend, cols: 40, rows: 5 })

    term.feed("Line one\nLine two\nLine three")

    const result = term.find("two")
    expect(result).not.toBeNull()
    expect(result!.row).toBe(1)
    expect(result!.col).toBeGreaterThanOrEqual(0)
    expect(result!.text).toBe("two")

    term.close()
  })

  test("find returns null when text not found", () => {
    const backend = createMockBackend()
    const term = createTerminal({ backend, cols: 40, rows: 5 })

    term.feed("Hello")

    expect(term.find("goodbye")).toBeNull()

    term.close()
  })

  test("findAll with regex finds multiple matches", () => {
    const backend = createMockBackend()
    const term = createTerminal({ backend, cols: 40, rows: 5 })

    term.feed("foo bar foo\nbaz foo qux")

    const results = term.findAll(/foo/)
    expect(results.length).toBe(3)
    expect(results[0]).toEqual({ row: 0, col: 0, text: "foo" })
    expect(results[2]!.row).toBe(1)

    term.close()
  })

  test("findAll returns empty array when no matches", () => {
    const backend = createMockBackend()
    const term = createTerminal({ backend, cols: 40, rows: 5 })

    term.feed("Hello world")

    expect(term.findAll(/xyz/)).toEqual([])

    term.close()
  })

  test("resize updates dimensions", () => {
    const backend = createMockBackend()
    const term = createTerminal({ backend, cols: 80, rows: 24 })

    term.resize(120, 40)

    expect(term.cols).toBe(120)
    expect(term.rows).toBe(40)

    term.close()
  })

  test("close destroys backend", async () => {
    const backend = createMockBackend()
    const term = createTerminal({ backend, cols: 40, rows: 10 })

    await term.close()

    // After close, getText should return empty (grid destroyed)
    expect(term.getText()).toBe("")
  })

  test("Symbol.asyncDispose calls close", async () => {
    const backend = createMockBackend()
    const term = createTerminal({ backend, cols: 40, rows: 10 })

    await term[Symbol.asyncDispose]()

    expect(term.getText()).toBe("")
  })

  test("getCursor delegates to backend", () => {
    const backend = createMockBackend()
    const term = createTerminal({ backend, cols: 40, rows: 10 })

    const cursor = term.getCursor()
    expect(cursor.x).toBe(0)
    expect(cursor.y).toBe(0)
    expect(cursor.visible).toBe(true)

    term.close()
  })

  test("getCell delegates to backend", () => {
    const backend = createMockBackend()
    const term = createTerminal({ backend, cols: 40, rows: 5 })

    term.feed("X")

    const cell = term.getCell(0, 0)
    expect(cell.text).toBe("X")

    term.close()
  })

  test("alive is false when no PTY", () => {
    const backend = createMockBackend()
    const term = createTerminal({ backend })

    expect(term.alive).toBe(false)

    term.close()
  })

  test("exitInfo is null when no PTY", () => {
    const backend = createMockBackend()
    const term = createTerminal({ backend })

    expect(term.exitInfo).toBeNull()

    term.close()
  })

  test("press throws when no PTY", () => {
    const backend = createMockBackend()
    const term = createTerminal({ backend })

    expect(() => term.press("a")).toThrow("No PTY spawned")

    term.close()
  })

  test("type throws when no PTY", () => {
    const backend = createMockBackend()
    const term = createTerminal({ backend })

    expect(() => term.type("hello")).toThrow("No PTY spawned")

    term.close()
  })

  test("feed after close throws", async () => {
    const backend = createMockBackend()
    const term = createTerminal({ backend })

    await term.close()

    expect(() => term.feed("data")).toThrow("Terminal is closed")
  })

  test("waitFor resolves when text appears immediately", async () => {
    const backend = createMockBackend()
    const term = createTerminal({ backend, cols: 40, rows: 5 })

    term.feed("ready")

    // Should resolve immediately since text is already present
    await term.waitFor("ready", 1000)

    term.close()
  })

  test("waitFor times out when text never appears", async () => {
    const backend = createMockBackend()
    const term = createTerminal({ backend, cols: 40, rows: 5 })

    await expect(term.waitFor("nonexistent", 100)).rejects.toThrow("Timeout")

    term.close()
  })

  test("waitForStable resolves when content is stable", async () => {
    const backend = createMockBackend()
    const term = createTerminal({ backend, cols: 40, rows: 5 })

    term.feed("stable content")

    // Content is static, should stabilize within stableMs
    await term.waitForStable(50, 1000)

    term.close()
  })

  test("getRowText returns trimmed text of a row", () => {
    const backend = createMockBackend()
    const term = createTerminal({ backend, cols: 20, rows: 5 })

    term.feed("Hello world\nLine two")

    expect(term.getRowText(0)).toBe("Hello world")
    expect(term.getRowText(1)).toBe("Line two")
    expect(term.getRowText(2)).toBe("")

    term.close()
  })

  test("getViewportText returns all viewport rows", () => {
    const backend = createMockBackend()
    const term = createTerminal({ backend, cols: 20, rows: 3 })

    term.feed("Row A\nRow B\nRow C")

    const text = term.getViewportText()
    expect(text).toContain("Row A")
    expect(text).toContain("Row B")
    expect(text).toContain("Row C")

    term.close()
  })

  test("getScrollbackText returns empty for mock backend", () => {
    const backend = createMockBackend()
    const term = createTerminal({ backend, cols: 20, rows: 5 })

    term.feed("Hello")

    expect(term.getScrollbackText()).toBe("")

    term.close()
  })
})
