/**
 * Pure assertion functions for terminal testing.
 *
 * These are test-runner-agnostic: they return { pass, message } objects
 * that any matcher wrapper (vitest, jest, bun:test, node:test) can use.
 *
 * Three categories match the composable API:
 *   - Region assertions: operate on RegionView (getText, getLines, containsText)
 *   - Cell assertions: operate on CellView (bold, italic, fg, bg, etc.)
 *   - Terminal assertions: operate on TerminalReadable (cursor, modes, scrollback)
 */

import type {
	CellView,
	CursorStyle,
	RegionView,
	RGB,
	TerminalMode,
	TerminalReadable,
	UnderlineStyle,
} from "./types.ts"

// ═══════════════════════════════════════════════════════
// Result Type
// ═══════════════════════════════════════════════════════

export interface AssertionResult {
	pass: boolean
	message: string
	expected?: unknown
	actual?: unknown
}

// ═══════════════════════════════════════════════════════
// Type Guards
// ═══════════════════════════════════════════════════════

export function isRegionView(value: unknown): value is RegionView {
	return (
		value !== null &&
		typeof value === "object" &&
		"containsText" in value &&
		typeof (value as Record<string, unknown>).containsText === "function"
	)
}

export function isCellView(value: unknown): value is CellView {
	return (
		value !== null &&
		typeof value === "object" &&
		"bold" in value &&
		"fg" in value &&
		"row" in value &&
		"col" in value
	)
}

export function isTerminalReadable(value: unknown): value is TerminalReadable {
	return (
		value !== null &&
		typeof value === "object" &&
		"getCell" in value &&
		"getCursor" in value &&
		"getMode" in value
	)
}

// ═══════════════════════════════════════════════════════
// Type Assertions (throw on wrong type)
// ═══════════════════════════════════════════════════════

export function assertRegionView(value: unknown, matcherName: string): asserts value is RegionView {
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

export function assertCellView(value: unknown, matcherName: string): asserts value is CellView {
	if (isCellView(value)) return
	throw new Error(
		`${matcherName} expects a CellView. Use term.cell(row, col). ` +
			`Example: expect(term.cell(0, 0)).${matcherName}()`,
	)
}

export function assertTerminalReadable(
	value: unknown,
	matcherName: string,
): asserts value is TerminalReadable {
	if (isTerminalReadable(value)) return
	throw new Error(
		`${matcherName} expects a TerminalReadable, got ${typeof value}. ` +
			`Pass an object with getCell(), getCursor(), and getMode() methods.`,
	)
}

// ═══════════════════════════════════════════════════════
// Color Helpers
// ═══════════════════════════════════════════════════════

export function parseColor(color: string | RGB): RGB {
	if (typeof color === "object") return color
	const hex = color.replace("#", "")
	return {
		r: parseInt(hex.slice(0, 2), 16),
		g: parseInt(hex.slice(2, 4), 16),
		b: parseInt(hex.slice(4, 6), 16),
	}
}

export function colorsMatch(a: RGB | null, b: RGB): boolean {
	if (!a) return false
	return a.r === b.r && a.g === b.g && a.b === b.b
}

export function formatRgb(color: RGB | null): string {
	if (!color) return "null"
	return `#${color.r.toString(16).padStart(2, "0")}${color.g.toString(16).padStart(2, "0")}${color.b.toString(16).padStart(2, "0")}`
}

// ═══════════════════════════════════════════════════════
// Region Assertions (RegionView)
// ═══════════════════════════════════════════════════════

/** Assert region contains the given text as a substring. */
export function assertContainsText(region: RegionView, text: string): AssertionResult {
	const pass = region.containsText(text)
	const content = region.getText()
	return {
		pass,
		message: pass
			? `Expected region not to contain "${text}"\n\nContent:\n${content}`
			: `Expected region to contain "${text}"\n\nContent:\n${content}`,
	}
}

/** Assert region text matches exactly after trimming. */
export function assertHasText(region: RegionView, text: string): AssertionResult {
	const actual = region.getText().trim()
	const pass = actual === text
	return {
		pass,
		message: pass
			? `Expected region text not to be "${text}"`
			: `Expected region text to be "${text}"\n\nActual: "${actual}"`,
		expected: text,
		actual,
	}
}

/** Assert region lines match expected lines (trailing whitespace trimmed per line). */
export function assertMatchesLines(region: RegionView, expectedLines: string[]): AssertionResult {
	const actualLines = region.getLines().map((l) => l.trimEnd())

	const maxLen = Math.max(actualLines.length, expectedLines.length)
	const mismatches: string[] = []
	for (let i = 0; i < maxLen; i++) {
		const actual = actualLines[i] ?? ""
		const expected = expectedLines[i] ?? ""
		if (actual !== expected) {
			mismatches.push(`  line ${i}: expected "${expected}" got "${actual}"`)
		}
	}

	const pass = mismatches.length === 0
	return {
		pass,
		message: pass
			? `Expected region lines not to match the given lines`
			: `Region line mismatch:\n${mismatches.join("\n")}`,
		expected: expectedLines,
		actual: actualLines,
	}
}

// ═══════════════════════════════════════════════════════
// Cell Assertions (CellView)
// ═══════════════════════════════════════════════════════

function cellLocation(cell: CellView): string {
	return `cell (${cell.row},${cell.col}) containing '${cell.text}'`
}

/** Assert cell is bold. */
export function assertIsBold(cell: CellView): AssertionResult {
	const loc = cellLocation(cell)
	return {
		pass: cell.bold,
		message: cell.bold ? `Expected ${loc} not to be bold` : `Expected ${loc} to be bold`,
	}
}

/** Assert cell is italic. */
export function assertIsItalic(cell: CellView): AssertionResult {
	const loc = cellLocation(cell)
	return {
		pass: cell.italic,
		message: cell.italic ? `Expected ${loc} not to be italic` : `Expected ${loc} to be italic`,
	}
}

/** Assert cell is faint. */
export function assertIsFaint(cell: CellView): AssertionResult {
	const loc = cellLocation(cell)
	return {
		pass: cell.faint,
		message: cell.faint ? `Expected ${loc} not to be faint` : `Expected ${loc} to be faint`,
	}
}

/** Assert cell has strikethrough. */
export function assertIsStrikethrough(cell: CellView): AssertionResult {
	const loc = cellLocation(cell)
	return {
		pass: cell.strikethrough,
		message: cell.strikethrough
			? `Expected ${loc} not to be strikethrough`
			: `Expected ${loc} to be strikethrough`,
	}
}

/** Assert cell has inverse video. */
export function assertIsInverse(cell: CellView): AssertionResult {
	const loc = cellLocation(cell)
	return {
		pass: cell.inverse,
		message: cell.inverse ? `Expected ${loc} not to be inverse` : `Expected ${loc} to be inverse`,
	}
}

/** Assert cell is wide (double-width character). */
export function assertIsWide(cell: CellView): AssertionResult {
	const loc = cellLocation(cell)
	return {
		pass: cell.wide,
		message: cell.wide ? `Expected ${loc} not to be wide` : `Expected ${loc} to be wide`,
	}
}

/** Assert cell has underline. Optionally check specific style. */
export function assertHasUnderline(cell: CellView, style?: UnderlineStyle): AssertionResult {
	const loc = cellLocation(cell)
	const hasUnderline = cell.underline !== "none"
	const pass = style ? cell.underline === style : hasUnderline

	let message: string
	if (style) {
		message = pass
			? `Expected ${loc} not to have underline style "${style}"`
			: `Expected ${loc} underline to be "${style}", got "${cell.underline}"`
	} else {
		message = pass
			? `Expected ${loc} not to be underlined`
			: `Expected ${loc} to be underlined, got "${cell.underline}"`
	}

	return { pass, message, expected: style ?? "any underline", actual: cell.underline }
}

/** Assert cell foreground color. Accepts hex string or {r,g,b}. */
export function assertHasFg(cell: CellView, color: string | RGB): AssertionResult {
	const loc = cellLocation(cell)
	const expected = parseColor(color)
	const pass = colorsMatch(cell.fg, expected)
	return {
		pass,
		message: pass
			? `Expected ${loc} not to have fg ${formatRgb(expected)}`
			: `Expected ${loc} fg to be ${formatRgb(expected)}, got ${formatRgb(cell.fg)}`,
		expected: formatRgb(expected),
		actual: formatRgb(cell.fg),
	}
}

/** Assert cell background color. Accepts hex string or {r,g,b}. */
export function assertHasBg(cell: CellView, color: string | RGB): AssertionResult {
	const loc = cellLocation(cell)
	const expected = parseColor(color)
	const pass = colorsMatch(cell.bg, expected)
	return {
		pass,
		message: pass
			? `Expected ${loc} not to have bg ${formatRgb(expected)}`
			: `Expected ${loc} bg to be ${formatRgb(expected)}, got ${formatRgb(cell.bg)}`,
		expected: formatRgb(expected),
		actual: formatRgb(cell.bg),
	}
}

// ═══════════════════════════════════════════════════════
// Terminal Assertions (TerminalReadable)
// ═══════════════════════════════════════════════════════

/** Assert cursor is at the given position. */
export function assertCursorAt(term: TerminalReadable, x: number, y: number): AssertionResult {
	const cursor = term.getCursor()
	const pass = cursor.x === x && cursor.y === y
	return {
		pass,
		message: pass
			? `Expected cursor not to be at (${x},${y})`
			: `Expected cursor at (${x},${y}), got (${cursor.x},${cursor.y})`,
		expected: { x, y },
		actual: { x: cursor.x, y: cursor.y },
	}
}

/** Assert cursor has a specific style (block, underline, beam). */
export function assertCursorStyle(term: TerminalReadable, style: CursorStyle): AssertionResult {
	const cursor = term.getCursor()
	const pass = cursor.style === style
	return {
		pass,
		message: pass
			? `Expected cursor style not to be "${style}"`
			: `Expected cursor style to be "${style}", got "${cursor.style}"`,
		expected: style,
		actual: cursor.style,
	}
}

/** Assert cursor is visible. */
export function assertCursorVisible(term: TerminalReadable): AssertionResult {
	const cursor = term.getCursor()
	return {
		pass: cursor.visible,
		message: cursor.visible ? `Expected cursor not to be visible` : `Expected cursor to be visible`,
	}
}

/** Assert cursor is hidden. */
export function assertCursorHidden(term: TerminalReadable): AssertionResult {
	const cursor = term.getCursor()
	return {
		pass: !cursor.visible,
		message: !cursor.visible ? `Expected cursor not to be hidden` : `Expected cursor to be hidden`,
	}
}

/** Assert a specific terminal mode is enabled. */
export function assertInMode(term: TerminalReadable, mode: TerminalMode): AssertionResult {
	const pass = term.getMode(mode)
	return {
		pass,
		message: pass
			? `Expected terminal not to be in mode "${mode}"`
			: `Expected terminal to be in mode "${mode}"`,
	}
}

/** Assert terminal has a specific title (set via OSC escape). */
export function assertTitle(term: TerminalReadable, title: string): AssertionResult {
	const actual = term.getTitle()
	const pass = actual === title
	return {
		pass,
		message: pass
			? `Expected terminal title not to be "${title}"`
			: `Expected terminal title to be "${title}", got "${actual}"`,
		expected: title,
		actual,
	}
}

/** Assert scrollback has a specific number of lines. */
export function assertScrollbackLines(term: TerminalReadable, n: number): AssertionResult {
	const scrollback = term.getScrollback()
	const pass = scrollback.totalLines === n
	return {
		pass,
		message: pass
			? `Expected scrollback not to have ${n} lines`
			: `Expected scrollback to have ${n} lines, got ${scrollback.totalLines}`,
		expected: n,
		actual: scrollback.totalLines,
	}
}

/** Assert viewport is at the bottom of scrollback (no scroll offset). */
export function assertAtBottomOfScrollback(term: TerminalReadable): AssertionResult {
	const scrollback = term.getScrollback()
	const pass = scrollback.viewportOffset === 0
	return {
		pass,
		message: pass
			? `Expected terminal not to be at bottom of scrollback`
			: `Expected terminal to be at bottom of scrollback, got offset ${scrollback.viewportOffset}`,
	}
}
