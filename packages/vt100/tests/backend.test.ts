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
		expect(cell.text).toBe("R")
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
		expect(cell.text).toBe("G")
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
		expect(cell.text).toBe("X")
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
		expect(cell.text).toBe("T")
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
		expect(cell.text).toBe("h")
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
		expect(cell.faint).toBe(true)
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
		expect(cell.text).toBe("\u5927")
		expect(cell.wide).toBe(true)
		// Spacer cell after wide character
		const spacer = backend.getCell(0, 1)
		expect(spacer.text).toBe("")
		expect(spacer.wide).toBe(false)
		backend.destroy()
	})

	// ── getLine / getLines ──

	test("getLine returns cells for the row", () => {
		const backend = createVt100Backend({ cols: 10, rows: 5 })
		backend.feed(new TextEncoder().encode("abc"))
		const line = backend.getLine(0)
		expect(line).toHaveLength(10)
		expect(line[0]!.text).toBe("a")
		expect(line[1]!.text).toBe("b")
		expect(line[2]!.text).toBe("c")
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
		expect(cell.underline).toBe("none")
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
		expect(cell.text).toBe("X")
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
})
