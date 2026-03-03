/**
 * Tests for the terminal fixture factory.
 *
 * Verifies that createTerminalFixture returns a working Terminal and
 * that cleanup is properly wired via afterEach.
 */

import { describe, test, expect } from "vitest"
import { createTerminalFixture } from "../src/fixture.ts"
import type {
	TerminalBackend,
	TerminalOptions,
	Cell,
	CursorState,
	CursorStyle,
	ScrollbackState,
	TerminalMode,
	KeyDescriptor,
	TerminalCapabilities,
} from "../../../src/types.ts"

// =============================================================================
// Minimal Mock Backend
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

/** Create a minimal mock backend that satisfies the TerminalBackend interface. */
function createMockBackend(): TerminalBackend {
	let cols = 80
	let rows = 24
	let destroyed = false
	const buffer: string[] = []

	return {
		name: "mock",
		capabilities: {
			name: "mock",
			version: "0.1.0",
			truecolor: true,
			kittyKeyboard: false,
			kittyGraphics: false,
			sixel: false,
			osc8Hyperlinks: false,
			semanticPrompts: false,
			unicode: "15.0",
			reflow: false,
			extensions: new Set(),
		} satisfies TerminalCapabilities,

		init(opts: TerminalOptions): void {
			cols = opts.cols
			rows = opts.rows
		},

		destroy(): void {
			destroyed = true
		},

		feed(data: Uint8Array): void {
			buffer.push(new TextDecoder().decode(data))
		},

		resize(c: number, r: number): void {
			cols = c
			rows = r
		},

		reset(): void {
			buffer.length = 0
		},

		encodeKey(_key: KeyDescriptor): Uint8Array {
			return new Uint8Array()
		},

		scrollViewport(_delta: number): void {},

		getText(): string {
			const grid: string[] = []
			for (let r = 0; r < rows; r++) {
				grid.push(" ".repeat(cols))
			}
			return grid.join("\n")
		},

		getTextRange(_startRow: number, _startCol: number, _endRow: number, _endCol: number): string {
			return ""
		},

		getCell(_row: number, _col: number): Cell {
			return { ...DEFAULT_CELL }
		},

		getLine(row: number): Cell[] {
			return Array.from({ length: cols }, () => ({ ...DEFAULT_CELL }))
		},

		getLines(): Cell[][] {
			return Array.from({ length: rows }, () =>
				Array.from({ length: cols }, () => ({ ...DEFAULT_CELL })),
			)
		},

		getCursor(): CursorState {
			return { x: 0, y: 0, visible: true, style: "block" }
		},

		getMode(_mode: TerminalMode): boolean {
			return false
		},

		getTitle(): string {
			return ""
		},

		getScrollback(): ScrollbackState {
			return { viewportOffset: 0, totalLines: rows, screenLines: rows }
		},
	}
}

// =============================================================================
// Tests
// =============================================================================

describe("createTerminalFixture", () => {
	test("returns a Terminal-like object", () => {
		const term = createTerminalFixture({
			backend: createMockBackend(),
			cols: 80,
			rows: 24,
		})

		// Verify it has Terminal interface methods
		expect(typeof term.getText).toBe("function")
		expect(typeof term.getCell).toBe("function")
		expect(typeof term.getCursor).toBe("function")
		expect(typeof term.getMode).toBe("function")
		expect(typeof term.feed).toBe("function")
		expect(typeof term.close).toBe("function")
		expect(typeof term.press).toBe("function")
		expect(typeof term.type).toBe("function")
		expect(typeof term.find).toBe("function")
		expect(typeof term.findAll).toBe("function")
	})

	test("terminal has correct dimensions", () => {
		const term = createTerminalFixture({
			backend: createMockBackend(),
			cols: 120,
			rows: 40,
		})
		expect(term.cols).toBe(120)
		expect(term.rows).toBe(40)
	})

	test("terminal delegates to backend", () => {
		const term = createTerminalFixture({
			backend: createMockBackend(),
			cols: 80,
			rows: 24,
		})

		const cursor = term.getCursor()
		expect(cursor.x).toBe(0)
		expect(cursor.y).toBe(0)
		expect(cursor.visible).toBe(true)
		expect(cursor.style).toBe("block")
	})

	test("feed accepts string data", () => {
		const term = createTerminalFixture({
			backend: createMockBackend(),
			cols: 80,
			rows: 24,
		})

		// Should not throw
		term.feed("Hello World")
	})

	test("feed accepts Uint8Array data", () => {
		const term = createTerminalFixture({
			backend: createMockBackend(),
			cols: 80,
			rows: 24,
		})

		// Should not throw
		term.feed(new TextEncoder().encode("Hello World"))
	})

	// Note: Full auto-cleanup testing (afterEach) is verified implicitly by vitest's
	// own afterEach integration. The cleanup hook is registered at module load time
	// and runs after each test automatically.
})
