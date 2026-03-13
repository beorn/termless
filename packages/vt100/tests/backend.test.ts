import { describe, test, expect } from "vitest"
import { createVt100Backend } from "../src/backend.ts"

describe("createVt100Backend", () => {
  // ── Lifecycle ──

  test("creates backend with default options (80x24)", () => {
    const backend = createVt100Backend()
    backend.init({ cols: 80, rows: 24 })
    const cursor = backend.getCursor()
    expect(cursor.x).toBe(0)
    expect(cursor.y).toBe(0)
    const text = backend.getText()
    expect(text).toBeDefined()
    backend.destroy()
  })

  test("creates backend with custom cols/rows", () => {
    const backend = createVt100Backend({ cols: 120, rows: 40 })
    const scrollback = backend.getScrollback()
    expect(scrollback.screenLines).toBe(40)
    backend.destroy()
  })

  test("can be eagerly initialized via opts", () => {
    const backend = createVt100Backend({ cols: 60, rows: 20 })
    // Should work without calling init()
    expect(backend.getText()).toBeDefined()
    backend.destroy()
  })

  test("throws if not initialized", () => {
    const backend = createVt100Backend()
    expect(() => backend.getText()).toThrow("not initialized")
    backend.destroy()
  })

  // ── Text I/O ──

  test("feed plain text, getText() returns it", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("hello world"))
    const text = backend.getText()
    expect(text).toContain("hello world")
    backend.destroy()
  })

  test("feed multiline text", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("line1\r\nline2\r\nline3"))
    const text = backend.getText()
    expect(text).toContain("line1")
    expect(text).toContain("line2")
    expect(text).toContain("line3")
    backend.destroy()
  })

  // ── Colors ──

  test("feed ANSI color codes, getCell() has correct fg color", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    // SGR 31 = red foreground (ANSI color 1)
    backend.feed(new TextEncoder().encode("\x1b[31mR\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.char).toBe("R")
    expect(cell.fg).not.toBeNull()
    // ANSI color 1 = { r: 0x80, g: 0, b: 0 }
    expect(cell.fg!.r).toBe(0x80)
    expect(cell.fg!.g).toBe(0)
    expect(cell.fg!.b).toBe(0)
    backend.destroy()
  })

  test("feed text with background color, getCell() has correct bg", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    // SGR 42 = green background (ANSI color 2)
    backend.feed(new TextEncoder().encode("\x1b[42mG\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.char).toBe("G")
    expect(cell.bg).not.toBeNull()
    // ANSI color 2 = { r: 0, g: 0x80, b: 0 }
    expect(cell.bg!.r).toBe(0)
    expect(cell.bg!.g).toBe(0x80)
    expect(cell.bg!.b).toBe(0)
    backend.destroy()
  })

  test("256-color mode detection", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    // SGR 38;5;208 = 256-color orange foreground (index 208)
    backend.feed(new TextEncoder().encode("\x1b[38;5;208mX\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.char).toBe("X")
    expect(cell.fg).not.toBeNull()
    // Index 208 = 6x6x6 cube: r=5, g=3, b=0 -> (0xff, 0x87, 0x00)
    expect(cell.fg!.r).toBe(0xff)
    expect(cell.fg!.g).toBe(0x87)
    expect(cell.fg!.b).toBe(0x00)
    backend.destroy()
  })

  test("truecolor (24-bit) detection", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    // SGR 38;2;171;205;239 = true color foreground
    backend.feed(new TextEncoder().encode("\x1b[38;2;171;205;239mT\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.char).toBe("T")
    expect(cell.fg).not.toBeNull()
    expect(cell.fg!.r).toBe(171)
    expect(cell.fg!.g).toBe(205)
    expect(cell.fg!.b).toBe(239)
    backend.destroy()
  })

  test("bright foreground colors (90-97)", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    // SGR 91 = bright red foreground (ANSI color 9)
    backend.feed(new TextEncoder().encode("\x1b[91mR\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.fg).not.toBeNull()
    expect(cell.fg!.r).toBe(0xff)
    expect(cell.fg!.g).toBe(0x00)
    expect(cell.fg!.b).toBe(0x00)
    backend.destroy()
  })

  test("256-color background", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    // SGR 48;5;21 = 256-color blue background (index 21)
    backend.feed(new TextEncoder().encode("\x1b[48;5;21mB\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.bg).not.toBeNull()
    // Index 21 = 6x6x6 cube: r=0, g=0, b=5 -> (0x00, 0x00, 0xff)
    expect(cell.bg!.r).toBe(0x00)
    expect(cell.bg!.g).toBe(0x00)
    expect(cell.bg!.b).toBe(0xff)
    backend.destroy()
  })

  test("truecolor background", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("\x1b[48;2;100;150;200mB\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.bg).not.toBeNull()
    expect(cell.bg!.r).toBe(100)
    expect(cell.bg!.g).toBe(150)
    expect(cell.bg!.b).toBe(200)
    backend.destroy()
  })

  // ── Text attributes ──

  test("feed bold text, getCell() has bold=true", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("\x1b[1mhello\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.char).toBe("h")
    expect(cell.bold).toBe(true)
    // After reset, next cells should not be bold
    backend.feed(new TextEncoder().encode("x"))
    const after = backend.getCell(0, 5)
    expect(after.bold).toBe(false)
    backend.destroy()
  })

  test("italic attribute detection", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("\x1b[3mitalic\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.italic).toBe(true)
    backend.destroy()
  })

  test("underline attribute detection", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("\x1b[4munderlined\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.underline).toBe("single")
    backend.destroy()
  })

  test("strikethrough attribute detection", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("\x1b[9mstruck\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.strikethrough).toBe(true)
    backend.destroy()
  })

  test("faint/dim attribute detection", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("\x1b[2mdim\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.dim).toBe(true)
    backend.destroy()
  })

  test("inverse attribute detection", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("\x1b[7minverse\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.inverse).toBe(true)
    backend.destroy()
  })

  // ── Cursor ──

  test("cursor position updates after text feed", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("abc"))
    const cursor = backend.getCursor()
    expect(cursor.x).toBe(3)
    expect(cursor.y).toBe(0)
    expect(cursor.visible).toBe(true)
    expect(cursor.style).toBe("block")
    backend.destroy()
  })

  test("cursor moves to next line on newline", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("line1\r\n"))
    const cursor = backend.getCursor()
    expect(cursor.x).toBe(0)
    expect(cursor.y).toBe(1)
    backend.destroy()
  })

  test("cursor positioning via CSI H", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    // Move cursor to row 5, col 10 (1-based)
    backend.feed(new TextEncoder().encode("\x1b[5;10H"))
    const cursor = backend.getCursor()
    expect(cursor.x).toBe(9)
    expect(cursor.y).toBe(4)
    backend.destroy()
  })

  test("cursor visibility via DECTCEM", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    expect(backend.getCursor().visible).toBe(true)
    // Hide cursor
    backend.feed(new TextEncoder().encode("\x1b[?25l"))
    expect(backend.getCursor().visible).toBe(false)
    // Show cursor
    backend.feed(new TextEncoder().encode("\x1b[?25h"))
    expect(backend.getCursor().visible).toBe(true)
    backend.destroy()
  })

  // ── Modes ──

  test("alt screen mode detection", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    expect(backend.getMode("altScreen")).toBe(false)
    // Enter alt screen
    backend.feed(new TextEncoder().encode("\x1b[?1049h"))
    expect(backend.getMode("altScreen")).toBe(true)
    // Leave alt screen
    backend.feed(new TextEncoder().encode("\x1b[?1049l"))
    expect(backend.getMode("altScreen")).toBe(false)
    backend.destroy()
  })

  test("bracketed paste mode detection", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    expect(backend.getMode("bracketedPaste")).toBe(false)
    backend.feed(new TextEncoder().encode("\x1b[?2004h"))
    expect(backend.getMode("bracketedPaste")).toBe(true)
    backend.destroy()
  })

  test("mouse tracking mode detection", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    expect(backend.getMode("mouseTracking")).toBe(false)
    // Enable VT200 mouse tracking
    backend.feed(new TextEncoder().encode("\x1b[?1000h"))
    expect(backend.getMode("mouseTracking")).toBe(true)
    backend.destroy()
  })

  test("autowrap mode detection", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    expect(backend.getMode("autoWrap")).toBe(true) // Default on
    backend.feed(new TextEncoder().encode("\x1b[?7l"))
    expect(backend.getMode("autoWrap")).toBe(false)
    backend.feed(new TextEncoder().encode("\x1b[?7h"))
    expect(backend.getMode("autoWrap")).toBe(true)
    backend.destroy()
  })

  // ── Resize ──

  test("resize() changes dimensions", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    backend.resize(120, 40)
    const scrollback = backend.getScrollback()
    expect(scrollback.screenLines).toBe(40)
    backend.destroy()
  })

  // ── Title ──

  test("title changes via OSC 2", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    expect(backend.getTitle()).toBe("")
    // OSC 2 ; title ST (using BEL as terminator)
    backend.feed(new TextEncoder().encode("\x1b]2;my terminal title\x07"))
    expect(backend.getTitle()).toBe("my terminal title")
    backend.destroy()
  })

  test("title changes via OSC 0", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("\x1b]0;window title\x07"))
    expect(backend.getTitle()).toBe("window title")
    backend.destroy()
  })

  test("title changes via OSC with ST terminator", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("\x1b]2;st title\x1b\\"))
    expect(backend.getTitle()).toBe("st title")
    backend.destroy()
  })

  // ── Reset ──

  test("reset() clears all content", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("some content here"))
    expect(backend.getText()).toContain("some content here")
    backend.reset()
    // After reset, content should be cleared
    const text = backend.getText()
    expect(text.trim()).toBe("")
    backend.destroy()
  })

  // ── Wide characters ──

  test("feed wide characters (CJK), getCell() has wide=true", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    // CJK character (Chinese "big")
    backend.feed(new TextEncoder().encode("\u5927"))
    const cell = backend.getCell(0, 0)
    expect(cell.char).toBe("\u5927")
    expect(cell.wide).toBe(true)
    // Spacer cell after wide character
    const spacer = backend.getCell(0, 1)
    expect(spacer.char).toBe("")
    expect(spacer.wide).toBe(false)
    backend.destroy()
  })

  // ── getLine / getLines ──

  test("getLine returns cells for the row", () => {
    const backend = createVt100Backend({ cols: 10, rows: 5 })
    backend.feed(new TextEncoder().encode("abc"))
    const line = backend.getLine(0)
    expect(line).toHaveLength(10)
    expect(line[0]!.char).toBe("a")
    expect(line[1]!.char).toBe("b")
    expect(line[2]!.char).toBe("c")
    backend.destroy()
  })

  test("getLines returns all visible rows", () => {
    const backend = createVt100Backend({ cols: 10, rows: 5 })
    const lines = backend.getLines()
    expect(lines).toHaveLength(5)
    backend.destroy()
  })

  // ── getTextRange ──

  test("getTextRange returns text in range", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("hello world\r\nsecond line"))
    const range = backend.getTextRange(0, 6, 0, 11)
    expect(range).toBe("world")
    backend.destroy()
  })

  // ── Key encoding ──

  test("encodeKey returns correct ANSI for arrow keys", () => {
    const backend = createVt100Backend()
    backend.init({ cols: 80, rows: 24 })

    const up = backend.encodeKey({ key: "ArrowUp" })
    expect(up).toEqual(new TextEncoder().encode("\x1b[A"))

    const down = backend.encodeKey({ key: "ArrowDown" })
    expect(down).toEqual(new TextEncoder().encode("\x1b[B"))

    const right = backend.encodeKey({ key: "ArrowRight" })
    expect(right).toEqual(new TextEncoder().encode("\x1b[C"))

    const left = backend.encodeKey({ key: "ArrowLeft" })
    expect(left).toEqual(new TextEncoder().encode("\x1b[D"))

    backend.destroy()
  })

  test("encodeKey handles Ctrl+letter modifiers", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })

    // Ctrl+C = 0x03
    const ctrlC = backend.encodeKey({ key: "c", ctrl: true })
    expect(ctrlC).toEqual(new Uint8Array([3]))

    // Ctrl+A = 0x01
    const ctrlA = backend.encodeKey({ key: "a", ctrl: true })
    expect(ctrlA).toEqual(new Uint8Array([1]))

    // Ctrl+Z = 0x1A
    const ctrlZ = backend.encodeKey({ key: "z", ctrl: true })
    expect(ctrlZ).toEqual(new Uint8Array([26]))

    backend.destroy()
  })

  test("encodeKey handles Alt+letter", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    const altA = backend.encodeKey({ key: "a", alt: true })
    expect(altA).toEqual(new TextEncoder().encode("\x1ba"))
    backend.destroy()
  })

  test("encodeKey handles Shift+Arrow (CSI modifier encoding)", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    // Shift+Up = CSI 1;2 A
    const shiftUp = backend.encodeKey({ key: "ArrowUp", shift: true })
    expect(shiftUp).toEqual(new TextEncoder().encode("\x1b[1;2A"))
    backend.destroy()
  })

  test("encodeKey handles Ctrl+Shift+Arrow", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    // Ctrl+Shift = bits 5 (shift=1, ctrl=4) -> param = 6
    const ctrlShiftRight = backend.encodeKey({ key: "ArrowRight", ctrl: true, shift: true })
    expect(ctrlShiftRight).toEqual(new TextEncoder().encode("\x1b[1;6C"))
    backend.destroy()
  })

  test("encodeKey handles regular characters", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    const a = backend.encodeKey({ key: "a" })
    expect(a).toEqual(new TextEncoder().encode("a"))
    backend.destroy()
  })

  test("encodeKey handles Enter key", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    const enter = backend.encodeKey({ key: "Enter" })
    expect(enter).toEqual(new TextEncoder().encode("\r"))
    backend.destroy()
  })

  test("encodeKey handles function keys", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    const f1 = backend.encodeKey({ key: "F1" })
    expect(f1).toEqual(new TextEncoder().encode("\x1bOP"))

    const f5 = backend.encodeKey({ key: "F5" })
    expect(f5).toEqual(new TextEncoder().encode("\x1b[15~"))
    backend.destroy()
  })

  // ── Capabilities ──

  test("capabilities are correctly set", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    expect(backend.capabilities.name).toBe("vt100")
    expect(backend.capabilities.truecolor).toBe(true)
    expect(backend.capabilities.kittyKeyboard).toBe(false)
    expect(backend.capabilities.kittyGraphics).toBe(false)
    expect(backend.capabilities.sixel).toBe(false)
    expect(backend.capabilities.osc8Hyperlinks).toBe(false)
    expect(backend.capabilities.reflow).toBe(false)
    expect(backend.capabilities.extensions).toBeInstanceOf(Set)
    expect(backend.capabilities.extensions.size).toBe(0)
    backend.destroy()
  })

  // ── Backend name ──

  test("backend name is 'vt100'", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    expect(backend.name).toBe("vt100")
    backend.destroy()
  })

  // ── Scrollback ──

  test("getScrollback returns viewport state", () => {
    const backend = createVt100Backend({ cols: 80, rows: 5 })
    const state = backend.getScrollback()
    expect(state.screenLines).toBe(5)
    expect(state.viewportOffset).toBe(0)
    expect(state.totalLines).toBeGreaterThanOrEqual(5)
    backend.destroy()
  })

  // ── Default cell ──

  test("getCell on empty position returns default cell", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    const cell = backend.getCell(0, 0)
    expect(cell.fg).toBeNull()
    expect(cell.bg).toBeNull()
    expect(cell.bold).toBe(false)
    expect(cell.italic).toBe(false)
    expect(cell.underline).toBe(false)
    expect(cell.strikethrough).toBe(false)
    expect(cell.inverse).toBe(false)
    expect(cell.wide).toBe(false)
    backend.destroy()
  })

  // ── Combined attributes ──

  test("combined bold + color attributes", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    // Bold + red foreground
    backend.feed(new TextEncoder().encode("\x1b[1;31mX\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.char).toBe("X")
    expect(cell.bold).toBe(true)
    expect(cell.fg).not.toBeNull()
    expect(cell.fg!.r).toBe(0x80)
    backend.destroy()
  })

  // ── Erase commands ──

  test("erase in display (ED mode 2)", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("hello"))
    // Erase entire display
    backend.feed(new TextEncoder().encode("\x1b[2J"))
    const text = backend.getText()
    expect(text.trim()).toBe("")
    backend.destroy()
  })

  test("erase in line (EL mode 0)", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("hello world"))
    // Move cursor to col 5, erase from cursor to end of line
    backend.feed(new TextEncoder().encode("\x1b[1;6H\x1b[K"))
    const text = backend.getText()
    expect(text).toContain("hello")
    expect(text).not.toContain("world")
    backend.destroy()
  })

  // ── Scroll region ──

  test("scroll region respects DECSTBM", () => {
    const backend = createVt100Backend({ cols: 80, rows: 10 })
    // Set scroll region to rows 3-7 (1-based)
    backend.feed(new TextEncoder().encode("\x1b[3;7r"))
    // Cursor should be at 0,0 after DECSTBM
    const cursor = backend.getCursor()
    expect(cursor.x).toBe(0)
    expect(cursor.y).toBe(0)
    backend.destroy()
  })

  // ── Alternate screen buffer ──

  test("alternate screen preserves main screen content", () => {
    const backend = createVt100Backend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("main content"))
    // Enter alt screen
    backend.feed(new TextEncoder().encode("\x1b[?1049h"))
    expect(backend.getText()).not.toContain("main content")
    // Write to alt screen
    backend.feed(new TextEncoder().encode("alt content"))
    expect(backend.getText()).toContain("alt content")
    // Leave alt screen
    backend.feed(new TextEncoder().encode("\x1b[?1049l"))
    expect(backend.getText()).toContain("main content")
    expect(backend.getText()).not.toContain("alt content")
    backend.destroy()
  })

  // ── Scroll regions with content ──

  describe("scroll regions with content", () => {
    test("scrolling within a region preserves content above and below", () => {
      const backend = createVt100Backend({ cols: 20, rows: 6 })
      const enc = (s: string) => new TextEncoder().encode(s)

      // Fill all 6 rows with distinct content
      backend.feed(enc("ROW0-above\r\n")) // row 0
      backend.feed(enc("ROW1-top\r\n")) // row 1
      backend.feed(enc("ROW2-mid\r\n")) // row 2
      backend.feed(enc("ROW3-bot\r\n")) // row 3
      backend.feed(enc("ROW4-below\r\n")) // row 4
      backend.feed(enc("ROW5-last")) // row 5

      // Set scroll region to rows 2-4 (1-based), i.e., 0-based rows 1..3
      backend.feed(enc("\x1b[2;4r"))

      // Move cursor to the bottom of scroll region (row 3, 0-based)
      backend.feed(enc("\x1b[4;1H"))

      // Write multiple lines to trigger scrolling within the region
      backend.feed(enc("NEW-LINE-A\r\n"))
      backend.feed(enc("NEW-LINE-B\r\n"))
      backend.feed(enc("NEW-LINE-C"))

      const text = backend.getText()

      // Row 0 (above the scroll region) should be preserved
      expect(text).toContain("ROW0-above")
      // Row 4 and Row 5 (below the scroll region) should be preserved
      expect(text).toContain("ROW4-below")
      expect(text).toContain("ROW5-last")
    })

    test("DECSTBM sets scroll region and resets cursor to 0,0", () => {
      const backend = createVt100Backend({ cols: 80, rows: 10 })
      const enc = (s: string) => new TextEncoder().encode(s)

      // Move cursor somewhere
      backend.feed(enc("\x1b[5;10H"))
      expect(backend.getCursor().x).toBe(9)
      expect(backend.getCursor().y).toBe(4)

      // Set scroll region — cursor should reset to 0,0
      backend.feed(enc("\x1b[2;8r"))
      expect(backend.getCursor().x).toBe(0)
      expect(backend.getCursor().y).toBe(0)
      backend.destroy()
    })

    test("scroll up (SU) within region", () => {
      const backend = createVt100Backend({ cols: 20, rows: 5 })
      const enc = (s: string) => new TextEncoder().encode(s)

      backend.feed(enc("LINE-0\r\n"))
      backend.feed(enc("LINE-1\r\n"))
      backend.feed(enc("LINE-2\r\n"))
      backend.feed(enc("LINE-3\r\n"))
      backend.feed(enc("LINE-4"))

      // Set scroll region rows 2-4 (1-based), 0-based 1..3
      backend.feed(enc("\x1b[2;4r"))
      // Position cursor inside region
      backend.feed(enc("\x1b[2;1H"))
      // Scroll up once (CSI S)
      backend.feed(enc("\x1b[1S"))

      const text = backend.getText()
      // Row 0 (above region) should be preserved
      expect(text).toContain("LINE-0")
      // Row 4 (below region) should be preserved
      expect(text).toContain("LINE-4")
      backend.destroy()
    })
  })

  // ── Line wrapping ──

  describe("line wrapping", () => {
    test("text longer than cols wraps to next line", () => {
      const backend = createVt100Backend({ cols: 5, rows: 3 })
      // Write 8 characters into a 5-col terminal
      backend.feed(new TextEncoder().encode("ABCDEFGH"))

      // First line should have ABCDE
      const line0 = backend.getLine(0)
      expect(line0[0]!.char).toBe("A")
      expect(line0[1]!.char).toBe("B")
      expect(line0[2]!.char).toBe("C")
      expect(line0[3]!.char).toBe("D")
      expect(line0[4]!.char).toBe("E")

      // Second line should have FGH
      const line1 = backend.getLine(1)
      expect(line1[0]!.char).toBe("F")
      expect(line1[1]!.char).toBe("G")
      expect(line1[2]!.char).toBe("H")

      // Cursor should be on row 1, col 3
      expect(backend.getCursor().x).toBe(3)
      expect(backend.getCursor().y).toBe(1)
      backend.destroy()
    })

    test("autowrap disabled prevents wrapping", () => {
      const backend = createVt100Backend({ cols: 5, rows: 3 })
      // Disable autowrap
      backend.feed(new TextEncoder().encode("\x1b[?7l"))
      expect(backend.getMode("autoWrap")).toBe(false)

      // Write 8 characters — should NOT wrap
      backend.feed(new TextEncoder().encode("ABCDEFGH"))

      // Second line should be empty (no wrapping)
      const line1 = backend.getLine(1)
      expect(line1[0]!.char).toBe("")

      // Cursor stays on row 0
      expect(backend.getCursor().y).toBe(0)
      backend.destroy()
    })

    test("re-enabling autowrap allows wrapping again", () => {
      const backend = createVt100Backend({ cols: 5, rows: 3 })
      // Disable then re-enable
      backend.feed(new TextEncoder().encode("\x1b[?7l"))
      backend.feed(new TextEncoder().encode("\x1b[?7h"))
      expect(backend.getMode("autoWrap")).toBe(true)

      // Should wrap normally
      backend.feed(new TextEncoder().encode("ABCDEFGH"))
      const line1 = backend.getLine(1)
      expect(line1[0]!.char).toBe("F")
      backend.destroy()
    })
  })

  // ── Scrollback accumulation ──

  describe("scrollback accumulation", () => {
    test("writing more lines than rows pushes old lines to scrollback", () => {
      const backend = createVt100Backend({ cols: 10, rows: 3 })

      // Write 10 lines into a 3-row terminal
      for (let i = 0; i < 10; i++) {
        backend.feed(new TextEncoder().encode(`line${i}\r\n`))
      }

      const scrollback = backend.getScrollback()
      // totalLines = scrollback.length + screenLines
      // We wrote 10 newlines into 3 rows, so at least 7 lines should be in scrollback
      expect(scrollback.totalLines).toBeGreaterThan(scrollback.screenLines)
      expect(scrollback.totalLines).toBeGreaterThanOrEqual(10)

      // getText() includes scrollback — should contain early lines
      const text = backend.getText()
      expect(text).toContain("line0")
      expect(text).toContain("line1")
      expect(text).toContain("line9")
      backend.destroy()
    })

    test("scrollback respects scrollbackLimit", () => {
      const backend = createVt100Backend({ cols: 10, rows: 3, scrollbackLimit: 5 })

      // Write 20 lines to overflow the scrollback limit
      for (let i = 0; i < 20; i++) {
        backend.feed(new TextEncoder().encode(`L${i.toString().padStart(2, "0")}\r\n`))
      }

      const scrollback = backend.getScrollback()
      // scrollbackLimit=5: scrollback stores at most ~5 lines
      // totalLines = scrollbackLength + screenLines
      // The scrollback length should be capped around the limit
      const scrollbackLength = scrollback.totalLines - scrollback.screenLines
      expect(scrollbackLength).toBeLessThanOrEqual(7) // generous upper bound
      expect(scrollbackLength).toBeGreaterThan(0) // some scrollback exists

      // Very early lines should have been evicted from scrollback
      const text = backend.getText()
      expect(text).not.toContain("L00")
      expect(text).not.toContain("L01")
      backend.destroy()
    })
  })

  // ── Cursor movement commands ──

  describe("cursor movement commands", () => {
    test("CUU (cursor up) moves cursor up", () => {
      const backend = createVt100Backend({ cols: 80, rows: 24 })
      backend.feed(new TextEncoder().encode("\x1b[10;10H")) // row 9, col 9
      backend.feed(new TextEncoder().encode("\x1b[3A")) // up 3
      expect(backend.getCursor().y).toBe(6)
      expect(backend.getCursor().x).toBe(9) // x unchanged
      backend.destroy()
    })

    test("CUD (cursor down) moves cursor down", () => {
      const backend = createVt100Backend({ cols: 80, rows: 24 })
      backend.feed(new TextEncoder().encode("\x1b[5;5H")) // row 4, col 4
      backend.feed(new TextEncoder().encode("\x1b[4B")) // down 4
      expect(backend.getCursor().y).toBe(8)
      expect(backend.getCursor().x).toBe(4) // x unchanged
      backend.destroy()
    })

    test("CUF (cursor forward) moves cursor right", () => {
      const backend = createVt100Backend({ cols: 80, rows: 24 })
      backend.feed(new TextEncoder().encode("\x1b[1;1H")) // row 0, col 0
      backend.feed(new TextEncoder().encode("\x1b[10C")) // right 10
      expect(backend.getCursor().x).toBe(10)
      expect(backend.getCursor().y).toBe(0) // y unchanged
      backend.destroy()
    })

    test("CUB (cursor back) moves cursor left", () => {
      const backend = createVt100Backend({ cols: 80, rows: 24 })
      backend.feed(new TextEncoder().encode("\x1b[1;20H")) // row 0, col 19
      backend.feed(new TextEncoder().encode("\x1b[5D")) // left 5
      expect(backend.getCursor().x).toBe(14)
      expect(backend.getCursor().y).toBe(0) // y unchanged
      backend.destroy()
    })

    test("CHA (cursor horizontal absolute) sets column", () => {
      const backend = createVt100Backend({ cols: 80, rows: 24 })
      backend.feed(new TextEncoder().encode("\x1b[3;10H")) // row 2, col 9
      backend.feed(new TextEncoder().encode("\x1b[5G")) // col 5 (1-based) = col 4 (0-based)
      expect(backend.getCursor().x).toBe(4)
      expect(backend.getCursor().y).toBe(2) // y unchanged
      backend.destroy()
    })

    test("VPA (line position absolute) sets row", () => {
      const backend = createVt100Backend({ cols: 80, rows: 24 })
      backend.feed(new TextEncoder().encode("\x1b[1;10H")) // row 0, col 9
      backend.feed(new TextEncoder().encode("\x1b[3d")) // row 3 (1-based) = row 2 (0-based)
      expect(backend.getCursor().y).toBe(2)
      expect(backend.getCursor().x).toBe(9) // x unchanged
      backend.destroy()
    })

    test("CUU clamps at top of screen", () => {
      const backend = createVt100Backend({ cols: 80, rows: 24 })
      backend.feed(new TextEncoder().encode("\x1b[3;1H")) // row 2
      backend.feed(new TextEncoder().encode("\x1b[100A")) // up 100
      expect(backend.getCursor().y).toBe(0) // clamped at 0
      backend.destroy()
    })

    test("CUD clamps at bottom of screen", () => {
      const backend = createVt100Backend({ cols: 80, rows: 10 })
      backend.feed(new TextEncoder().encode("\x1b[5;1H")) // row 4
      backend.feed(new TextEncoder().encode("\x1b[100B")) // down 100
      expect(backend.getCursor().y).toBe(9) // clamped at rows-1
      backend.destroy()
    })

    test("CUF clamps at right edge", () => {
      const backend = createVt100Backend({ cols: 20, rows: 5 })
      backend.feed(new TextEncoder().encode("\x1b[1;1H"))
      backend.feed(new TextEncoder().encode("\x1b[100C")) // right 100
      expect(backend.getCursor().x).toBe(19) // clamped at cols-1
      backend.destroy()
    })

    test("CUB clamps at left edge", () => {
      const backend = createVt100Backend({ cols: 80, rows: 24 })
      backend.feed(new TextEncoder().encode("\x1b[1;5H")) // col 4
      backend.feed(new TextEncoder().encode("\x1b[100D")) // left 100
      expect(backend.getCursor().x).toBe(0) // clamped at 0
      backend.destroy()
    })

    test("CUU/CUD default to 1 when no parameter given", () => {
      const backend = createVt100Backend({ cols: 80, rows: 24 })
      backend.feed(new TextEncoder().encode("\x1b[5;5H")) // row 4, col 4
      backend.feed(new TextEncoder().encode("\x1b[A")) // up 1
      expect(backend.getCursor().y).toBe(3)
      backend.feed(new TextEncoder().encode("\x1b[B")) // down 1
      expect(backend.getCursor().y).toBe(4)
      backend.feed(new TextEncoder().encode("\x1b[C")) // right 1
      expect(backend.getCursor().x).toBe(5)
      backend.feed(new TextEncoder().encode("\x1b[D")) // left 1
      expect(backend.getCursor().x).toBe(4)
      backend.destroy()
    })
  })

  // ── Save/restore cursor ──

  describe("save/restore cursor", () => {
    test("DECSC/DECRC saves and restores cursor position", () => {
      const backend = createVt100Backend({ cols: 80, rows: 24 })
      // Move cursor to a specific position
      backend.feed(new TextEncoder().encode("\x1b[10;20H")) // row 9, col 19
      expect(backend.getCursor().x).toBe(19)
      expect(backend.getCursor().y).toBe(9)

      // Save cursor (ESC 7)
      backend.feed(new TextEncoder().encode("\x1b7"))

      // Move cursor elsewhere
      backend.feed(new TextEncoder().encode("\x1b[1;1H")) // row 0, col 0
      expect(backend.getCursor().x).toBe(0)
      expect(backend.getCursor().y).toBe(0)

      // Restore cursor (ESC 8)
      backend.feed(new TextEncoder().encode("\x1b8"))
      expect(backend.getCursor().x).toBe(19)
      expect(backend.getCursor().y).toBe(9)
      backend.destroy()
    })

    test("CSI s / CSI u saves and restores cursor position", () => {
      const backend = createVt100Backend({ cols: 80, rows: 24 })
      backend.feed(new TextEncoder().encode("\x1b[5;15H")) // row 4, col 14
      expect(backend.getCursor().x).toBe(14)
      expect(backend.getCursor().y).toBe(4)

      // Save cursor (CSI s)
      backend.feed(new TextEncoder().encode("\x1b[s"))

      // Move cursor elsewhere
      backend.feed(new TextEncoder().encode("\x1b[20;60H"))
      expect(backend.getCursor().x).toBe(59)
      expect(backend.getCursor().y).toBe(19)

      // Restore cursor (CSI u)
      backend.feed(new TextEncoder().encode("\x1b[u"))
      expect(backend.getCursor().x).toBe(14)
      expect(backend.getCursor().y).toBe(4)
      backend.destroy()
    })

    test("restore cursor clamps to screen bounds after resize", () => {
      const backend = createVt100Backend({ cols: 80, rows: 24 })
      // Save cursor at a far position
      backend.feed(new TextEncoder().encode("\x1b[20;70H"))
      backend.feed(new TextEncoder().encode("\x1b7"))

      // Resize to smaller
      backend.resize(40, 10)

      // Restore — should clamp
      backend.feed(new TextEncoder().encode("\x1b8"))
      expect(backend.getCursor().x).toBeLessThan(40)
      expect(backend.getCursor().y).toBeLessThan(10)
      backend.destroy()
    })
  })

  // ── Insert/delete characters ──

  describe("insert/delete characters", () => {
    test("DCH deletes characters at cursor position", () => {
      const backend = createVt100Backend({ cols: 10, rows: 3 })
      backend.feed(new TextEncoder().encode("ABCDE"))

      // Move cursor to col 1 (B)
      backend.feed(new TextEncoder().encode("\x1b[1;2H"))
      // Delete 2 characters (CSI 2 P)
      backend.feed(new TextEncoder().encode("\x1b[2P"))

      // Row should now be: A D E _ _ ...
      const line = backend.getLine(0)
      expect(line[0]!.char).toBe("A")
      expect(line[1]!.char).toBe("D")
      expect(line[2]!.char).toBe("E")
      // Remaining should be blank
      expect(line[3]!.char).toBe("")
      expect(line[4]!.char).toBe("")
      backend.destroy()
    })

    test("ICH inserts blank characters at cursor position", () => {
      const backend = createVt100Backend({ cols: 10, rows: 3 })
      backend.feed(new TextEncoder().encode("ABCDE"))

      // Move cursor to col 2 (C)
      backend.feed(new TextEncoder().encode("\x1b[1;3H"))
      // Insert 2 blank characters (CSI 2 @)
      backend.feed(new TextEncoder().encode("\x1b[2@"))

      // Row should now be: A B _ _ C D E _ _ _
      const line = backend.getLine(0)
      expect(line[0]!.char).toBe("A")
      expect(line[1]!.char).toBe("B")
      expect(line[2]!.char).toBe("") // inserted blank
      expect(line[3]!.char).toBe("") // inserted blank
      expect(line[4]!.char).toBe("C")
      expect(line[5]!.char).toBe("D")
      expect(line[6]!.char).toBe("E")
      backend.destroy()
    })

    test("DCH at end of line deletes remaining chars", () => {
      const backend = createVt100Backend({ cols: 10, rows: 3 })
      backend.feed(new TextEncoder().encode("ABCDE"))
      // Move to col 3 (D)
      backend.feed(new TextEncoder().encode("\x1b[1;4H"))
      // Delete 5 chars (more than remaining)
      backend.feed(new TextEncoder().encode("\x1b[5P"))
      const line = backend.getLine(0)
      expect(line[0]!.char).toBe("A")
      expect(line[1]!.char).toBe("B")
      expect(line[2]!.char).toBe("C")
      // D and E should be gone, replaced by blanks
      expect(line[3]!.char).toBe("")
      backend.destroy()
    })

    test("ICH shifts characters off the right edge", () => {
      const backend = createVt100Backend({ cols: 5, rows: 1 })
      backend.feed(new TextEncoder().encode("ABCDE"))
      // Move to col 0
      backend.feed(new TextEncoder().encode("\x1b[1;1H"))
      // Insert 2 blanks
      backend.feed(new TextEncoder().encode("\x1b[2@"))
      // Row should be: _ _ A B C (D and E pushed off)
      const line = backend.getLine(0)
      expect(line[0]!.char).toBe("")
      expect(line[1]!.char).toBe("")
      expect(line[2]!.char).toBe("A")
      expect(line[3]!.char).toBe("B")
      expect(line[4]!.char).toBe("C")
      backend.destroy()
    })
  })

  // ── Insert/delete lines ──

  describe("insert/delete lines", () => {
    test("IL inserts a blank line at cursor, pushes content down", () => {
      const backend = createVt100Backend({ cols: 10, rows: 5 })
      const enc = (s: string) => new TextEncoder().encode(s)

      backend.feed(enc("LINE0\r\n"))
      backend.feed(enc("LINE1\r\n"))
      backend.feed(enc("LINE2\r\n"))
      backend.feed(enc("LINE3\r\n"))
      backend.feed(enc("LINE4"))

      // Move cursor to row 1
      backend.feed(enc("\x1b[2;1H"))
      // Insert 1 line (CSI L)
      backend.feed(enc("\x1b[L"))

      // Row 0 should still be LINE0
      const line0 = backend.getLine(0)
      expect(line0[0]!.char).toBe("L")
      expect(line0[1]!.char).toBe("I")
      expect(line0[2]!.char).toBe("N")
      expect(line0[3]!.char).toBe("E")
      expect(line0[4]!.char).toBe("0")

      // Row 1 should be blank (inserted)
      const line1 = backend.getLine(1)
      expect(line1[0]!.char).toBe("")

      // Row 2 should now have LINE1 (pushed down from row 1)
      const line2 = backend.getLine(2)
      expect(line2[0]!.char).toBe("L")
      expect(line2[1]!.char).toBe("I")
      expect(line2[2]!.char).toBe("N")
      expect(line2[3]!.char).toBe("E")
      expect(line2[4]!.char).toBe("1")
      backend.destroy()
    })

    test("DL deletes line at cursor, pulls content up", () => {
      const backend = createVt100Backend({ cols: 10, rows: 5 })
      const enc = (s: string) => new TextEncoder().encode(s)

      backend.feed(enc("LINE0\r\n"))
      backend.feed(enc("LINE1\r\n"))
      backend.feed(enc("LINE2\r\n"))
      backend.feed(enc("LINE3\r\n"))
      backend.feed(enc("LINE4"))

      // Move cursor to row 1
      backend.feed(enc("\x1b[2;1H"))
      // Delete 1 line (CSI M)
      backend.feed(enc("\x1b[M"))

      // Row 0 should still be LINE0
      const line0 = backend.getLine(0)
      expect(line0[0]!.char).toBe("L")
      expect(line0[4]!.char).toBe("0")

      // Row 1 should now have LINE2 (pulled up)
      const line1 = backend.getLine(1)
      expect(line1[0]!.char).toBe("L")
      expect(line1[4]!.char).toBe("2")

      // Last row should be blank (new row pushed in from bottom)
      const lastLine = backend.getLine(4)
      expect(lastLine[0]!.char).toBe("")
      backend.destroy()
    })

    test("IL with count inserts multiple lines", () => {
      const backend = createVt100Backend({ cols: 10, rows: 5 })
      const enc = (s: string) => new TextEncoder().encode(s)

      backend.feed(enc("LINE0\r\n"))
      backend.feed(enc("LINE1\r\n"))
      backend.feed(enc("LINE2\r\n"))
      backend.feed(enc("LINE3\r\n"))
      backend.feed(enc("LINE4"))

      // Move to row 1, insert 2 lines
      backend.feed(enc("\x1b[2;1H"))
      backend.feed(enc("\x1b[2L"))

      // Row 0: LINE0 (unchanged)
      expect(backend.getLine(0)[4]!.char).toBe("0")
      // Row 1: blank (inserted)
      expect(backend.getLine(1)[0]!.char).toBe("")
      // Row 2: blank (inserted)
      expect(backend.getLine(2)[0]!.char).toBe("")
      // Row 3: LINE1 (pushed down from row 1)
      expect(backend.getLine(3)[4]!.char).toBe("1")
      backend.destroy()
    })

    test("DL with count deletes multiple lines", () => {
      const backend = createVt100Backend({ cols: 10, rows: 5 })
      const enc = (s: string) => new TextEncoder().encode(s)

      backend.feed(enc("LINE0\r\n"))
      backend.feed(enc("LINE1\r\n"))
      backend.feed(enc("LINE2\r\n"))
      backend.feed(enc("LINE3\r\n"))
      backend.feed(enc("LINE4"))

      // Move to row 1, delete 2 lines
      backend.feed(enc("\x1b[2;1H"))
      backend.feed(enc("\x1b[2M"))

      // Row 0: LINE0 (unchanged)
      expect(backend.getLine(0)[4]!.char).toBe("0")
      // Row 1: LINE3 (pulled up past deleted LINE1 and LINE2)
      expect(backend.getLine(1)[4]!.char).toBe("3")
      // Row 2: LINE4 (pulled up)
      expect(backend.getLine(2)[4]!.char).toBe("4")
      // Row 3 and 4: blank
      expect(backend.getLine(3)[0]!.char).toBe("")
      expect(backend.getLine(4)[0]!.char).toBe("")
      backend.destroy()
    })
  })

  // ── scrollViewport() ──

  describe("scrollViewport", () => {
    test("scrollViewport changes viewportOffset after scrollback exists", () => {
      const backend = createVt100Backend({ cols: 10, rows: 3 })

      // Generate scrollback
      for (let i = 0; i < 10; i++) {
        backend.feed(new TextEncoder().encode(`line${i}\r\n`))
      }

      const initial = backend.getScrollback()
      expect(initial.viewportOffset).toBe(0)

      // Scroll up (positive delta)
      backend.scrollViewport(3)
      expect(backend.getScrollback().viewportOffset).toBe(3)

      // Scroll down (negative delta)
      backend.scrollViewport(-1)
      expect(backend.getScrollback().viewportOffset).toBe(2)
      backend.destroy()
    })

    test("scrollViewport clamps at 0 (bottom)", () => {
      const backend = createVt100Backend({ cols: 10, rows: 3 })

      // Generate some scrollback
      for (let i = 0; i < 10; i++) {
        backend.feed(new TextEncoder().encode(`line${i}\r\n`))
      }

      // Try to scroll past bottom
      backend.scrollViewport(-100)
      expect(backend.getScrollback().viewportOffset).toBe(0)
      backend.destroy()
    })

    test("scrollViewport clamps at max scrollback length", () => {
      const backend = createVt100Backend({ cols: 10, rows: 3, scrollbackLimit: 5 })

      // Generate scrollback
      for (let i = 0; i < 10; i++) {
        backend.feed(new TextEncoder().encode(`line${i}\r\n`))
      }

      // Try to scroll way past top
      backend.scrollViewport(1000)
      const sb = backend.getScrollback()
      // viewportOffset should be clamped at scrollback length
      expect(sb.viewportOffset).toBeLessThanOrEqual(sb.totalLines - sb.screenLines)
      expect(sb.viewportOffset).toBeGreaterThan(0)
      backend.destroy()
    })

    test("scrollViewport with no scrollback stays at 0", () => {
      const backend = createVt100Backend({ cols: 80, rows: 24 })
      backend.feed(new TextEncoder().encode("hello"))
      backend.scrollViewport(5)
      // No scrollback means 0 is max
      expect(backend.getScrollback().viewportOffset).toBe(0)
      backend.destroy()
    })
  })

  // ── resize() content preservation ──

  describe("resize content preservation", () => {
    test("resize preserves existing text", () => {
      const backend = createVt100Backend({ cols: 20, rows: 5 })
      backend.feed(new TextEncoder().encode("hello world"))
      backend.feed(new TextEncoder().encode("\r\nsecond line"))

      // Resize larger
      backend.resize(40, 10)
      const text = backend.getText()
      expect(text).toContain("hello world")
      expect(text).toContain("second line")
      backend.destroy()
    })

    test("resize smaller preserves visible text within new bounds", () => {
      const backend = createVt100Backend({ cols: 20, rows: 5 })
      backend.feed(new TextEncoder().encode("ABCDEFGHIJ"))
      backend.feed(new TextEncoder().encode("\r\nLINE2"))

      // Resize to fewer cols
      backend.resize(5, 5)
      // First 5 chars should still be there
      const line = backend.getLine(0)
      expect(line[0]!.char).toBe("A")
      expect(line[1]!.char).toBe("B")
      expect(line[2]!.char).toBe("C")
      expect(line[3]!.char).toBe("D")
      expect(line[4]!.char).toBe("E")
      backend.destroy()
    })

    test("resize clamps cursor position", () => {
      const backend = createVt100Backend({ cols: 80, rows: 24 })
      // Move cursor to far position
      backend.feed(new TextEncoder().encode("\x1b[20;70H"))
      expect(backend.getCursor().x).toBe(69)
      expect(backend.getCursor().y).toBe(19)

      // Resize to smaller
      backend.resize(10, 5)
      expect(backend.getCursor().x).toBeLessThan(10)
      expect(backend.getCursor().y).toBeLessThan(5)
      backend.destroy()
    })

    test("resize resets scroll region", () => {
      const backend = createVt100Backend({ cols: 80, rows: 10 })
      // Set a scroll region
      backend.feed(new TextEncoder().encode("\x1b[3;7r"))
      // Resize
      backend.resize(80, 20)
      // Scroll region should be reset to full screen
      // Verify by writing enough lines to fill screen — should scroll normally
      for (let i = 0; i < 25; i++) {
        backend.feed(new TextEncoder().encode(`line${i}\r\n`))
      }
      // Should not crash, and last lines should be visible
      const text = backend.getText()
      expect(text).toContain("line24")
      backend.destroy()
    })
  })

  // ── Negative/edge cases ──

  describe("negative and edge cases", () => {
    test("empty input to feed() does nothing", () => {
      const backend = createVt100Backend({ cols: 80, rows: 24 })
      backend.feed(new Uint8Array(0))
      expect(backend.getText().trim()).toBe("")
      expect(backend.getCursor().x).toBe(0)
      expect(backend.getCursor().y).toBe(0)
      backend.destroy()
    })

    test("malformed escape sequence is ignored gracefully", () => {
      const backend = createVt100Backend({ cols: 80, rows: 24 })
      // ESC followed by an invalid char — should return to ground state
      backend.feed(new TextEncoder().encode("\x1b!hello"))
      // The "hello" after the malformed escape should still render
      // (ESC ! is unknown, parser returns to ground, then processes remaining chars)
      const text = backend.getText()
      expect(text).toContain("hello")
      backend.destroy()
    })

    test("incomplete CSI sequence followed by text", () => {
      const backend = createVt100Backend({ cols: 80, rows: 24 })
      // Start a CSI but then feed a regular printable (which is the final byte)
      backend.feed(new TextEncoder().encode("\x1b[m"))
      // ESC [ m is actually a valid SGR reset — but let's test with truly incomplete:
      // Feed CSI with just params, then a final byte in a separate feed
      backend.feed(new TextEncoder().encode("\x1b[31"))
      // Now the parser is in CSI state waiting for final byte
      backend.feed(new TextEncoder().encode("mRedText\x1b[0m"))
      const cell = backend.getCell(0, 0)
      expect(cell.char).toBe("R")
      expect(cell.fg).not.toBeNull()
      expect(cell.fg!.r).toBe(0x80)
      backend.destroy()
    })

    test("getCell with out-of-bounds returns empty cell", () => {
      const backend = createVt100Backend({ cols: 10, rows: 5 })
      // Column beyond bounds
      const cell = backend.getCell(0, 100)
      expect(cell.char).toBe("")
      expect(cell.fg).toBeNull()
      // Row beyond bounds
      const cell2 = backend.getCell(100, 0)
      expect(cell2.char).toBe("")
      backend.destroy()
    })

    test("CUP with row/col of 0 is treated as 1 (1-based minimum)", () => {
      const backend = createVt100Backend({ cols: 80, rows: 24 })
      // CSI 0;0 H — params are 0, which should be treated as 1
      backend.feed(new TextEncoder().encode("\x1b[0;0H"))
      expect(backend.getCursor().x).toBe(0) // (1-1 = 0)
      expect(backend.getCursor().y).toBe(0) // (1-1 = 0)
      backend.destroy()
    })

    test("CHA with 0 parameter treated as column 1", () => {
      const backend = createVt100Backend({ cols: 80, rows: 24 })
      backend.feed(new TextEncoder().encode("\x1b[5;20H")) // move to col 19
      backend.feed(new TextEncoder().encode("\x1b[0G")) // CHA 0 -> treated as 1
      // 0 is parsed as 0, (0-1) = -1, clamped to 0
      expect(backend.getCursor().x).toBe(0)
      backend.destroy()
    })

    test("multiple resets don't cause errors", () => {
      const backend = createVt100Backend({ cols: 80, rows: 24 })
      backend.feed(new TextEncoder().encode("text"))
      backend.reset()
      backend.reset()
      backend.reset()
      expect(backend.getText().trim()).toBe("")
      backend.destroy()
    })

    test("feed after destroy throws", () => {
      const backend = createVt100Backend({ cols: 80, rows: 24 })
      backend.destroy()
      expect(() => backend.feed(new TextEncoder().encode("hello"))).toThrow()
    })

    test("very long line with autowrap fills multiple rows", () => {
      const backend = createVt100Backend({ cols: 5, rows: 4 })
      // 20 chars = 4 full rows
      backend.feed(new TextEncoder().encode("ABCDEFGHIJKLMNOPQRST"))
      // Row 0: ABCDE
      expect(backend.getLine(0)[0]!.char).toBe("A")
      expect(backend.getLine(0)[4]!.char).toBe("E")
      // Row 1: FGHIJ
      expect(backend.getLine(1)[0]!.char).toBe("F")
      expect(backend.getLine(1)[4]!.char).toBe("J")
      // Row 2: KLMNO
      expect(backend.getLine(2)[0]!.char).toBe("K")
      expect(backend.getLine(2)[4]!.char).toBe("O")
      // Row 3: PQRST
      expect(backend.getLine(3)[0]!.char).toBe("P")
      expect(backend.getLine(3)[4]!.char).toBe("T")
      backend.destroy()
    })

    test("NUL characters (0x00) are ignored", () => {
      const backend = createVt100Backend({ cols: 80, rows: 24 })
      backend.feed(new Uint8Array([0x00, 0x00, 0x00]))
      expect(backend.getText().trim()).toBe("")
      expect(backend.getCursor().x).toBe(0)
      backend.destroy()
    })

    test("BEL character (0x07) is silently consumed", () => {
      const backend = createVt100Backend({ cols: 80, rows: 24 })
      backend.feed(new TextEncoder().encode("A\x07B"))
      const text = backend.getText()
      expect(text).toContain("AB")
      backend.destroy()
    })

    test("backspace (0x08) moves cursor back", () => {
      const backend = createVt100Backend({ cols: 80, rows: 24 })
      backend.feed(new TextEncoder().encode("ABC\x08"))
      expect(backend.getCursor().x).toBe(2) // was at 3, back 1
      backend.destroy()
    })

    test("tab (0x09) moves cursor to next tab stop", () => {
      const backend = createVt100Backend({ cols: 80, rows: 24 })
      backend.feed(new TextEncoder().encode("AB\t"))
      // Tab stops are every 8 cols: from col 2, next is col 8
      expect(backend.getCursor().x).toBe(8)
      backend.destroy()
    })
  })
})
