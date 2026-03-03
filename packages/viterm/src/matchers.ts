/**
 * Custom Vitest matchers for terminal testing.
 *
 * Composable matchers that work with region selectors (RegionView, CellView)
 * and terminal-level queries (TerminalReadable). The composable pattern is:
 *
 *   expect(term.screen).toContainText("Hello")     // RegionView text matcher
 *   expect(term.cell(0, 0)).toBeBold()              // CellView style matcher
 *   expect(term).toHaveCursorAt(5, 10)              // Terminal matcher
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
	CursorStyle,
	RGB,
	TerminalMode,
	UnderlineStyle,
} from "../../../src/types.ts"

// =============================================================================
// Type Guards
// =============================================================================

function isRegionView(value: unknown): value is { getText(): string; getLines(): string[]; containsText(text: string): boolean } {
	return (
		value !== null &&
		typeof value === "object" &&
		"containsText" in value &&
		typeof (value as Record<string, unknown>).containsText === "function"
	)
}

function isCellView(value: unknown): value is {
	readonly text: string
	readonly row: number
	readonly col: number
	readonly fg: RGB | null
	readonly bg: RGB | null
	readonly bold: boolean
	readonly faint: boolean
	readonly italic: boolean
	readonly underline: UnderlineStyle
	readonly strikethrough: boolean
	readonly inverse: boolean
	readonly wide: boolean
} {
	return (
		value !== null &&
		typeof value === "object" &&
		"bold" in value &&
		"fg" in value &&
		"row" in value &&
		"col" in value
	)
}

function isTerminalReadable(value: unknown): value is TerminalReadable {
	return (
		value !== null &&
		typeof value === "object" &&
		"getCell" in value &&
		"getCursor" in value &&
		"getMode" in value
	)
}

function assertRegionView(
	value: unknown,
	matcherName: string,
): asserts value is { getText(): string; getLines(): string[]; containsText(text: string): boolean } {
	if (isRegionView(value)) return
	if (isTerminalReadable(value)) {
		throw new Error(
			`${matcherName} requires a region. Use term.screen, term.buffer, or term.scrollback. ` +
				`Example: expect(term.screen).${matcherName}(...)`,
		)
	}
	throw new Error(
		`${matcherName} requires a RegionView (an object with containsText, getText, getLines). ` +
			`Got ${typeof value}.`,
	)
}

function assertCellView(
	value: unknown,
	matcherName: string,
): asserts value is {
	readonly text: string
	readonly row: number
	readonly col: number
	readonly fg: RGB | null
	readonly bg: RGB | null
	readonly bold: boolean
	readonly faint: boolean
	readonly italic: boolean
	readonly underline: UnderlineStyle
	readonly strikethrough: boolean
	readonly inverse: boolean
	readonly wide: boolean
} {
	if (isCellView(value)) return
	throw new Error(
		`${matcherName} expects a CellView. Use term.cell(row, col). ` +
			`Example: expect(term.cell(0, 0)).${matcherName}()`,
	)
}

function assertTerminalReadable(
	value: unknown,
	matcherName: string,
): asserts value is TerminalReadable {
	if (isTerminalReadable(value)) return
	throw new Error(
		`${matcherName} expects a TerminalReadable, got ${typeof value}. ` +
			`Pass an object with getCell(), getCursor(), and getMode() methods.`,
	)
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
		// Text (RegionView)
		toContainText(text: string): void
		toHaveText(text: string): void
		toMatchLines(lines: string[]): void

		// Cell Style (CellView)
		toBeBold(): void
		toBeItalic(): void
		toBeFaint(): void
		toBeStrikethrough(): void
		toBeInverse(): void
		toBeWide(): void
		toHaveUnderline(style?: UnderlineStyle): void
		toHaveFg(color: string | RGB): void
		toHaveBg(color: string | RGB): void

		// Terminal (TerminalReadable)
		toHaveCursorAt(x: number, y: number): void
		toHaveCursorStyle(style: CursorStyle): void
		toHaveCursorVisible(): void
		toHaveCursorHidden(): void
		toBeInMode(mode: TerminalMode): void
		toHaveTitle(title: string): void
		toHaveScrollbackLines(n: number): void
		toBeAtBottomOfScrollback(): void

		// Snapshot (TerminalReadable)
		toMatchTerminalSnapshot(options?: { name?: string }): void
	}
}

// =============================================================================
// Matcher Implementations
// =============================================================================

export const terminalMatchers = {
	// ── Text Matchers (RegionView) ──

	/** Assert region contains the given text as a substring. */
	toContainText(received: unknown, text: string) {
		assertRegionView(received, "toContainText")
		const pass = received.containsText(text)
		const content = received.getText()
		return {
			pass,
			message: () =>
				pass
					? `Expected region not to contain "${text}"\n\nContent:\n${content}`
					: `Expected region to contain "${text}"\n\nContent:\n${content}`,
		}
	},

	/** Assert region text matches exactly after trimming. */
	toHaveText(received: unknown, text: string) {
		assertRegionView(received, "toHaveText")
		const actual = received.getText().trim()
		const pass = actual === text
		return {
			pass,
			message: () =>
				pass
					? `Expected region text not to be "${text}"`
					: `Expected region text to be "${text}"\n\nActual: "${actual}"`,
		}
	},

	/** Assert region lines match expected lines (trailing whitespace trimmed per line). */
	toMatchLines(received: unknown, expectedLines: string[]) {
		assertRegionView(received, "toMatchLines")
		const actualLines = received.getLines().map((l) => l.trimEnd())

		const maxLen = Math.max(actualLines.length, expectedLines.length)
		const mismatches: string[] = []
		for (let i = 0; i < maxLen; i++) {
			const actual = actualLines[i] ?? ""
			const expected = expectedLines[i] ?? ""
			if (actual !== expected) {
				mismatches.push(
					`  line ${i}: expected "${expected}" got "${actual}"`,
				)
			}
		}

		const pass = mismatches.length === 0
		return {
			pass,
			message: () =>
				pass
					? `Expected region lines not to match the given lines`
					: `Region line mismatch:\n${mismatches.join("\n")}`,
		}
	},

	// ── Cell Style Matchers (CellView) ──

	/** Assert cell is bold. */
	toBeBold(received: unknown) {
		assertCellView(received, "toBeBold")
		const pass = received.bold
		return {
			pass,
			message: () =>
				pass
					? `Expected cell (${received.row},${received.col}) containing '${received.text}' not to be bold`
					: `Expected cell (${received.row},${received.col}) containing '${received.text}' to be bold`,
		}
	},

	/** Assert cell is italic. */
	toBeItalic(received: unknown) {
		assertCellView(received, "toBeItalic")
		const pass = received.italic
		return {
			pass,
			message: () =>
				pass
					? `Expected cell (${received.row},${received.col}) containing '${received.text}' not to be italic`
					: `Expected cell (${received.row},${received.col}) containing '${received.text}' to be italic`,
		}
	},

	/** Assert cell is faint. */
	toBeFaint(received: unknown) {
		assertCellView(received, "toBeFaint")
		const pass = received.faint
		return {
			pass,
			message: () =>
				pass
					? `Expected cell (${received.row},${received.col}) containing '${received.text}' not to be faint`
					: `Expected cell (${received.row},${received.col}) containing '${received.text}' to be faint`,
		}
	},

	/** Assert cell has strikethrough. */
	toBeStrikethrough(received: unknown) {
		assertCellView(received, "toBeStrikethrough")
		const pass = received.strikethrough
		return {
			pass,
			message: () =>
				pass
					? `Expected cell (${received.row},${received.col}) containing '${received.text}' not to be strikethrough`
					: `Expected cell (${received.row},${received.col}) containing '${received.text}' to be strikethrough`,
		}
	},

	/** Assert cell has inverse video. */
	toBeInverse(received: unknown) {
		assertCellView(received, "toBeInverse")
		const pass = received.inverse
		return {
			pass,
			message: () =>
				pass
					? `Expected cell (${received.row},${received.col}) containing '${received.text}' not to be inverse`
					: `Expected cell (${received.row},${received.col}) containing '${received.text}' to be inverse`,
		}
	},

	/** Assert cell is wide (double-width character). */
	toBeWide(received: unknown) {
		assertCellView(received, "toBeWide")
		const pass = received.wide
		return {
			pass,
			message: () =>
				pass
					? `Expected cell (${received.row},${received.col}) containing '${received.text}' not to be wide`
					: `Expected cell (${received.row},${received.col}) containing '${received.text}' to be wide`,
		}
	},

	/** Assert cell has underline. Optionally check specific style. */
	toHaveUnderline(received: unknown, style?: UnderlineStyle) {
		assertCellView(received, "toHaveUnderline")
		const hasUnderline = received.underline !== "none"
		const pass = style ? received.underline === style : hasUnderline
		return {
			pass,
			message: () => {
				if (style) {
					return pass
						? `Expected cell (${received.row},${received.col}) containing '${received.text}' not to have underline style "${style}"`
						: `Expected cell (${received.row},${received.col}) containing '${received.text}' underline to be "${style}", got "${received.underline}"`
				}
				return pass
					? `Expected cell (${received.row},${received.col}) containing '${received.text}' not to be underlined`
					: `Expected cell (${received.row},${received.col}) containing '${received.text}' to be underlined, got "${received.underline}"`
			},
		}
	},

	/** Assert cell foreground color. Accepts hex string or {r,g,b}. */
	toHaveFg(received: unknown, color: string | RGB) {
		assertCellView(received, "toHaveFg")
		const expected = parseColor(color)
		const pass = colorsMatch(received.fg, expected)
		return {
			pass,
			message: () =>
				pass
					? `Expected cell (${received.row},${received.col}) containing '${received.text}' not to have fg ${formatRgb(expected)}`
					: `Expected cell (${received.row},${received.col}) containing '${received.text}' fg to be ${formatRgb(expected)}, got ${formatRgb(received.fg)}`,
		}
	},

	/** Assert cell background color. Accepts hex string or {r,g,b}. */
	toHaveBg(received: unknown, color: string | RGB) {
		assertCellView(received, "toHaveBg")
		const expected = parseColor(color)
		const pass = colorsMatch(received.bg, expected)
		return {
			pass,
			message: () =>
				pass
					? `Expected cell (${received.row},${received.col}) containing '${received.text}' not to have bg ${formatRgb(expected)}`
					: `Expected cell (${received.row},${received.col}) containing '${received.text}' bg to be ${formatRgb(expected)}, got ${formatRgb(received.bg)}`,
		}
	},

	// ── Terminal Matchers (TerminalReadable) ──

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

	/** Assert a specific terminal mode is enabled. */
	toBeInMode(received: unknown, mode: TerminalMode) {
		assertTerminalReadable(received, "toBeInMode")
		const pass = received.getMode(mode)
		return {
			pass,
			message: () =>
				pass
					? `Expected terminal not to be in mode "${mode}"`
					: `Expected terminal to be in mode "${mode}"`,
		}
	},

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

	// ── Snapshot Matcher (TerminalReadable) ──

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

		return {
			pass:
				(expect as unknown as { getState(): { snapshotState: unknown } })
					.getState?.()
					?.snapshotState !== undefined,
			message: () => `Terminal snapshot comparison`,
			actual: snapshot,
			expected: options?.name ?? "terminal snapshot",
		}
	},
}

// Auto-register matchers when this module is imported
expect.extend(terminalMatchers)
