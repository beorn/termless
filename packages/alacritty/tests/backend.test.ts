/**
 * Alacritty backend tests -- napi-rs headless terminal emulation.
 *
 * Tests the Alacritty backend implementation using alacritty_terminal via napi-rs.
 * These mirror the xterm.js and Ghostty backend tests for cross-backend compatibility.
 *
 * TODO: Tests require the native Rust module to be built first.
 * Run: cd packages/alacritty/native && cargo build --release
 */
import { describe, test, expect, afterEach } from "vitest"
import { createAlacrittyBackend, loadAlacrittyNative } from "../src/backend.ts"
import type { TerminalBackend } from "../../../src/types.ts"

// Skip all tests if native module is not available
let nativeAvailable = false
try {
  loadAlacrittyNative()
  nativeAvailable = true
} catch {
  // Native module not built — tests will be skipped
}

const describeNative = nativeAvailable ? describe : describe.skip

function createBackend(cols = 80, rows = 24): TerminalBackend {
  const backend = createAlacrittyBackend()
  backend.init({ cols, rows })
  return backend
}

function feedText(backend: TerminalBackend, text: string): void {
  backend.feed(new TextEncoder().encode(text))
}

describeNative("alacritty backend", () => {
  let backend: TerminalBackend

  afterEach(() => {
    if (backend) backend.destroy()
  })

  describe("lifecycle", () => {
    test("creates with correct name", () => {
      backend = createBackend()
      expect(backend.name).toBe("alacritty")
    })

    test("throws before init", () => {
      backend = createAlacrittyBackend()
      expect(() => backend.getText()).toThrow("not initialized")
    })
  })

  describe("text rendering", () => {
    test("renders plain text", () => {
      backend = createBackend()
      feedText(backend, "Hello, world!")
      const text = backend.getText()
      expect(text).toContain("Hello, world!")
    })

    test("renders multiple lines", () => {
      backend = createBackend()
      feedText(backend, "Line 1\r\nLine 2\r\nLine 3")
      const text = backend.getText()
      expect(text).toContain("Line 1")
      expect(text).toContain("Line 2")
      expect(text).toContain("Line 3")
    })

    test("handles cursor positioning", () => {
      backend = createBackend(40, 10)
      feedText(backend, "\x1b[3;5HPlaced") // Move to row 3, col 5
      const text = backend.getText()
      expect(text).toContain("Placed")
    })

    test("handles line wrapping", () => {
      backend = createBackend(10, 5)
      feedText(backend, "1234567890abcde") // Should wrap at col 10
      const text = backend.getText()
      expect(text).toContain("1234567890")
      expect(text).toContain("abcde")
    })
  })

  describe("cell attributes", () => {
    test("detects bold", () => {
      backend = createBackend()
      feedText(backend, "\x1b[1mBold\x1b[0m Normal")
      const boldCell = backend.getCell(0, 0)
      expect(boldCell.bold).toBe(true)
      expect(boldCell.char).toBe("B")

      const normalCell = backend.getCell(0, 5)
      expect(normalCell.bold).toBe(false)
    })

    test("detects italic", () => {
      backend = createBackend()
      feedText(backend, "\x1b[3mItalic\x1b[0m")
      expect(backend.getCell(0, 0).italic).toBe(true)
    })

    test("detects faint/dim", () => {
      backend = createBackend()
      feedText(backend, "\x1b[2mFaint\x1b[0m")
      expect(backend.getCell(0, 0).dim).toBe(true)
    })

    test("detects underline", () => {
      backend = createBackend()
      feedText(backend, "\x1b[4mUnderline\x1b[0m")
      expect(backend.getCell(0, 0).underline).toBe("single")
    })

    test.skip("detects double underline", () => {
      // Alacritty only supports single underline in headless mode
      backend = createBackend()
      feedText(backend, "\x1b[21mDouble\x1b[0m") // SGR 21 = double underline
      expect(backend.getCell(0, 0).underline).toBe("double")
    })

    test("detects curly underline", () => {
      backend = createBackend()
      feedText(backend, "\x1b[4:3mCurly\x1b[0m") // SGR 4:3 = curly
      expect(backend.getCell(0, 0).underline).toBe("curly")
    })

    test("detects dotted underline", () => {
      backend = createBackend()
      feedText(backend, "\x1b[4:4mDotted\x1b[0m") // SGR 4:4 = dotted
      expect(backend.getCell(0, 0).underline).toBe("dotted")
    })

    test("detects dashed underline", () => {
      backend = createBackend()
      feedText(backend, "\x1b[4:5mDashed\x1b[0m") // SGR 4:5 = dashed
      expect(backend.getCell(0, 0).underline).toBe("dashed")
    })

    test("detects strikethrough", () => {
      backend = createBackend()
      feedText(backend, "\x1b[9mStrike\x1b[0m")
      expect(backend.getCell(0, 0).strikethrough).toBe(true)
    })

    test("detects inverse", () => {
      backend = createBackend()
      feedText(backend, "\x1b[7mInverse\x1b[0m")
      expect(backend.getCell(0, 0).inverse).toBe(true)
    })

    test("detects truecolor foreground", () => {
      backend = createBackend()
      feedText(backend, "\x1b[38;2;255;0;0mRed\x1b[0m")
      const cell = backend.getCell(0, 0)
      expect(cell.fg).toEqual({ r: 255, g: 0, b: 0 })
    })

    test("detects truecolor background", () => {
      backend = createBackend()
      feedText(backend, "\x1b[48;2;0;255;0mGreen BG\x1b[0m")
      const cell = backend.getCell(0, 0)
      expect(cell.bg).toEqual({ r: 0, g: 255, b: 0 })
    })

    test("detects wide characters", () => {
      backend = createBackend()
      feedText(backend, "\u{1F389}") // party popper emoji
      const cell = backend.getCell(0, 0)
      expect(cell.wide).toBe(true)
    })
  })

  describe("getLine / getLines", () => {
    test("returns cells for a row", () => {
      backend = createBackend(20, 5)
      feedText(backend, "ABCDE")
      const line = backend.getLine(0)
      expect(line[0]!.char).toBe("A")
      expect(line[1]!.char).toBe("B")
      expect(line[4]!.char).toBe("E")
    })

    test("returns all rows", () => {
      backend = createBackend(20, 5)
      feedText(backend, "Row0\r\nRow1\r\nRow2")
      const lines = backend.getLines()
      expect(lines).toHaveLength(5) // All screen rows
    })
  })

  describe("getTextRange", () => {
    test("extracts rectangular region", () => {
      backend = createBackend(20, 5)
      feedText(backend, "ABCDEFGH\r\n12345678")
      const range = backend.getTextRange(0, 2, 1, 6)
      expect(range).toContain("CDEF")
      expect(range).toContain("3456")
    })
  })

  describe("cursor", () => {
    test("reports cursor position", () => {
      backend = createBackend()
      feedText(backend, "Hello")
      const cursor = backend.getCursor()
      expect(cursor.x).toBe(5)
      expect(cursor.y).toBe(0)
    })

    test("tracks cursor after newlines", () => {
      backend = createBackend()
      feedText(backend, "Line1\r\nLine2")
      const cursor = backend.getCursor()
      expect(cursor.y).toBe(1)
      expect(cursor.x).toBe(5)
    })

    test("tracks cursor with escape sequences", () => {
      backend = createBackend()
      feedText(backend, "\x1b[5;10H") // Move to row 5, col 10 (1-based)
      const cursor = backend.getCursor()
      expect(cursor.y).toBe(4) // 0-based
      expect(cursor.x).toBe(9) // 0-based
    })

    test("reports cursor visibility", () => {
      backend = createBackend()
      expect(backend.getCursor().visible).toBe(true)
      feedText(backend, "\x1b[?25l") // Hide cursor
      expect(backend.getCursor().visible).toBe(false)
      feedText(backend, "\x1b[?25h") // Show cursor
      expect(backend.getCursor().visible).toBe(true)
    })
  })

  describe("modes", () => {
    test("detects alt screen mode", () => {
      backend = createBackend()
      expect(backend.getMode("altScreen")).toBe(false)
      feedText(backend, "\x1b[?1049h") // Enter alt screen
      expect(backend.getMode("altScreen")).toBe(true)
      feedText(backend, "\x1b[?1049l") // Exit alt screen
      expect(backend.getMode("altScreen")).toBe(false)
    })

    test("detects bracketed paste mode", () => {
      backend = createBackend()
      expect(backend.getMode("bracketedPaste")).toBe(false)
      feedText(backend, "\x1b[?2004h") // Enable bracketed paste
      expect(backend.getMode("bracketedPaste")).toBe(true)
    })

    test("detects auto wrap mode", () => {
      backend = createBackend()
      // Auto wrap is ON by default
      expect(backend.getMode("autoWrap")).toBe(true)
    })

    test("detects application cursor mode", () => {
      backend = createBackend()
      expect(backend.getMode("applicationCursor")).toBe(false)
      feedText(backend, "\x1b[?1h") // Enable DECCKM
      expect(backend.getMode("applicationCursor")).toBe(true)
    })
  })

  describe("scrollback", () => {
    test("reports scrollback state", () => {
      backend = createBackend(20, 5)
      const state = backend.getScrollback()
      expect(state.screenLines).toBe(5)
      expect(state.totalLines).toBeGreaterThanOrEqual(5)
    })

    test("accumulates scrollback lines", () => {
      backend = createBackend(20, 3)
      // Write more lines than screen height to generate scrollback
      for (let i = 0; i < 10; i++) {
        feedText(backend, `Line ${i}\r\n`)
      }
      const state = backend.getScrollback()
      expect(state.totalLines).toBeGreaterThan(3)
    })
  })

  describe("resize", () => {
    test("resizes terminal", () => {
      backend = createBackend(40, 10)
      feedText(backend, "Before resize")
      backend.resize(80, 24)
      feedText(backend, "\r\nAfter resize")
      const text = backend.getText()
      expect(text).toContain("Before resize")
      expect(text).toContain("After resize")
    })
  })

  describe("reset", () => {
    test("clears screen content", () => {
      backend = createBackend()
      feedText(backend, "Some content")
      backend.reset()
      const text = backend.getText()
      expect(text).not.toContain("Some content")
    })
  })

  describe("key encoding", () => {
    test("encodes Enter", () => {
      backend = createBackend()
      const encoded = backend.encodeKey({ key: "Enter" })
      expect(encoded).toEqual(new Uint8Array([0x0d]))
    })

    test("encodes Escape", () => {
      backend = createBackend()
      const encoded = backend.encodeKey({ key: "Escape" })
      expect(encoded).toEqual(new Uint8Array([0x1b]))
    })

    test("encodes Ctrl+C", () => {
      backend = createBackend()
      const encoded = backend.encodeKey({ key: "c", ctrl: true })
      expect(encoded).toEqual(new Uint8Array([3])) // ETX
    })

    test("encodes regular characters", () => {
      backend = createBackend()
      const encoded = backend.encodeKey({ key: "a" })
      expect(new TextDecoder().decode(encoded)).toBe("a")
    })

    test("encodes arrow keys", () => {
      backend = createBackend()
      const encoded = backend.encodeKey({ key: "ArrowUp" })
      expect(new TextDecoder().decode(encoded)).toBe("\x1b[A")
    })

    test("encodes Shift+Arrow", () => {
      backend = createBackend()
      const encoded = backend.encodeKey({ key: "ArrowUp", shift: true })
      expect(new TextDecoder().decode(encoded)).toBe("\x1b[1;2A")
    })

    test("encodes Alt+letter", () => {
      backend = createBackend()
      const encoded = backend.encodeKey({ key: "x", alt: true })
      expect(new TextDecoder().decode(encoded)).toBe("\x1bx")
    })
  })

  describe("capabilities", () => {
    test("reports alacritty capabilities", () => {
      backend = createBackend()
      expect(backend.capabilities.name).toBe("alacritty")
      expect(backend.capabilities.truecolor).toBe(true)
      expect(backend.capabilities.kittyKeyboard).toBe(true)
      expect(backend.capabilities.reflow).toBe(true)
      expect(backend.capabilities.kittyGraphics).toBe(false)
      expect(backend.capabilities.sixel).toBe(false)
    })
  })
})
