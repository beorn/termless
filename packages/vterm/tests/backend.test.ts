import { describe, test, expect } from "vitest"
import { createVtermBackend } from "../src/backend.ts"

describe("createVtermBackend", () => {
  // ── Lifecycle ──

  test("creates backend with default options (80x24)", () => {
    const backend = createVtermBackend()
    backend.init({ cols: 80, rows: 24 })
    const cursor = backend.getCursor()
    expect(cursor.x).toBe(0)
    expect(cursor.y).toBe(0)
    const text = backend.getText()
    expect(text).toBeDefined()
    backend.destroy()
  })

  test("creates backend with custom cols/rows", () => {
    const backend = createVtermBackend({ cols: 120, rows: 40 })
    const scrollback = backend.getScrollback()
    expect(scrollback.screenLines).toBe(40)
    backend.destroy()
  })

  test("can be eagerly initialized via opts", () => {
    const backend = createVtermBackend({ cols: 60, rows: 20 })
    // Should work without calling init()
    expect(backend.getText()).toBeDefined()
    backend.destroy()
  })

  test("throws if not initialized", () => {
    const backend = createVtermBackend()
    expect(() => backend.getText()).toThrow("not initialized")
    backend.destroy()
  })

  // ── Text I/O ──

  test("feed plain text, getText() returns it", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("hello world"))
    const text = backend.getText()
    expect(text).toContain("hello world")
    backend.destroy()
  })

  test("feed multiline text", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("line1\r\nline2\r\nline3"))
    const text = backend.getText()
    expect(text).toContain("line1")
    expect(text).toContain("line2")
    expect(text).toContain("line3")
    backend.destroy()
  })

  // ── Colors ──

  test("feed ANSI color codes, getCell() has correct fg color", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
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
    const backend = createVtermBackend({ cols: 80, rows: 24 })
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
    const backend = createVtermBackend({ cols: 80, rows: 24 })
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
    const backend = createVtermBackend({ cols: 80, rows: 24 })
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
    const backend = createVtermBackend({ cols: 80, rows: 24 })
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
    const backend = createVtermBackend({ cols: 80, rows: 24 })
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
    const backend = createVtermBackend({ cols: 80, rows: 24 })
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
    const backend = createVtermBackend({ cols: 80, rows: 24 })
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
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("\x1b[3mitalic\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.italic).toBe(true)
    backend.destroy()
  })

  test("underline attribute detection", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("\x1b[4munderlined\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.underline).toBe("single")
    backend.destroy()
  })

  test("strikethrough attribute detection", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("\x1b[9mstruck\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.strikethrough).toBe(true)
    backend.destroy()
  })

  test("faint/dim attribute detection", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("\x1b[2mdim\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.dim).toBe(true)
    backend.destroy()
  })

  test("inverse attribute detection", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("\x1b[7minverse\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.inverse).toBe(true)
    backend.destroy()
  })

  // ── vterm-specific: blink ──

  test("blink attribute detection (SGR 5)", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("\x1b[5mblink\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.blink).toBe(true)
    // After reset
    const after = backend.getCell(0, 5)
    expect(after.blink).toBe(false)
    backend.destroy()
  })

  // ── vterm-specific: hidden ──

  test("hidden attribute detection (SGR 8)", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("\x1b[8mhidden\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.hidden).toBe(true)
    backend.destroy()
  })

  // ── vterm-specific: underline color ──

  test("underline color via SGR 58;2;R;G;B", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    // Set underline + underline color (red)
    backend.feed(new TextEncoder().encode("\x1b[4m\x1b[58;2;255;0;0mtext\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.underline).toBe("single")
    expect(cell.underlineColor).not.toBeNull()
    expect(cell.underlineColor!.r).toBe(255)
    expect(cell.underlineColor!.g).toBe(0)
    expect(cell.underlineColor!.b).toBe(0)
    backend.destroy()
  })

  // ── vterm-specific: underline styles ──

  test("double underline (SGR 21)", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("\x1b[21mdouble\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.underline).toBe("double")
    backend.destroy()
  })

  test("curly underline (SGR 4:3)", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("\x1b[4:3mcurly\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.underline).toBe("curly")
    backend.destroy()
  })

  test("dotted underline (SGR 4:4)", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("\x1b[4:4mdotted\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.underline).toBe("dotted")
    backend.destroy()
  })

  test("dashed underline (SGR 4:5)", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("\x1b[4:5mdashed\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.underline).toBe("dashed")
    backend.destroy()
  })

  // ── vterm-specific: cursor shape ──

  test("cursor shape defaults to block", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    expect(backend.getCursor().style).toBe("block")
    backend.destroy()
  })

  test("cursor shape changes to underline via DECSCUSR", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    // DECSCUSR 3 = blinking underline, DECSCUSR 4 = steady underline
    backend.feed(new TextEncoder().encode("\x1b[4 q"))
    expect(backend.getCursor().style).toBe("underline")
    backend.destroy()
  })

  test("cursor shape changes to beam via DECSCUSR", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    // DECSCUSR 5 = blinking bar, DECSCUSR 6 = steady bar
    backend.feed(new TextEncoder().encode("\x1b[6 q"))
    expect(backend.getCursor().style).toBe("beam")
    backend.destroy()
  })

  test("cursor shape resets to block via DECSCUSR 0 or 1 or 2", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    // Change to bar
    backend.feed(new TextEncoder().encode("\x1b[6 q"))
    expect(backend.getCursor().style).toBe("beam")
    // Reset to block (DECSCUSR 2 = steady block)
    backend.feed(new TextEncoder().encode("\x1b[2 q"))
    expect(backend.getCursor().style).toBe("block")
    backend.destroy()
  })

  // ── vterm-specific: hyperlinks ──

  test("OSC 8 hyperlinks are captured", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    // OSC 8 ; params ; URI ST ... OSC 8 ; ; ST
    backend.feed(new TextEncoder().encode("\x1b]8;;https://example.com\x1b\\link text\x1b]8;;\x1b\\"))
    const cell = backend.getCell(0, 0)
    expect(cell.char).toBe("l")
    expect(cell.hyperlink).toBe("https://example.com")
    // Cell after the hyperlink should not have a hyperlink
    const after = backend.getCell(0, 9)
    expect(after.hyperlink).toBeNull()
    backend.destroy()
  })

  test("hyperlinks with params are captured", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    // OSC 8 with id param
    backend.feed(new TextEncoder().encode("\x1b]8;id=test123;https://example.com/page\x07click\x1b]8;;\x07"))
    const cell = backend.getCell(0, 0)
    expect(cell.hyperlink).toBe("https://example.com/page")
    backend.destroy()
  })

  // ── Cursor ──

  test("cursor position updates after text feed", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("abc"))
    const cursor = backend.getCursor()
    expect(cursor.x).toBe(3)
    expect(cursor.y).toBe(0)
    expect(cursor.visible).toBe(true)
    expect(cursor.style).toBe("block")
    backend.destroy()
  })

  test("cursor moves to next line on newline", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("line1\r\n"))
    const cursor = backend.getCursor()
    expect(cursor.x).toBe(0)
    expect(cursor.y).toBe(1)
    backend.destroy()
  })

  test("cursor positioning via CSI H", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    // Move cursor to row 5, col 10 (1-based)
    backend.feed(new TextEncoder().encode("\x1b[5;10H"))
    const cursor = backend.getCursor()
    expect(cursor.x).toBe(9)
    expect(cursor.y).toBe(4)
    backend.destroy()
  })

  test("cursor visibility via DECTCEM", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
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
    const backend = createVtermBackend({ cols: 80, rows: 24 })
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
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    expect(backend.getMode("bracketedPaste")).toBe(false)
    backend.feed(new TextEncoder().encode("\x1b[?2004h"))
    expect(backend.getMode("bracketedPaste")).toBe(true)
    backend.destroy()
  })

  test("mouse tracking mode detection", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    expect(backend.getMode("mouseTracking")).toBe(false)
    // Enable VT200 mouse tracking
    backend.feed(new TextEncoder().encode("\x1b[?1000h"))
    expect(backend.getMode("mouseTracking")).toBe(true)
    backend.destroy()
  })

  test("autowrap mode detection", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    expect(backend.getMode("autoWrap")).toBe(true) // Default on
    backend.feed(new TextEncoder().encode("\x1b[?7l"))
    expect(backend.getMode("autoWrap")).toBe(false)
    backend.feed(new TextEncoder().encode("\x1b[?7h"))
    expect(backend.getMode("autoWrap")).toBe(true)
    backend.destroy()
  })

  // ── Resize ──

  test("resize() changes dimensions", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    backend.resize(120, 40)
    const scrollback = backend.getScrollback()
    expect(scrollback.screenLines).toBe(40)
    backend.destroy()
  })

  // ── Title ──

  test("title changes via OSC 2", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    expect(backend.getTitle()).toBe("")
    // OSC 2 ; title ST (using BEL as terminator)
    backend.feed(new TextEncoder().encode("\x1b]2;my terminal title\x07"))
    expect(backend.getTitle()).toBe("my terminal title")
    backend.destroy()
  })

  test("title changes via OSC 0", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("\x1b]0;window title\x07"))
    expect(backend.getTitle()).toBe("window title")
    backend.destroy()
  })

  test("title changes via OSC with ST terminator", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("\x1b]2;st title\x1b\\"))
    expect(backend.getTitle()).toBe("st title")
    backend.destroy()
  })

  // ── Reset ──

  test("reset() clears all content", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
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
    const backend = createVtermBackend({ cols: 80, rows: 24 })
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
    const backend = createVtermBackend({ cols: 10, rows: 5 })
    backend.feed(new TextEncoder().encode("abc"))
    const line = backend.getLine(0)
    expect(line).toHaveLength(10)
    expect(line[0]!.char).toBe("a")
    expect(line[1]!.char).toBe("b")
    expect(line[2]!.char).toBe("c")
    backend.destroy()
  })

  test("getLines returns all visible rows", () => {
    const backend = createVtermBackend({ cols: 10, rows: 5 })
    const lines = backend.getLines()
    expect(lines).toHaveLength(5)
    backend.destroy()
  })

  // ── getTextRange ──

  test("getTextRange returns text in range", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("hello world\r\nsecond line"))
    const range = backend.getTextRange(0, 6, 0, 11)
    expect(range).toBe("world")
    backend.destroy()
  })

  // ── Key encoding ──

  test("encodeKey returns correct ANSI for arrow keys", () => {
    const backend = createVtermBackend()
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
    const backend = createVtermBackend({ cols: 80, rows: 24 })

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
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    const altA = backend.encodeKey({ key: "a", alt: true })
    expect(altA).toEqual(new TextEncoder().encode("\x1ba"))
    backend.destroy()
  })

  test("encodeKey handles Shift+Arrow (CSI modifier encoding)", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    // Shift+Up = CSI 1;2 A
    const shiftUp = backend.encodeKey({ key: "ArrowUp", shift: true })
    expect(shiftUp).toEqual(new TextEncoder().encode("\x1b[1;2A"))
    backend.destroy()
  })

  test("encodeKey handles Ctrl+Shift+Arrow", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    // Ctrl+Shift = bits 5 (shift=1, ctrl=4) -> param = 6
    const ctrlShiftRight = backend.encodeKey({ key: "ArrowRight", ctrl: true, shift: true })
    expect(ctrlShiftRight).toEqual(new TextEncoder().encode("\x1b[1;6C"))
    backend.destroy()
  })

  test("encodeKey handles regular characters", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    const a = backend.encodeKey({ key: "a" })
    expect(a).toEqual(new TextEncoder().encode("a"))
    backend.destroy()
  })

  test("encodeKey handles Enter key", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    const enter = backend.encodeKey({ key: "Enter" })
    expect(enter).toEqual(new TextEncoder().encode("\r"))
    backend.destroy()
  })

  test("encodeKey handles function keys", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    const f1 = backend.encodeKey({ key: "F1" })
    expect(f1).toEqual(new TextEncoder().encode("\x1bOP"))

    const f5 = backend.encodeKey({ key: "F5" })
    expect(f5).toEqual(new TextEncoder().encode("\x1b[15~"))
    backend.destroy()
  })

  // ── Capabilities ──

  test("capabilities are correctly set", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    expect(backend.capabilities.name).toBe("vterm")
    expect(backend.capabilities.truecolor).toBe(true)
    expect(backend.capabilities.kittyKeyboard).toBe(false)
    expect(backend.capabilities.kittyGraphics).toBe(false)
    expect(backend.capabilities.sixel).toBe(false)
    expect(backend.capabilities.osc8Hyperlinks).toBe(true)
    expect(backend.capabilities.reflow).toBe(false)
    expect(backend.capabilities.extensions).toBeInstanceOf(Set)
    expect(backend.capabilities.extensions.size).toBe(0)
    backend.destroy()
  })

  // ── Backend name ──

  test("backend name is 'vterm'", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    expect(backend.name).toBe("vterm")
    backend.destroy()
  })

  // ── Scrollback ──

  test("getScrollback returns viewport state", () => {
    const backend = createVtermBackend({ cols: 80, rows: 5 })
    const state = backend.getScrollback()
    expect(state.screenLines).toBe(5)
    expect(state.viewportOffset).toBe(0)
    expect(state.totalLines).toBeGreaterThanOrEqual(5)
    backend.destroy()
  })

  // ── Default cell ──

  test("getCell on empty position returns default cell", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    const cell = backend.getCell(0, 0)
    expect(cell.fg).toBeNull()
    expect(cell.bg).toBeNull()
    expect(cell.bold).toBe(false)
    expect(cell.italic).toBe(false)
    expect(cell.underline).toBe(false)
    expect(cell.underlineColor).toBeNull()
    expect(cell.strikethrough).toBe(false)
    expect(cell.inverse).toBe(false)
    expect(cell.blink).toBe(false)
    expect(cell.hidden).toBe(false)
    expect(cell.wide).toBe(false)
    expect(cell.hyperlink).toBeNull()
    backend.destroy()
  })

  // ── Combined attributes ──

  test("combined bold + color attributes", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    // Bold + red foreground
    backend.feed(new TextEncoder().encode("\x1b[1;31mX\x1b[0m"))
    const cell = backend.getCell(0, 0)
    expect(cell.char).toBe("X")
    expect(cell.bold).toBe(true)
    expect(cell.fg).not.toBeNull()
    expect(cell.fg!.r).toBe(0x80)
    backend.destroy()
  })

  // ── Alternate screen buffer ──

  test("alternate screen preserves main screen content", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
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

  // ── Erase commands ──

  test("erase in display (ED mode 2)", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("hello"))
    // Erase entire display
    backend.feed(new TextEncoder().encode("\x1b[2J"))
    const text = backend.getText()
    expect(text.trim()).toBe("")
    backend.destroy()
  })

  test("erase in line (EL mode 0)", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
    backend.feed(new TextEncoder().encode("hello world"))
    // Move cursor to col 5, erase from cursor to end of line
    backend.feed(new TextEncoder().encode("\x1b[1;6H\x1b[K"))
    const text = backend.getText()
    expect(text).toContain("hello")
    expect(text).not.toContain("world")
    backend.destroy()
  })

  // ── Scrollback accumulation ──

  test("writing more lines than rows pushes old lines to scrollback", () => {
    const backend = createVtermBackend({ cols: 10, rows: 3 })

    // Write 10 lines into a 3-row terminal
    for (let i = 0; i < 10; i++) {
      backend.feed(new TextEncoder().encode(`line${i}\r\n`))
    }

    const scrollback = backend.getScrollback()
    expect(scrollback.totalLines).toBeGreaterThan(scrollback.screenLines)
    expect(scrollback.totalLines).toBeGreaterThanOrEqual(10)

    // vterm.js getText() returns screen content only (not scrollback)
    // Verify the most recent lines are visible on screen
    const text = backend.getText()
    expect(text).toContain("line9")
    backend.destroy()
  })

  // ── Cursor movement commands ──

  describe("cursor movement commands", () => {
    test("CUU (cursor up) moves cursor up", () => {
      const backend = createVtermBackend({ cols: 80, rows: 24 })
      backend.feed(new TextEncoder().encode("\x1b[10;10H")) // row 9, col 9
      backend.feed(new TextEncoder().encode("\x1b[3A")) // up 3
      expect(backend.getCursor().y).toBe(6)
      expect(backend.getCursor().x).toBe(9) // x unchanged
      backend.destroy()
    })

    test("CUD (cursor down) moves cursor down", () => {
      const backend = createVtermBackend({ cols: 80, rows: 24 })
      backend.feed(new TextEncoder().encode("\x1b[5;5H")) // row 4, col 4
      backend.feed(new TextEncoder().encode("\x1b[4B")) // down 4
      expect(backend.getCursor().y).toBe(8)
      expect(backend.getCursor().x).toBe(4) // x unchanged
      backend.destroy()
    })

    test("CUF (cursor forward) moves cursor right", () => {
      const backend = createVtermBackend({ cols: 80, rows: 24 })
      backend.feed(new TextEncoder().encode("\x1b[1;1H")) // row 0, col 0
      backend.feed(new TextEncoder().encode("\x1b[10C")) // right 10
      expect(backend.getCursor().x).toBe(10)
      expect(backend.getCursor().y).toBe(0) // y unchanged
      backend.destroy()
    })

    test("CUB (cursor back) moves cursor left", () => {
      const backend = createVtermBackend({ cols: 80, rows: 24 })
      backend.feed(new TextEncoder().encode("\x1b[1;20H")) // row 0, col 19
      backend.feed(new TextEncoder().encode("\x1b[5D")) // left 5
      expect(backend.getCursor().x).toBe(14)
      expect(backend.getCursor().y).toBe(0) // y unchanged
      backend.destroy()
    })
  })

  // ── Save/restore cursor ──

  test("DECSC/DECRC saves and restores cursor position", () => {
    const backend = createVtermBackend({ cols: 80, rows: 24 })
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
})
