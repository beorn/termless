/**
 * Pure TypeScript VT100 backend for termless.
 *
 * Wraps the internal screen emulator to implement the TerminalBackend interface.
 * Zero external dependencies — all VT100/ANSI parsing is done in pure TypeScript,
 * inspired by the Rust vt100 crate's design.
 */

import { createScreen, type Screen } from "./screen.ts"
import type {
	TerminalBackend,
	TerminalOptions,
	Cell,
	CursorState,
	KeyDescriptor,
	TerminalMode,
	ScrollbackState,
	TerminalCapabilities,
	UnderlineStyle,
} from "../../../src/types.ts"

// ═══════════════════════════════════════════════════════
// Key encoding (same as xterm/ghostty backends)
// ═══════════════════════════════════════════════════════

const SPECIAL_KEYS: Record<string, string> = {
	ArrowUp: "\x1b[A",
	ArrowDown: "\x1b[B",
	ArrowRight: "\x1b[C",
	ArrowLeft: "\x1b[D",
	Home: "\x1b[H",
	End: "\x1b[F",
	PageUp: "\x1b[5~",
	PageDown: "\x1b[6~",
	Insert: "\x1b[2~",
	Delete: "\x1b[3~",
	Enter: "\r",
	Tab: "\t",
	Backspace: "\x7f",
	Escape: "\x1b",
	Space: " ",
	F1: "\x1bOP",
	F2: "\x1bOQ",
	F3: "\x1bOR",
	F4: "\x1bOS",
	F5: "\x1b[15~",
	F6: "\x1b[17~",
	F7: "\x1b[18~",
	F8: "\x1b[19~",
	F9: "\x1b[20~",
	F10: "\x1b[21~",
	F11: "\x1b[23~",
	F12: "\x1b[24~",
}

const CSI_KEYS: Record<string, { code: string; suffix: string }> = {
	ArrowUp: { code: "1", suffix: "A" },
	ArrowDown: { code: "1", suffix: "B" },
	ArrowRight: { code: "1", suffix: "C" },
	ArrowLeft: { code: "1", suffix: "D" },
	Home: { code: "1", suffix: "H" },
	End: { code: "1", suffix: "F" },
	PageUp: { code: "5", suffix: "~" },
	PageDown: { code: "6", suffix: "~" },
	Insert: { code: "2", suffix: "~" },
	Delete: { code: "3", suffix: "~" },
	F1: { code: "1", suffix: "P" },
	F2: { code: "1", suffix: "Q" },
	F3: { code: "1", suffix: "R" },
	F4: { code: "1", suffix: "S" },
	F5: { code: "15", suffix: "~" },
	F6: { code: "17", suffix: "~" },
	F7: { code: "18", suffix: "~" },
	F8: { code: "19", suffix: "~" },
	F9: { code: "20", suffix: "~" },
	F10: { code: "21", suffix: "~" },
	F11: { code: "23", suffix: "~" },
	F12: { code: "24", suffix: "~" },
}

function modifierParam(key: KeyDescriptor): number {
	let bits = 0
	if (key.shift) bits |= 1
	if (key.alt) bits |= 2
	if (key.ctrl) bits |= 4
	return bits + 1
}

function encodeKeyToAnsi(key: KeyDescriptor): Uint8Array {
	const hasModifier = key.shift || key.alt || key.ctrl

	if (key.ctrl && !key.alt && !key.shift && key.key.length === 1) {
		const code = key.key.toLowerCase().charCodeAt(0) - 96
		if (code >= 1 && code <= 26) {
			return new Uint8Array([code])
		}
	}

	if (key.alt && !key.ctrl && !key.shift && key.key.length === 1) {
		return new TextEncoder().encode(`\x1b${key.key}`)
	}

	if (hasModifier && key.key in CSI_KEYS) {
		const csi = CSI_KEYS[key.key]!
		const mod = modifierParam(key)
		return new TextEncoder().encode(`\x1b[${csi.code};${mod}${csi.suffix}`)
	}

	if (key.key in SPECIAL_KEYS) {
		return new TextEncoder().encode(SPECIAL_KEYS[key.key]!)
	}

	return new TextEncoder().encode(key.key)
}

// ═══════════════════════════════════════════════════════
// Backend factory
// ═══════════════════════════════════════════════════════

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

/**
 * Create a pure TypeScript VT100 backend for termless.
 *
 * This is a lightweight, zero-dependency terminal emulator inspired by
 * the Rust vt100 crate. It parses ANSI/VT100 escape sequences and
 * maintains an in-memory screen representation with per-cell attributes.
 *
 * Supports: SGR (16/256/truecolor), cursor movement, erase commands,
 * scroll regions, alternate screen, bracketed paste, mouse tracking,
 * OSC title, and more.
 */
export function createVt100Backend(opts?: Partial<TerminalOptions>): TerminalBackend {
	let screen: Screen | null = null

	function ensureScreen(): Screen {
		if (!screen) throw new Error("vt100 backend not initialized — call init() first")
		return screen
	}

	function init(options: TerminalOptions): void {
		screen = createScreen({
			cols: options.cols,
			rows: options.rows,
			scrollbackLimit: options.scrollbackLimit ?? 1000,
		})
	}

	// Eagerly init if opts provided
	if (opts) {
		init({
			cols: opts.cols ?? DEFAULT_COLS,
			rows: opts.rows ?? DEFAULT_ROWS,
			scrollbackLimit: opts.scrollbackLimit,
		})
	}

	function destroy(): void {
		screen = null
	}

	function feed(data: Uint8Array): void {
		ensureScreen().process(data)
	}

	function resize(cols: number, rows: number): void {
		ensureScreen().resize(cols, rows)
	}

	function reset(): void {
		ensureScreen().reset()
	}

	function getText(): string {
		return ensureScreen().getText()
	}

	function getTextRange(startRow: number, startCol: number, endRow: number, endCol: number): string {
		return ensureScreen().getTextRange(startRow, startCol, endRow, endCol)
	}

	function getCell(row: number, col: number): Cell {
		const sc = ensureScreen().getCell(row, col)
		return {
			text: sc.char,
			fg: sc.fg,
			bg: sc.bg,
			bold: sc.bold,
			faint: sc.faint,
			italic: sc.italic,
			underline: (sc.underline ? "single" : "none") as UnderlineStyle,
			strikethrough: sc.strikethrough,
			inverse: sc.inverse,
			wide: sc.wide,
		}
	}

	function getLine(row: number): Cell[] {
		return ensureScreen()
			.getLine(row)
			.map((sc) => ({
				text: sc.char,
				fg: sc.fg,
				bg: sc.bg,
				bold: sc.bold,
				faint: sc.faint,
				italic: sc.italic,
				underline: (sc.underline ? "single" : "none") as UnderlineStyle,
				strikethrough: sc.strikethrough,
				inverse: sc.inverse,
				wide: sc.wide,
			}))
	}

	function getLines(): Cell[][] {
		const s = ensureScreen()
		const result: Cell[][] = []
		for (let row = 0; row < s.rows; row++) {
			result.push(getLine(row))
		}
		return result
	}

	function getCursor(): CursorState {
		const s = ensureScreen()
		const pos = s.getCursorPosition()
		return {
			x: pos.x,
			y: pos.y,
			visible: s.getCursorVisible(),
			style: "block",
		}
	}

	function getMode(mode: TerminalMode): boolean {
		return ensureScreen().getMode(mode)
	}

	function getTitle(): string {
		return ensureScreen().getTitle()
	}

	function getScrollback(): ScrollbackState {
		const s = ensureScreen()
		return {
			viewportOffset: s.getViewportOffset(),
			totalLines: s.getScrollbackLength() + s.rows,
			screenLines: s.rows,
		}
	}

	function scrollViewport(delta: number): void {
		ensureScreen().scrollViewport(delta)
	}

	const capabilities: TerminalCapabilities = {
		name: "vt100",
		version: "0.1.0",
		truecolor: true,
		kittyKeyboard: false,
		kittyGraphics: false,
		sixel: false,
		osc8Hyperlinks: false,
		semanticPrompts: false,
		unicode: "15.1",
		reflow: false, // No reflow support in pure TS implementation
		extensions: new Set(),
	}

	return {
		name: "vt100",
		init,
		destroy,
		feed,
		resize,
		reset,
		getText,
		getTextRange,
		getCell,
		getLine,
		getLines,
		getCursor,
		getMode,
		getTitle,
		getScrollback,
		scrollViewport,
		encodeKey: encodeKeyToAnsi,
		capabilities,
	}
}
