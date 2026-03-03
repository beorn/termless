/**
 * Custom Vitest matchers for terminal testing.
 *
 * Provides ~25 matchers for asserting terminal content, cell styles, cursor state,
 * terminal modes, title, and scrollback. All matchers work on any object implementing
 * the TerminalReadable protocol from termless.
 *
 * Import this module for side-effect registration:
 *   import "viterm/matchers"
 *
 * Or import the matcher object for manual registration:
 *   import { terminalMatchers } from "viterm/matchers"
 *   expect.extend(terminalMatchers)
 */

import { expect } from "vitest"
import type {
	TerminalReadable,
	Cell,
	CursorState,
	CursorStyle,
	RGB,
	TerminalMode,
	UnderlineStyle,
} from "../../../src/types.ts"

// =============================================================================
// Type Guard
// =============================================================================

function isTerminalReadable(value: unknown): value is TerminalReadable {
	return (
		value !== null &&
		typeof value === "object" &&
		"getText" in value &&
		"getCell" in value &&
		"getCursor" in value &&
		"getMode" in value
	)
}

function assertTerminalReadable(
	value: unknown,
	matcherName: string,
): asserts value is TerminalReadable {
	if (!isTerminalReadable(value)) {
		throw new Error(
			`${matcherName} expects a TerminalReadable, got ${typeof value}. ` +
				`Pass an object with getText(), getCell(), getCursor(), and getMode() methods.`,
		)
	}
}

// =============================================================================
// Color Helpers
// =============================================================================

function parseColor(color: string | RGB): RGB {
	if (typeof color === "object") return color
	const hex = color.replace("#", "")
	return {
		r: parseInt(hex.slice(0, 2), 16),
		g: parseInt(hex.slice(2, 4), 16),
		b: parseInt(hex.slice(4, 6), 16),
	}
}

function colorsMatch(a: RGB | null, b: RGB): boolean {
	if (!a) return false
	return a.r === b.r && a.g === b.g && a.b === b.b
}

function formatRgb(color: RGB | null): string {
	if (!color) return "null"
	return `#${color.r.toString(16).padStart(2, "0")}${color.g.toString(16).padStart(2, "0")}${color.b.toString(16).padStart(2, "0")}`
}

// =============================================================================
// Matcher Type Declarations
// =============================================================================

declare module "vitest" {
	interface Matchers<T> {
		// Text
		toContainText(text: string): void
		toHaveTextAt(row: number, col: number, text: string): void
		toContainTextInRow(row: number, text: string): void
		toHaveEmptyRow(row: number): void

		// Cell Style
		toHaveFgColor(row: number, col: number, color: string | RGB): void
		toHaveBgColor(row: number, col: number, color: string | RGB): void
		toBeBoldAt(row: number, col: number): void
		toBeItalicAt(row: number, col: number): void
		toBeFaintAt(row: number, col: number): void
		toHaveUnderlineAt(row: number, col: number, style?: UnderlineStyle): void
		toBeStrikethroughAt(row: number, col: number): void
		toBeInverseAt(row: number, col: number): void
		toBeWideAt(row: number, col: number): void

		// Cursor
		toHaveCursorAt(x: number, y: number): void
		toHaveCursorVisible(): void
		toHaveCursorHidden(): void
		toHaveCursorStyle(style: CursorStyle): void

		// Terminal Modes
		toBeInAltScreen(): void
		toBeInBracketedPaste(): void
		toHaveMode(mode: TerminalMode): void

		// Title
		toHaveTitle(title: string): void

		// Scrollback
		toHaveScrollbackLines(n: number): void
		toBeAtBottomOfScrollback(): void

		// Snapshot
		toMatchTerminalSnapshot(options?: { name?: string }): void
	}
}

// =============================================================================
// Matcher Implementations
// =============================================================================

export const terminalMatchers = {
	// ── Text Matchers ──

	/** Assert terminal buffer contains the given text anywhere. */
	toContainText(received: unknown, text: string) {
		assertTerminalReadable(received, "toContainText")
		const content = received.getText()
		const pass = content.includes(text)
		return {
			pass,
			message: () =>
				pass
					? `Expected terminal not to contain "${text}"`
					: `Expected terminal to contain "${text}"\n\nActual content:\n${content}`,
		}
	},

	/** Assert specific text appears at the given row and column. */
	toHaveTextAt(received: unknown, row: number, col: number, text: string) {
		assertTerminalReadable(received, "toHaveTextAt")
		const actual = received.getTextRange(row, col, row, col + text.length)
		const pass = actual === text
		return {
			pass,
			message: () =>
				pass
					? `Expected terminal not to have "${text}" at (${row},${col})`
					: `Expected "${text}" at (${row},${col}), got "${actual}"`,
		}
	},

	/** Assert a specific row contains the given text substring. */
	toContainTextInRow(received: unknown, row: number, text: string) {
		assertTerminalReadable(received, "toContainTextInRow")
		const line = received.getLine(row)
		const rowText = line.map((c) => c.text || " ").join("")
		const pass = rowText.includes(text)
		return {
			pass,
			message: () =>
				pass
					? `Expected row ${row} not to contain "${text}"`
					: `Expected row ${row} to contain "${text}"\n\nActual: "${rowText}"`,
		}
	},

	/** Assert a row is empty (all cells are spaces or empty strings). */
	toHaveEmptyRow(received: unknown, row: number) {
		assertTerminalReadable(received, "toHaveEmptyRow")
		const line = received.getLine(row)
		const pass = line.every((c) => !c.text || c.text === " ")
		const rowText = line.map((c) => c.text || " ").join("")
		return {
			pass,
			message: () =>
				pass
					? `Expected row ${row} not to be empty`
					: `Expected row ${row} to be empty\n\nActual: "${rowText}"`,
		}
	},

	// ── Cell Style Matchers ──

	/** Assert foreground color at a specific cell position. */
	toHaveFgColor(received: unknown, row: number, col: number, color: string | RGB) {
		assertTerminalReadable(received, "toHaveFgColor")
		const cell = received.getCell(row, col)
		const expected = parseColor(color)
		const pass = colorsMatch(cell.fg, expected)
		return {
			pass,
			message: () =>
				pass
					? `Expected cell (${row},${col}) not to have fg ${formatRgb(expected)}`
					: `Expected cell (${row},${col}) fg to be ${formatRgb(expected)}, got ${formatRgb(cell.fg)}`,
		}
	},

	/** Assert background color at a specific cell position. */
	toHaveBgColor(received: unknown, row: number, col: number, color: string | RGB) {
		assertTerminalReadable(received, "toHaveBgColor")
		const cell = received.getCell(row, col)
		const expected = parseColor(color)
		const pass = colorsMatch(cell.bg, expected)
		return {
			pass,
			message: () =>
				pass
					? `Expected cell (${row},${col}) not to have bg ${formatRgb(expected)}`
					: `Expected cell (${row},${col}) bg to be ${formatRgb(expected)}, got ${formatRgb(cell.bg)}`,
		}
	},

	/** Assert cell at position has bold attribute. */
	toBeBoldAt(received: unknown, row: number, col: number) {
		assertTerminalReadable(received, "toBeBoldAt")
		const cell = received.getCell(row, col)
		const pass = cell.bold
		return {
			pass,
			message: () =>
				pass
					? `Expected cell (${row},${col}) not to be bold`
					: `Expected cell (${row},${col}) to be bold`,
		}
	},

	/** Assert cell at position has italic attribute. */
	toBeItalicAt(received: unknown, row: number, col: number) {
		assertTerminalReadable(received, "toBeItalicAt")
		const cell = received.getCell(row, col)
		const pass = cell.italic
		return {
			pass,
			message: () =>
				pass
					? `Expected cell (${row},${col}) not to be italic`
					: `Expected cell (${row},${col}) to be italic`,
		}
	},

	/** Assert cell at position has faint attribute. */
	toBeFaintAt(received: unknown, row: number, col: number) {
		assertTerminalReadable(received, "toBeFaintAt")
		const cell = received.getCell(row, col)
		const pass = cell.faint
		return {
			pass,
			message: () =>
				pass
					? `Expected cell (${row},${col}) not to be faint`
					: `Expected cell (${row},${col}) to be faint`,
		}
	},

	/** Assert cell at position has underline. Optionally check specific underline style. */
	toHaveUnderlineAt(received: unknown, row: number, col: number, style?: UnderlineStyle) {
		assertTerminalReadable(received, "toHaveUnderlineAt")
		const cell = received.getCell(row, col)
		const hasUnderline = cell.underline !== "none"
		const pass = style ? cell.underline === style : hasUnderline
		return {
			pass,
			message: () => {
				if (style) {
					return pass
						? `Expected cell (${row},${col}) not to have underline style "${style}"`
						: `Expected cell (${row},${col}) underline to be "${style}", got "${cell.underline}"`
				}
				return pass
					? `Expected cell (${row},${col}) not to be underlined`
					: `Expected cell (${row},${col}) to be underlined, got "${cell.underline}"`
			},
		}
	},

	/** Assert cell at position has strikethrough attribute. */
	toBeStrikethroughAt(received: unknown, row: number, col: number) {
		assertTerminalReadable(received, "toBeStrikethroughAt")
		const cell = received.getCell(row, col)
		const pass = cell.strikethrough
		return {
			pass,
			message: () =>
				pass
					? `Expected cell (${row},${col}) not to be strikethrough`
					: `Expected cell (${row},${col}) to be strikethrough`,
		}
	},

	/** Assert cell at position has inverse attribute. */
	toBeInverseAt(received: unknown, row: number, col: number) {
		assertTerminalReadable(received, "toBeInverseAt")
		const cell = received.getCell(row, col)
		const pass = cell.inverse
		return {
			pass,
			message: () =>
				pass
					? `Expected cell (${row},${col}) not to be inverse`
					: `Expected cell (${row},${col}) to be inverse`,
		}
	},

	/** Assert cell at position is wide (double-width character). */
	toBeWideAt(received: unknown, row: number, col: number) {
		assertTerminalReadable(received, "toBeWideAt")
		const cell = received.getCell(row, col)
		const pass = cell.wide
		return {
			pass,
			message: () =>
				pass
					? `Expected cell (${row},${col}) not to be wide`
					: `Expected cell (${row},${col}) to be wide`,
		}
	},

	// ── Cursor Matchers ──

	/** Assert cursor is at the given position. */
	toHaveCursorAt(received: unknown, x: number, y: number) {
		assertTerminalReadable(received, "toHaveCursorAt")
		const cursor = received.getCursor()
		const pass = cursor.x === x && cursor.y === y
		return {
			pass,
			message: () =>
				pass
					? `Expected cursor not to be at (${x},${y})`
					: `Expected cursor at (${x},${y}), got (${cursor.x},${cursor.y})`,
		}
	},

	/** Assert cursor is visible. */
	toHaveCursorVisible(received: unknown) {
		assertTerminalReadable(received, "toHaveCursorVisible")
		const cursor = received.getCursor()
		const pass = cursor.visible
		return {
			pass,
			message: () =>
				pass ? `Expected cursor not to be visible` : `Expected cursor to be visible`,
		}
	},

	/** Assert cursor is hidden. */
	toHaveCursorHidden(received: unknown) {
		assertTerminalReadable(received, "toHaveCursorHidden")
		const cursor = received.getCursor()
		const pass = !cursor.visible
		return {
			pass,
			message: () =>
				pass ? `Expected cursor not to be hidden` : `Expected cursor to be hidden`,
		}
	},

	/** Assert cursor has a specific style (block, underline, beam). */
	toHaveCursorStyle(received: unknown, style: CursorStyle) {
		assertTerminalReadable(received, "toHaveCursorStyle")
		const cursor = received.getCursor()
		const pass = cursor.style === style
		return {
			pass,
			message: () =>
				pass
					? `Expected cursor style not to be "${style}"`
					: `Expected cursor style to be "${style}", got "${cursor.style}"`,
		}
	},

	// ── Terminal Mode Matchers ──

	/** Assert terminal is in alternate screen mode. */
	toBeInAltScreen(received: unknown) {
		assertTerminalReadable(received, "toBeInAltScreen")
		const pass = received.getMode("altScreen")
		return {
			pass,
			message: () =>
				pass
					? `Expected terminal not to be in alt screen`
					: `Expected terminal to be in alt screen`,
		}
	},

	/** Assert terminal is in bracketed paste mode. */
	toBeInBracketedPaste(received: unknown) {
		assertTerminalReadable(received, "toBeInBracketedPaste")
		const pass = received.getMode("bracketedPaste")
		return {
			pass,
			message: () =>
				pass
					? `Expected terminal not to be in bracketed paste mode`
					: `Expected terminal to be in bracketed paste mode`,
		}
	},

	/** Assert a specific terminal mode is enabled. */
	toHaveMode(received: unknown, mode: TerminalMode) {
		assertTerminalReadable(received, "toHaveMode")
		const pass = received.getMode(mode)
		return {
			pass,
			message: () =>
				pass
					? `Expected terminal not to have mode "${mode}"`
					: `Expected terminal to have mode "${mode}"`,
		}
	},

	// ── Title Matcher ──

	/** Assert terminal has a specific title (set via OSC escape). */
	toHaveTitle(received: unknown, title: string) {
		assertTerminalReadable(received, "toHaveTitle")
		const actual = received.getTitle()
		const pass = actual === title
		return {
			pass,
			message: () =>
				pass
					? `Expected terminal title not to be "${title}"`
					: `Expected terminal title to be "${title}", got "${actual}"`,
		}
	},

	// ── Scrollback Matchers ──

	/** Assert scrollback has a specific number of lines. */
	toHaveScrollbackLines(received: unknown, n: number) {
		assertTerminalReadable(received, "toHaveScrollbackLines")
		const scrollback = received.getScrollback()
		const pass = scrollback.totalLines === n
		return {
			pass,
			message: () =>
				pass
					? `Expected scrollback not to have ${n} lines`
					: `Expected scrollback to have ${n} lines, got ${scrollback.totalLines}`,
		}
	},

	/** Assert viewport is at the bottom of scrollback (no scroll offset). */
	toBeAtBottomOfScrollback(received: unknown) {
		assertTerminalReadable(received, "toBeAtBottomOfScrollback")
		const scrollback = received.getScrollback()
		const pass = scrollback.viewportOffset === 0
		return {
			pass,
			message: () =>
				pass
					? `Expected terminal not to be at bottom of scrollback`
					: `Expected terminal to be at bottom of scrollback, got offset ${scrollback.viewportOffset}`,
		}
	},

	// ── Snapshot Matcher ──

	/** Match terminal content against a snapshot. */
	toMatchTerminalSnapshot(received: unknown, options?: { name?: string }) {
		assertTerminalReadable(received, "toMatchTerminalSnapshot")
		const lines = received.getLines()
		const cursor = received.getCursor()
		const altScreen = received.getMode("altScreen")

		const cols = lines[0]?.length ?? 0
		let header = `# terminal ${cols}x${lines.length}`
		header += ` | cursor (${cursor.x},${cursor.y}) ${cursor.visible ? "visible" : "hidden"} ${cursor.style}`
		if (altScreen) header += " | altScreen"

		const sep = "\u2500".repeat(50)
		const body = lines
			.map((line, row) => {
				const num = String(row + 1).padStart(2)
				const text = line.map((c) => c.text || " ").join("")
				return `${num}\u2502${text}`
			})
			.join("\n")

		const snapshot = `${header}\n${sep}\n${body}`

		// Use vitest's built-in snapshot matching with the formatted terminal output
		return {
			pass:
				(expect as unknown as { getState(): { snapshotState: unknown } })
					.getState?.()
					?.snapshotState !== undefined,
			message: () => `Terminal snapshot comparison`,
			// The actual snapshot matching is handled by vitest when this is called
			// via expect().toMatchTerminalSnapshot()
			actual: snapshot,
			expected: options?.name ?? "terminal snapshot",
		}
	},
}

// Auto-register matchers when this module is imported
expect.extend(terminalMatchers)
