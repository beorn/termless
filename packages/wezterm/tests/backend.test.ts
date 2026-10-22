/**
 * WezTerm backend unit tests.
 *
 * NOTE: These tests require the native Rust module to be compiled.
 * They will be skipped if the native module is not available.
 *
 * Build the native module:
 *   cd packages/wezterm/native && cargo build --release
 *   cp target/release/libtermless_wezterm_native.dylib ../termless-wezterm.node
 * @failure WezTerm falsely declares OSC 8 URI metadata exposed by its NAPI cells.
 * @level l0
 * @consumer Termless WezTerm backend capability declaration.
 * @testonly none
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest"
import { createWeztermBackend, loadWeztermNative } from "../src/backend.ts"
import type { TerminalBackend } from "../../../src/terminal/types.ts"

const encoder = new TextEncoder()
const encode = (s: string) => encoder.encode(s)

// Skip all tests if native module is not available
let nativeAvailable = false
try {
  loadWeztermNative()
  nativeAvailable = true
} catch {
  // Native module not built — tests will be skipped
}

const describeNative = nativeAvailable ? describe : describe.skip

describeNative("wezterm backend", () => {
  let backend: TerminalBackend

  beforeEach(() => {
    backend = createWeztermBackend()
    backend.init({ cols: 80, rows: 24 })
  })

  afterEach(() => {
    backend.destroy()
  })

  // ── Lifecycle ──

  describe("lifecycle", () => {
    test("throws when not initialized", () => {
      const b = createWeztermBackend()
      expect(() => b.getText()).toThrow("not initialized")
    })

    test("re-init clears state", () => {
      backend.feed(encode("hello"))
      backend.init({ cols: 80, rows: 24 })
      expect(backend.getText().trim()).toBe("")
    })

    test("destroy is safe to call multiple times", () => {
      backend.destroy()
      backend.destroy()
    })
  })

  // ── Text I/O ──

  describe("text", () => {
    test("plain text appears at cursor", () => {
      backend.feed(encode("hello"))
      const text = backend.getText()
      expect(text).toContain("hello")
    })

    test("multiline text", () => {
      backend.feed(encode("line1\r\nline2\r\nline3"))
      const text = backend.getText()
      expect(text).toContain("line1")
      expect(text).toContain("line2")
      expect(text).toContain("line3")
    })

    test("CUP positions cursor", () => {
      // CUP: CSI row;col H (1-based)
      backend.feed(encode("\x1b[5;10Htext"))
      const cell = backend.getCell(4, 9) // 0-based
      expect(cell.char).toBe("t")
    })

    test("getTextRange extracts region", () => {
      backend.feed(encode("abcdefghij"))
      const range = backend.getTextRange(0, 0, 0, 5)
      expect(range).toBe("abcde")
    })
  })

  // ── Colors ──

  describe("colors", () => {
    test("truecolor foreground", () => {
      // SGR 38;2;r;g;b
      backend.feed(encode("\x1b[38;2;255;128;0mX"))
      const cell = backend.getCell(0, 0)
      expect(cell.fg).toEqual({ r: 255, g: 128, b: 0 })
    })

    test("truecolor background", () => {
      // SGR 48;2;r;g;b
      backend.feed(encode("\x1b[48;2;0;128;255mX"))
      const cell = backend.getCell(0, 0)
      expect(cell.bg).toEqual({ r: 0, g: 128, b: 255 })
    })

    test("indexed and named colors resolve through the palette, not as {r: index} (#30703)", () => {
      // SGR 38;5;67 is cube (1,2,3) = #5f87af; SGR 48;5;173 is cube (4,2,1) = #d7875f; SGR 31 is palette
      // slot 1, which wezterm's default palette (ColorPalette::compute_default) sets to #cc5555.
      backend.feed(encode("\x1b[38;5;67mA\x1b[0m\x1b[48;5;173mB\x1b[0m\x1b[31mR\x1b[0m"))
      expect(backend.getCell(0, 0).fg).toEqual({ r: 95, g: 135, b: 175 })
      expect(backend.getCell(0, 1).bg).toEqual({ r: 215, g: 135, b: 95 })
      expect(backend.getCell(0, 2).fg).toEqual({ r: 204, g: 85, b: 85 })
    })

    test("default colors are null", () => {
      backend.feed(encode("X"))
      const cell = backend.getCell(0, 0)
      expect(cell.fg).toBeNull()
      expect(cell.bg).toBeNull()
    })

    test("SGR reset clears colors", () => {
      backend.feed(encode("\x1b[38;2;255;0;0mR\x1b[0mX"))
      const red = backend.getCell(0, 0)
      const normal = backend.getCell(0, 1)
      expect(red.fg).toEqual({ r: 255, g: 0, b: 0 })
      expect(normal.fg).toBeNull()
    })
  })

  // ── Attributes ──

  describe("attributes", () => {
    test("bold", () => {
      backend.feed(encode("\x1b[1mB\x1b[0m"))
      expect(backend.getCell(0, 0).bold).toBe(true)
    })

    test("faint", () => {
      backend.feed(encode("\x1b[2mF\x1b[0m"))
      expect(backend.getCell(0, 0).dim).toBe(true)
    })

    test("italic", () => {
      backend.feed(encode("\x1b[3mI\x1b[0m"))
      expect(backend.getCell(0, 0).italic).toBe(true)
    })

    test("underline (single)", () => {
      backend.feed(encode("\x1b[4mU\x1b[0m"))
      expect(backend.getCell(0, 0).underline).toBe("single")
    })

    test("strikethrough", () => {
      backend.feed(encode("\x1b[9mS\x1b[0m"))
      expect(backend.getCell(0, 0).strikethrough).toBe(true)
    })

    test("inverse", () => {
      backend.feed(encode("\x1b[7mR\x1b[0m"))
      expect(backend.getCell(0, 0).inverse).toBe(true)
    })

    test("combined attributes", () => {
      backend.feed(encode("\x1b[1;3;4mX\x1b[0m"))
      const cell = backend.getCell(0, 0)
      expect(cell.bold).toBe(true)
      expect(cell.italic).toBe(true)
      expect(cell.underline).toBe("single")
    })
  })

  // ── Wide characters ──

  describe("wide characters", () => {
    test("CJK character is wide", () => {
      backend.feed(encode("你"))
      const cell = backend.getCell(0, 0)
      expect(cell.char).toBe("你")
      expect(cell.wide).toBe(true)
    })
  })

  // ── Cursor ──

  describe("cursor", () => {
    test("initial position", () => {
      const cursor = backend.getCursor()
      expect(cursor.x).toBe(0)
      expect(cursor.y).toBe(0)
    })

    test("advances with text", () => {
      backend.feed(encode("abc"))
      const cursor = backend.getCursor()
      expect(cursor.x).toBe(3)
      expect(cursor.y).toBe(0)
    })

    test("newline moves to next row", () => {
      backend.feed(encode("abc\r\n"))
      const cursor = backend.getCursor()
      expect(cursor.x).toBe(0)
      expect(cursor.y).toBe(1)
    })

    test("CUP sets position", () => {
      backend.feed(encode("\x1b[10;20H"))
      const cursor = backend.getCursor()
      expect(cursor.x).toBe(19) // 0-based
      expect(cursor.y).toBe(9) // 0-based
    })
  })

  // ── Modes ──

  describe("modes", () => {
    test("alt screen off by default", () => {
      expect(backend.getMode("altScreen")).toBe(false)
    })

    test("alt screen on after DECSET 1049", () => {
      backend.feed(encode("\x1b[?1049h"))
      expect(backend.getMode("altScreen")).toBe(true)
    })

    test("alt screen off after DECRST 1049", () => {
      backend.feed(encode("\x1b[?1049h"))
      backend.feed(encode("\x1b[?1049l"))
      expect(backend.getMode("altScreen")).toBe(false)
    })

    test("bracketed paste off by default", () => {
      expect(backend.getMode("bracketedPaste")).toBe(false)
    })

    test("bracketed paste on after DECSET 2004", () => {
      backend.feed(encode("\x1b[?2004h"))
      expect(backend.getMode("bracketedPaste")).toBe(true)
    })

    test("returns null for modes without public wezterm-term getters instead of scanner shadow state", () => {
      backend.feed(encode("\x1b[?1h\x1b[?6h\x1b[?7l\x1b[?66h\x1b[?1004h\x1b[4h"))
      for (const mode of [
        "applicationCursor",
        "applicationKeypad",
        "autoWrap",
        "focusTracking",
        "originMode",
        "insertMode",
      ] as const) {
        expect(backend.getMode(mode), `expected null for unobserved mode ${mode}`).toBeNull()
      }
      expect(backend.getMode("sgrMouse" as never)).toBeNull()
    })
  })

  describe("responses", () => {
    test("forwards DECRPM and DA1/DSR engine responses synchronously through onResponse", () => {
      const responses: string[] = []
      backend.onResponse = (bytes) => responses.push(new TextDecoder().decode(bytes))

      backend.feed(encode("\x1b[?2004h\x1b[?2004$p"))
      backend.feed(encode("\x1b[?2004l\x1b[?2004$p"))
      backend.feed(encode("\x1b[?1006h\x1b[?1006$p"))
      backend.feed(encode("\x1b[5n"))

      expect(responses).toEqual(["\x1b[?2004;1$y", "\x1b[?2004;2$y", "\x1b[?1006;1$y", "\x1b[0n"])
    })
  })

  // ── Key encoding ──

  describe("key encoding", () => {
    test("Enter", () => {
      expect(backend.encodeKey({ key: "Enter" })).toEqual(encode("\r"))
    })

    test("Escape", () => {
      expect(backend.encodeKey({ key: "Escape" })).toEqual(encode("\x1b"))
    })

    test("Ctrl+C", () => {
      expect(backend.encodeKey({ key: "c", ctrl: true })).toEqual(new Uint8Array([3]))
    })

    test("ArrowUp", () => {
      expect(backend.encodeKey({ key: "ArrowUp" })).toEqual(encode("\x1b[A"))
    })

    test("regular character", () => {
      expect(backend.encodeKey({ key: "a" })).toEqual(encode("a"))
    })

    test("Shift+ArrowUp", () => {
      expect(backend.encodeKey({ key: "ArrowUp", shift: true })).toEqual(encode("\x1b[1;2A"))
    })

    test("Alt+letter", () => {
      expect(backend.encodeKey({ key: "x", alt: true })).toEqual(encode("\x1bx"))
    })
  })

  // ── Scrollback ──

  describe("scrollback", () => {
    test("initial scrollback state", () => {
      const sb = backend.getScrollback()
      expect(sb.screenLines).toBe(24)
      expect(sb.totalLines).toBeGreaterThanOrEqual(24)
    })

    test("scrollback grows beyond screen", () => {
      // Write enough lines to overflow
      for (let i = 0; i < 30; i++) {
        backend.feed(encode(`line ${i}\r\n`))
      }
      const sb = backend.getScrollback()
      expect(sb.totalLines).toBeGreaterThan(24)
    })
  })

  // ── Resize ──

  describe("resize", () => {
    test("resize changes dimensions", () => {
      backend.resize(40, 12)
      backend.feed(encode("hello"))
      // Should not crash and cursor should be within new bounds
      const cursor = backend.getCursor()
      expect(cursor.x).toBe(5)
    })
  })

  // ── Reset ──

  describe("reset", () => {
    test("clears screen", () => {
      backend.feed(encode("hello"))
      backend.reset()
      const text = backend.getText()
      expect(text.trim()).toBe("")
    })

    test("clears title", () => {
      backend.feed(encode("\x1b]2;My Title\x07"))
      expect(backend.getTitle()).toBe("My Title")
      backend.reset()
      expect(backend.getTitle()).toBe("")
    })
  })

  // ── Title ──

  describe("title", () => {
    test("OSC 2 sets title", () => {
      backend.feed(encode("\x1b]2;Hello World\x07"))
      expect(backend.getTitle()).toBe("Hello World")
    })
  })

  // ── Capabilities ──

  describe("capabilities", () => {
    test("name is wezterm", () => {
      expect(backend.capabilities.name).toBe("wezterm")
    })

    test("supports truecolor", () => {
      expect(backend.capabilities.truecolor).toBe(true)
    })

    test("supports kitty keyboard", () => {
      expect(backend.capabilities.kittyKeyboard).toBe(true)
    })

    test("supports sixel", () => {
      expect(backend.capabilities.sixel).toBe(true)
    })

    test("does not claim OSC 8 link metadata from the NAPI bridge", () => {
      expect(backend.capabilities.osc8Hyperlinks).toBe(false)
    })

    test("supports reflow", () => {
      expect(backend.capabilities.reflow).toBe(true)
    })
  })

  // ── getLine / getLines ──

  describe("line access", () => {
    test("getLine returns correct number of cells", () => {
      backend.feed(encode("abc"))
      const line = backend.getLine(0)
      expect(line.length).toBe(80)
      expect(line[0]!.char).toBe("a")
      expect(line[1]!.char).toBe("b")
      expect(line[2]!.char).toBe("c")
    })

    test("getLines returns correct number of rows", () => {
      const lines = backend.getLines()
      expect(lines.length).toBe(24)
    })
  })
})
