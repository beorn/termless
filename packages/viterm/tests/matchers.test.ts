/**
 * Tests for viterm custom Vitest matchers.
 *
 * Uses a mock TerminalReadable to verify each matcher's pass/fail behavior
 * without requiring a real terminal backend.
 */

import { describe, test, expect } from "vitest"
import "../src/matchers.ts" // Auto-register matchers
import type {
	TerminalReadable,
	Cell,
	CursorState,
	CursorStyle,
	TerminalMode,
	ScrollbackState,
	RGB,
	UnderlineStyle,
} from "../../../src/types.ts"

// =============================================================================
// Mock Terminal Factory
// =============================================================================

const DEFAULT_CELL: Cell = {
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

interface MockTerminalOptions {
	/** Lines of text to populate the terminal buffer. */
	lines?: string[]
	/** Specific cell overrides keyed as "row,col". */
	cells?: Map<string, Partial<Cell>>
	/** Cursor state. */
	cursor?: Partial<CursorState>
	/** Terminal mode overrides. */
	modes?: Partial<Record<TerminalMode, boolean>>
	/** Terminal title. */
	title?: string
	/** Scrollback state override. */
	scrollback?: Partial<ScrollbackState>
	/** Scrollback text lines (above viewport). */
	scrollbackLines?: string[]
}

function createMockTerminal(options: MockTerminalOptions = {}): TerminalReadable {
	const {
		lines = [""],
		cells = new Map(),
		cursor = {},
		modes = {},
		title = "",
		scrollback = {},
	} = options

	// Build the cell grid from text lines
	const maxCols = Math.max(...lines.map((l) => l.length), 1)
	const grid: Cell[][] = lines.map((line) => {
		const row: Cell[] = []
		for (let col = 0; col < maxCols; col++) {
			row.push({ ...DEFAULT_CELL, text: line[col] ?? " " })
		}
		return row
	})

	// Apply cell overrides
	for (const [key, overrides] of cells) {
		const [r, c] = key.split(",").map(Number) as [number, number]
		if (grid[r]?.[c]) {
			grid[r]![c] = { ...grid[r]![c]!, ...overrides }
		}
	}

	const cursorState: CursorState = {
		x: cursor.x ?? 0,
		y: cursor.y ?? 0,
		visible: cursor.visible ?? true,
		style: cursor.style ?? "block",
	}

	const scrollbackState: ScrollbackState = {
		viewportOffset: scrollback.viewportOffset ?? 0,
		totalLines: scrollback.totalLines ?? lines.length,
		screenLines: scrollback.screenLines ?? lines.length,
	}

	// Scrollback text for testing (separate from viewport)
	const scrollbackLines = options.scrollbackLines ?? []

	return {
		getText(): string {
			return grid.map((row) => row.map((c) => c.text || " ").join("")).join("\n")
		},
		getTextRange(startRow: number, startCol: number, endRow: number, endCol: number): string {
			if (startRow === endRow) {
				return grid[startRow]
					?.slice(startCol, endCol)
					.map((c) => c.text || " ")
					.join("") ?? ""
			}
			const result: string[] = []
			for (let r = startRow; r <= endRow; r++) {
				const row = grid[r]
				if (!row) continue
				const start = r === startRow ? startCol : 0
				const end = r === endRow ? endCol : row.length
				result.push(row.slice(start, end).map((c) => c.text || " ").join(""))
			}
			return result.join("\n")
		},
		getCell(row: number, col: number): Cell {
			return grid[row]?.[col] ?? { ...DEFAULT_CELL }
		},
		getLine(row: number): Cell[] {
			return grid[row] ?? []
		},
		getLines(): Cell[][] {
			return grid
		},
		getRowText(row: number): string {
			return (grid[row] ?? []).map((c) => c.text || " ").join("").trimEnd()
		},
		getViewportText(): string {
			return grid.map((row) => row.map((c) => c.text || " ").join("").trimEnd()).join("\n")
		},
		getScrollbackText(lineCount?: number): string {
			if (scrollbackLines.length === 0) return ""
			const start = lineCount != null ? Math.max(0, scrollbackLines.length - lineCount) : 0
			return scrollbackLines.slice(start).join("\n")
		},
		getCursor(): CursorState {
			return cursorState
		},
		getMode(mode: TerminalMode): boolean {
			return modes[mode] ?? false
		},
		getTitle(): string {
			return title
		},
		getScrollback(): ScrollbackState {
			return scrollbackState
		},
	}
}

// =============================================================================
// Text Matchers
// =============================================================================

describe("text matchers", () => {
	test("toContainText passes when text is present", () => {
		const term = createMockTerminal({ lines: ["Hello World", "Second line"] })
		expect(term).toContainText("Hello")
		expect(term).toContainText("World")
		expect(term).toContainText("Second")
	})

	test("toContainText fails when text is absent", () => {
		const term = createMockTerminal({ lines: ["Hello World"] })
		expect(() => expect(term).toContainText("Goodbye")).toThrow()
	})

	test("toContainText with .not negation works", () => {
		const term = createMockTerminal({ lines: ["Hello World"] })
		expect(term).not.toContainText("Goodbye")
	})

	test("toContainText with .not fails when text IS present", () => {
		const term = createMockTerminal({ lines: ["Hello World"] })
		expect(() => expect(term).not.toContainText("Hello")).toThrow()
	})

	test("toHaveTextAt verifies text at specific row/col", () => {
		const term = createMockTerminal({ lines: ["Hello World"] })
		expect(term).toHaveTextAt(0, 0, "Hello")
		expect(term).toHaveTextAt(0, 6, "World")
	})

	test("toHaveTextAt fails with wrong text", () => {
		const term = createMockTerminal({ lines: ["Hello World"] })
		expect(() => expect(term).toHaveTextAt(0, 0, "Bye")).toThrow()
	})

	test("toContainTextInRow finds text within a specific row", () => {
		const term = createMockTerminal({ lines: ["First line", "Second line", "Third line"] })
		expect(term).toContainTextInRow(0, "First")
		expect(term).toContainTextInRow(1, "Second")
		expect(term).toContainTextInRow(2, "Third")
	})

	test("toContainTextInRow fails when text is in a different row", () => {
		const term = createMockTerminal({ lines: ["First line", "Second line"] })
		expect(() => expect(term).toContainTextInRow(0, "Second")).toThrow()
	})

	test("toHaveEmptyRow passes for empty row", () => {
		const term = createMockTerminal({ lines: ["Hello", "     ", "World"] })
		expect(term).toHaveEmptyRow(1)
	})

	test("toHaveEmptyRow fails for non-empty row", () => {
		const term = createMockTerminal({ lines: ["Hello", "World"] })
		expect(() => expect(term).toHaveEmptyRow(0)).toThrow()
	})
})

// =============================================================================
// Cell Style Matchers
// =============================================================================

describe("cell style matchers", () => {
	test("toHaveFgColor with hex string", () => {
		const cells = new Map([["0,0", { fg: { r: 255, g: 0, b: 0 } }]])
		const term = createMockTerminal({ lines: ["X"], cells })
		expect(term).toHaveFgColor(0, 0, "#ff0000")
	})

	test("toHaveFgColor with RGB object", () => {
		const cells = new Map([["0,0", { fg: { r: 255, g: 0, b: 0 } }]])
		const term = createMockTerminal({ lines: ["X"], cells })
		expect(term).toHaveFgColor(0, 0, { r: 255, g: 0, b: 0 })
	})

	test("toHaveFgColor fails with wrong color", () => {
		const cells = new Map([["0,0", { fg: { r: 255, g: 0, b: 0 } }]])
		const term = createMockTerminal({ lines: ["X"], cells })
		expect(() => expect(term).toHaveFgColor(0, 0, "#00ff00")).toThrow()
	})

	test("toHaveFgColor fails when fg is null", () => {
		const term = createMockTerminal({ lines: ["X"] })
		expect(() => expect(term).toHaveFgColor(0, 0, "#ff0000")).toThrow()
	})

	test("toHaveBgColor with hex string", () => {
		const cells = new Map([["0,2", { bg: { r: 0, g: 128, b: 255 } }]])
		const term = createMockTerminal({ lines: ["ABC"], cells })
		expect(term).toHaveBgColor(0, 2, "#0080ff")
	})

	test("toHaveBgColor with RGB object", () => {
		const cells = new Map([["0,0", { bg: { r: 0, g: 0, b: 0 } }]])
		const term = createMockTerminal({ lines: ["X"], cells })
		expect(term).toHaveBgColor(0, 0, { r: 0, g: 0, b: 0 })
	})

	test("toBeBoldAt passes when cell is bold", () => {
		const cells = new Map([["0,0", { bold: true }]])
		const term = createMockTerminal({ lines: ["X"], cells })
		expect(term).toBeBoldAt(0, 0)
	})

	test("toBeBoldAt fails when cell is not bold", () => {
		const term = createMockTerminal({ lines: ["X"] })
		expect(() => expect(term).toBeBoldAt(0, 0)).toThrow()
	})

	test("toBeItalicAt passes when cell is italic", () => {
		const cells = new Map([["0,0", { italic: true }]])
		const term = createMockTerminal({ lines: ["X"], cells })
		expect(term).toBeItalicAt(0, 0)
	})

	test("toBeItalicAt fails when cell is not italic", () => {
		const term = createMockTerminal({ lines: ["X"] })
		expect(() => expect(term).toBeItalicAt(0, 0)).toThrow()
	})

	test("toBeFaintAt passes when cell is faint", () => {
		const cells = new Map([["0,0", { faint: true }]])
		const term = createMockTerminal({ lines: ["X"], cells })
		expect(term).toBeFaintAt(0, 0)
	})

	test("toBeFaintAt fails when cell is not faint", () => {
		const term = createMockTerminal({ lines: ["X"] })
		expect(() => expect(term).toBeFaintAt(0, 0)).toThrow()
	})

	test("toHaveUnderlineAt passes when underlined", () => {
		const cells = new Map([["0,0", { underline: "single" as UnderlineStyle }]])
		const term = createMockTerminal({ lines: ["X"], cells })
		expect(term).toHaveUnderlineAt(0, 0)
	})

	test("toHaveUnderlineAt checks specific style", () => {
		const cells = new Map([["0,0", { underline: "curly" as UnderlineStyle }]])
		const term = createMockTerminal({ lines: ["X"], cells })
		expect(term).toHaveUnderlineAt(0, 0, "curly")
	})

	test("toHaveUnderlineAt fails when style does not match", () => {
		const cells = new Map([["0,0", { underline: "single" as UnderlineStyle }]])
		const term = createMockTerminal({ lines: ["X"], cells })
		expect(() => expect(term).toHaveUnderlineAt(0, 0, "double")).toThrow()
	})

	test("toHaveUnderlineAt fails when not underlined", () => {
		const term = createMockTerminal({ lines: ["X"] })
		expect(() => expect(term).toHaveUnderlineAt(0, 0)).toThrow()
	})

	test("toBeStrikethroughAt passes when strikethrough", () => {
		const cells = new Map([["0,0", { strikethrough: true }]])
		const term = createMockTerminal({ lines: ["X"], cells })
		expect(term).toBeStrikethroughAt(0, 0)
	})

	test("toBeStrikethroughAt fails when not strikethrough", () => {
		const term = createMockTerminal({ lines: ["X"] })
		expect(() => expect(term).toBeStrikethroughAt(0, 0)).toThrow()
	})

	test("toBeInverseAt passes when inverse", () => {
		const cells = new Map([["0,0", { inverse: true }]])
		const term = createMockTerminal({ lines: ["X"], cells })
		expect(term).toBeInverseAt(0, 0)
	})

	test("toBeInverseAt fails when not inverse", () => {
		const term = createMockTerminal({ lines: ["X"] })
		expect(() => expect(term).toBeInverseAt(0, 0)).toThrow()
	})

	test("toBeWideAt passes when cell is wide", () => {
		const cells = new Map([["0,0", { wide: true }]])
		const term = createMockTerminal({ lines: ["X"], cells })
		expect(term).toBeWideAt(0, 0)
	})

	test("toBeWideAt fails when cell is not wide", () => {
		const term = createMockTerminal({ lines: ["X"] })
		expect(() => expect(term).toBeWideAt(0, 0)).toThrow()
	})
})

// =============================================================================
// Cursor Matchers
// =============================================================================

describe("cursor matchers", () => {
	test("toHaveCursorAt verifies cursor position", () => {
		const term = createMockTerminal({ cursor: { x: 5, y: 10 } })
		expect(term).toHaveCursorAt(5, 10)
	})

	test("toHaveCursorAt fails with wrong position", () => {
		const term = createMockTerminal({ cursor: { x: 5, y: 10 } })
		expect(() => expect(term).toHaveCursorAt(0, 0)).toThrow()
	})

	test("toHaveCursorVisible passes when cursor is visible", () => {
		const term = createMockTerminal({ cursor: { visible: true } })
		expect(term).toHaveCursorVisible()
	})

	test("toHaveCursorVisible fails when cursor is hidden", () => {
		const term = createMockTerminal({ cursor: { visible: false } })
		expect(() => expect(term).toHaveCursorVisible()).toThrow()
	})

	test("toHaveCursorHidden passes when cursor is hidden", () => {
		const term = createMockTerminal({ cursor: { visible: false } })
		expect(term).toHaveCursorHidden()
	})

	test("toHaveCursorHidden fails when cursor is visible", () => {
		const term = createMockTerminal({ cursor: { visible: true } })
		expect(() => expect(term).toHaveCursorHidden()).toThrow()
	})

	test("toHaveCursorStyle checks block style", () => {
		const term = createMockTerminal({ cursor: { style: "block" } })
		expect(term).toHaveCursorStyle("block")
	})

	test("toHaveCursorStyle checks underline style", () => {
		const term = createMockTerminal({ cursor: { style: "underline" } })
		expect(term).toHaveCursorStyle("underline")
	})

	test("toHaveCursorStyle checks beam style", () => {
		const term = createMockTerminal({ cursor: { style: "beam" } })
		expect(term).toHaveCursorStyle("beam")
	})

	test("toHaveCursorStyle fails with wrong style", () => {
		const term = createMockTerminal({ cursor: { style: "block" } })
		expect(() => expect(term).toHaveCursorStyle("beam")).toThrow()
	})
})

// =============================================================================
// Terminal Mode Matchers
// =============================================================================

describe("terminal mode matchers", () => {
	test("toBeInAltScreen passes when alt screen is enabled", () => {
		const term = createMockTerminal({ modes: { altScreen: true } })
		expect(term).toBeInAltScreen()
	})

	test("toBeInAltScreen fails when alt screen is disabled", () => {
		const term = createMockTerminal({ modes: { altScreen: false } })
		expect(() => expect(term).toBeInAltScreen()).toThrow()
	})

	test("toBeInBracketedPaste passes when bracketed paste is enabled", () => {
		const term = createMockTerminal({ modes: { bracketedPaste: true } })
		expect(term).toBeInBracketedPaste()
	})

	test("toBeInBracketedPaste fails when bracketed paste is disabled", () => {
		const term = createMockTerminal({ modes: {} })
		expect(() => expect(term).toBeInBracketedPaste()).toThrow()
	})

	test("toHaveMode generic mode check passes", () => {
		const term = createMockTerminal({ modes: { applicationCursor: true } })
		expect(term).toHaveMode("applicationCursor")
	})

	test("toHaveMode generic mode check fails", () => {
		const term = createMockTerminal({ modes: {} })
		expect(() => expect(term).toHaveMode("applicationCursor")).toThrow()
	})

	test("toHaveMode with .not negation", () => {
		const term = createMockTerminal({ modes: {} })
		expect(term).not.toHaveMode("mouseTracking")
	})
})

// =============================================================================
// Title Matcher
// =============================================================================

describe("title matcher", () => {
	test("toHaveTitle passes with matching title", () => {
		const term = createMockTerminal({ title: "My Terminal" })
		expect(term).toHaveTitle("My Terminal")
	})

	test("toHaveTitle fails with wrong title", () => {
		const term = createMockTerminal({ title: "My Terminal" })
		expect(() => expect(term).toHaveTitle("Other Terminal")).toThrow()
	})

	test("toHaveTitle matches empty title", () => {
		const term = createMockTerminal({ title: "" })
		expect(term).toHaveTitle("")
	})
})

// =============================================================================
// Scrollback Matchers
// =============================================================================

describe("scrollback matchers", () => {
	test("toHaveScrollbackLines checks total line count", () => {
		const term = createMockTerminal({
			lines: ["a", "b", "c"],
			scrollback: { totalLines: 100 },
		})
		expect(term).toHaveScrollbackLines(100)
	})

	test("toHaveScrollbackLines fails with wrong count", () => {
		const term = createMockTerminal({ scrollback: { totalLines: 50 } })
		expect(() => expect(term).toHaveScrollbackLines(100)).toThrow()
	})

	test("toBeAtBottomOfScrollback passes when offset is 0", () => {
		const term = createMockTerminal({ scrollback: { viewportOffset: 0 } })
		expect(term).toBeAtBottomOfScrollback()
	})

	test("toBeAtBottomOfScrollback fails when scrolled up", () => {
		const term = createMockTerminal({ scrollback: { viewportOffset: 10 } })
		expect(() => expect(term).toBeAtBottomOfScrollback()).toThrow()
	})
})

// =============================================================================
// Scrollback Text Matcher
// =============================================================================

describe("scrollback text matcher", () => {
	test("toHaveTextInScrollback passes when text is in scrollback", () => {
		const term = createMockTerminal({
			lines: ["Viewport line"],
			scrollbackLines: ["Old line 1", "Old line 2"],
		})
		expect(term).toHaveTextInScrollback("Old line 1")
		expect(term).toHaveTextInScrollback("Old line 2")
	})

	test("toHaveTextInScrollback fails when text is only in viewport", () => {
		const term = createMockTerminal({
			lines: ["Viewport line"],
			scrollbackLines: ["Old line"],
		})
		expect(() => expect(term).toHaveTextInScrollback("Viewport line")).toThrow()
	})

	test("toHaveTextInScrollback fails when scrollback is empty", () => {
		const term = createMockTerminal({ lines: ["Viewport line"] })
		expect(() => expect(term).toHaveTextInScrollback("anything")).toThrow()
	})

	test("toHaveTextInScrollback with .not negation", () => {
		const term = createMockTerminal({
			lines: ["Viewport"],
			scrollbackLines: ["Old"],
		})
		expect(term).not.toHaveTextInScrollback("Viewport")
	})
})

// =============================================================================
// Viewport Matcher
// =============================================================================

describe("viewport matcher", () => {
	test("toMatchViewport passes when lines match", () => {
		const term = createMockTerminal({ lines: ["Hello", "World"] })
		expect(term).toMatchViewport(["Hello", "World"])
	})

	test("toMatchViewport trims trailing whitespace", () => {
		const term = createMockTerminal({ lines: ["Hello   ", "World   "] })
		expect(term).toMatchViewport(["Hello", "World"])
	})

	test("toMatchViewport fails when lines differ", () => {
		const term = createMockTerminal({ lines: ["Hello", "World"] })
		expect(() => expect(term).toMatchViewport(["Hello", "Earth"])).toThrow(/row 1/)
	})

	test("toMatchViewport handles empty lines", () => {
		const term = createMockTerminal({ lines: ["Hello", "", "World"] })
		expect(term).toMatchViewport(["Hello", "", "World"])
	})

	test("toMatchViewport pads shorter expected with empty strings", () => {
		const term = createMockTerminal({ lines: ["Hello", "World", ""] })
		expect(term).toMatchViewport(["Hello", "World"])
	})

	test("toMatchViewport with .not negation", () => {
		const term = createMockTerminal({ lines: ["Hello", "World"] })
		expect(term).not.toMatchViewport(["Goodbye", "World"])
	})
})

// =============================================================================
// Error Handling
// =============================================================================

describe("error handling", () => {
	test("matchers throw when given non-TerminalReadable", () => {
		expect(() => expect("not a terminal").toContainText("foo")).toThrow(
			"toContainText expects a TerminalReadable",
		)
	})

	test("matchers throw when given null", () => {
		expect(() => expect(null).toContainText("foo")).toThrow(
			"toContainText expects a TerminalReadable",
		)
	})

	test("matchers throw when given plain object", () => {
		expect(() => expect({ foo: "bar" }).toHaveCursorAt(0, 0)).toThrow(
			"toHaveCursorAt expects a TerminalReadable",
		)
	})
})
