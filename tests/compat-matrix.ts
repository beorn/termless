/**
 * Cross-terminal conformance matrix generator.
 *
 * Runs a battery of VT100/ECMA-48 test sequences against all available
 * backends and produces a markdown compatibility report showing which
 * features are identical and which differ.
 *
 * Usage:
 *   bun vendor/beorn-termless/tests/compat-matrix.ts
 *   bun vendor/beorn-termless/tests/compat-matrix.ts --output docs/compat-matrix.md
 */
import { createXtermBackend } from "../packages/xtermjs/src/backend.ts"
import { createGhosttyBackend, initGhostty } from "../packages/ghostty/src/backend.ts"
import { createVt100Backend } from "../packages/vt100/src/backend.ts"
import type { TerminalBackend, Cell, RGB, TerminalMode } from "../src/types.ts"

// ── Types ──

interface TestCase {
	category: string
	name: string
	input: string
	check: (backend: TerminalBackend) => TestResult
}

interface TestResult {
	pass: boolean
	value: string
}

interface BackendResult {
	name: string
	results: Map<string, TestResult>
}

// ── Test Suite ──

const encoder = new TextEncoder()

function feed(b: TerminalBackend, text: string) {
	b.feed(encoder.encode(text))
}

function rgbStr(c: RGB | null): string {
	return c ? `rgb(${c.r},${c.g},${c.b})` : "default"
}

function cellSummary(cell: Cell): string {
	const parts: string[] = [cell.text || "∅"]
	if (cell.bold) parts.push("bold")
	if (cell.italic) parts.push("italic")
	if (cell.faint) parts.push("faint")
	if (cell.strikethrough) parts.push("strike")
	if (cell.inverse) parts.push("inverse")
	if (cell.underline !== "none") parts.push(`underline:${cell.underline}`)
	if (cell.fg) parts.push(`fg:${rgbStr(cell.fg)}`)
	if (cell.bg) parts.push(`bg:${rgbStr(cell.bg)}`)
	if (cell.wide) parts.push("wide")
	return parts.join(" ")
}

const tests: TestCase[] = [
	// ── Text rendering ──
	{
		category: "Text",
		name: "Plain text",
		input: "Hello, world!",
		check: (b) => {
			const text = b.getText()
			return { pass: text.includes("Hello, world!"), value: text.trim().slice(0, 40) }
		},
	},
	{
		category: "Text",
		name: "Multiline (CRLF)",
		input: "Line 1\r\nLine 2\r\nLine 3",
		check: (b) => {
			const text = b.getText()
			const ok = text.includes("Line 1") && text.includes("Line 2") && text.includes("Line 3")
			return { pass: ok, value: ok ? "3 lines" : text.trim().slice(0, 40) }
		},
	},
	{
		category: "Text",
		name: "CUP positioning (\\e[3;10H)",
		input: "\x1b[3;10HX",
		check: (b) => {
			const cell = b.getCell(2, 9)
			return { pass: cell.text === "X", value: `cell(2,9)=${cell.text}` }
		},
	},
	{
		category: "Text",
		name: "Line wrap at boundary",
		input: "1234567890".repeat(8) + "WRAP",
		check: (b) => {
			const text = b.getText()
			return { pass: text.includes("WRAP"), value: text.includes("WRAP") ? "wrapped" : "missing" }
		},
	},

	// ── SGR Styles ──
	{
		category: "SGR",
		name: "Bold (SGR 1)",
		input: "\x1b[1mB\x1b[0m",
		check: (b) => {
			const cell = b.getCell(0, 0)
			return { pass: cell.bold === true, value: cellSummary(cell) }
		},
	},
	{
		category: "SGR",
		name: "Faint (SGR 2)",
		input: "\x1b[2mF\x1b[0m",
		check: (b) => {
			const cell = b.getCell(0, 0)
			return { pass: cell.faint === true, value: cellSummary(cell) }
		},
	},
	{
		category: "SGR",
		name: "Italic (SGR 3)",
		input: "\x1b[3mI\x1b[0m",
		check: (b) => {
			const cell = b.getCell(0, 0)
			return { pass: cell.italic === true, value: cellSummary(cell) }
		},
	},
	{
		category: "SGR",
		name: "Underline (SGR 4)",
		input: "\x1b[4mU\x1b[0m",
		check: (b) => {
			const cell = b.getCell(0, 0)
			return { pass: cell.underline === "single", value: cellSummary(cell) }
		},
	},
	{
		category: "SGR",
		name: "Strikethrough (SGR 9)",
		input: "\x1b[9mS\x1b[0m",
		check: (b) => {
			const cell = b.getCell(0, 0)
			return { pass: cell.strikethrough === true, value: cellSummary(cell) }
		},
	},
	{
		category: "SGR",
		name: "Inverse (SGR 7)",
		input: "\x1b[7mI\x1b[0m",
		check: (b) => {
			const cell = b.getCell(0, 0)
			return { pass: cell.inverse === true, value: cellSummary(cell) }
		},
	},
	{
		category: "SGR",
		name: "True color FG (SGR 38;2)",
		input: "\x1b[38;2;255;128;0mR\x1b[0m",
		check: (b) => {
			const cell = b.getCell(0, 0)
			const ok = cell.fg?.r === 255 && cell.fg?.g === 128 && cell.fg?.b === 0
			return { pass: ok, value: `fg:${rgbStr(cell.fg)}` }
		},
	},
	{
		category: "SGR",
		name: "True color BG (SGR 48;2)",
		input: "\x1b[48;2;0;128;255mB\x1b[0m",
		check: (b) => {
			const cell = b.getCell(0, 0)
			const ok = cell.bg?.r === 0 && cell.bg?.g === 128 && cell.bg?.b === 255
			return { pass: ok, value: `bg:${rgbStr(cell.bg)}` }
		},
	},
	{
		category: "SGR",
		name: "Combined bold+italic+fg",
		input: "\x1b[1;3;38;2;255;0;0mX\x1b[0m",
		check: (b) => {
			const cell = b.getCell(0, 0)
			const ok = cell.bold && cell.italic && cell.fg?.r === 255
			return { pass: ok, value: cellSummary(cell) }
		},
	},
	{
		category: "SGR",
		name: "Reset (SGR 0) clears all",
		input: "\x1b[1;3;4;9mStyled\x1b[0mPlain",
		check: (b) => {
			const plain = b.getCell(0, 6) // 'P' in 'Plain'
			const ok = !plain.bold && !plain.italic && !plain.strikethrough && plain.underline === "none"
			return { pass: ok, value: cellSummary(plain) }
		},
	},

	// ── 256-color palette ──
	{
		category: "SGR",
		name: "256-color FG (SGR 38;5;196 = red)",
		input: "\x1b[38;5;196mR\x1b[0m",
		check: (b) => {
			const cell = b.getCell(0, 0)
			// 196 = bright red (255,0,0) in standard 256 palette
			return { pass: cell.fg !== null, value: `fg:${rgbStr(cell.fg)}` }
		},
	},

	// ── Cursor ──
	{
		category: "Cursor",
		name: "Position after text",
		input: "Hello",
		check: (b) => {
			const c = b.getCursor()
			return { pass: c.x === 5 && c.y === 0, value: `(${c.x},${c.y})` }
		},
	},
	{
		category: "Cursor",
		name: "Position after CRLF",
		input: "Line1\r\nLine2",
		check: (b) => {
			const c = b.getCursor()
			return { pass: c.x === 5 && c.y === 1, value: `(${c.x},${c.y})` }
		},
	},
	{
		category: "Cursor",
		name: "CUP (\\e[5;10H)",
		input: "\x1b[5;10H",
		check: (b) => {
			const c = b.getCursor()
			return { pass: c.x === 9 && c.y === 4, value: `(${c.x},${c.y})` }
		},
	},
	{
		category: "Cursor",
		name: "CUF forward (\\e[5C)",
		input: "\x1b[5C",
		check: (b) => {
			const c = b.getCursor()
			return { pass: c.x === 5, value: `x=${c.x}` }
		},
	},

	// ── Modes ──
	{
		category: "Modes",
		name: "Alt screen on",
		input: "\x1b[?1049h",
		check: (b) => {
			const mode = b.getMode("altScreen")
			return { pass: mode === true, value: String(mode) }
		},
	},
	{
		category: "Modes",
		name: "Alt screen off",
		input: "\x1b[?1049h\x1b[?1049l",
		check: (b) => {
			const mode = b.getMode("altScreen")
			return { pass: mode === false, value: String(mode) }
		},
	},
	{
		category: "Modes",
		name: "Bracketed paste",
		input: "\x1b[?2004h",
		check: (b) => {
			const mode = b.getMode("bracketedPaste")
			return { pass: mode === true, value: String(mode) }
		},
	},
	{
		category: "Modes",
		name: "Auto wrap (default on)",
		input: "",
		check: (b) => {
			const mode = b.getMode("autoWrap")
			return { pass: mode === true, value: String(mode) }
		},
	},

	{
		category: "Modes",
		name: "Application cursor (DECCKM)",
		input: "\x1b[?1h",
		check: (b) => {
			const mode = b.getMode("applicationCursor")
			return { pass: mode === true, value: String(mode) }
		},
	},
	{
		category: "Modes",
		name: "Mouse tracking (DECSET 1000)",
		input: "\x1b[?1000h",
		check: (b) => {
			const mode = b.getMode("mouseTracking")
			return { pass: mode === true, value: String(mode) }
		},
	},
	{
		category: "Modes",
		name: "Focus tracking (DECSET 1004)",
		input: "\x1b[?1004h",
		check: (b) => {
			const mode = b.getMode("focusTracking")
			return { pass: mode === true, value: String(mode) }
		},
	},

	// ── Scrollback ──
	{
		category: "Scrollback",
		name: "Screen lines reported",
		input: "",
		check: (b) => {
			const s = b.getScrollback()
			return { pass: s.screenLines === 24, value: `screenLines=${s.screenLines}` }
		},
	},
	{
		category: "Scrollback",
		name: "Scrollback accumulates",
		input: Array.from({ length: 30 }, (_, i) => `Line ${i}`).join("\r\n"),
		check: (b) => {
			const s = b.getScrollback()
			return { pass: s.totalLines > 24, value: `totalLines=${s.totalLines}` }
		},
	},

	// ── Reset ──
	{
		category: "Control",
		name: "RIS clears screen",
		input: "Content\x1bc",
		check: (b) => {
			const text = b.getText()
			return { pass: !text.includes("Content"), value: text.includes("Content") ? "NOT cleared" : "cleared" }
		},
	},

	// ── Key encoding ──
	{
		category: "Keys",
		name: "Enter → CR (0x0d)",
		input: "",
		check: (b) => {
			const enc = b.encodeKey({ key: "Enter" })
			const ok = enc.length === 1 && enc[0] === 0x0d
			return { pass: ok, value: `[${Array.from(enc).map((x) => `0x${x.toString(16)}`).join(",")}]` }
		},
	},
	{
		category: "Keys",
		name: "Escape → ESC (0x1b)",
		input: "",
		check: (b) => {
			const enc = b.encodeKey({ key: "Escape" })
			const ok = enc.length === 1 && enc[0] === 0x1b
			return { pass: ok, value: `[${Array.from(enc).map((x) => `0x${x.toString(16)}`).join(",")}]` }
		},
	},
	{
		category: "Keys",
		name: "Ctrl+C → ETX (0x03)",
		input: "",
		check: (b) => {
			const enc = b.encodeKey({ key: "c", ctrl: true })
			const ok = enc.length === 1 && enc[0] === 3
			return { pass: ok, value: `[${Array.from(enc).map((x) => `0x${x.toString(16)}`).join(",")}]` }
		},
	},
	{
		category: "Keys",
		name: "ArrowUp → \\e[A",
		input: "",
		check: (b) => {
			const enc = b.encodeKey({ key: "ArrowUp" })
			const str = new TextDecoder().decode(enc)
			return { pass: str === "\x1b[A", value: JSON.stringify(str) }
		},
	},

	// ── Wide characters (CJK/Emoji) ──
	{
		category: "Unicode",
		name: "Wide emoji",
		input: "🎉",
		check: (b) => {
			const cell = b.getCell(0, 0)
			return { pass: cell.wide === true, value: `wide=${cell.wide} text="${cell.text}"` }
		},
	},
	{
		category: "Unicode",
		name: "CJK character",
		input: "漢",
		check: (b) => {
			const cell = b.getCell(0, 0)
			return { pass: cell.wide === true, value: `wide=${cell.wide} text="${cell.text}"` }
		},
	},

	// ── Title ──
	{
		category: "Title",
		name: "OSC 2 set title",
		input: "\x1b]2;My Title\x07",
		check: (b) => {
			const title = b.getTitle()
			return { pass: title === "My Title", value: `title="${title}"` }
		},
	},

	{
		category: "Unicode",
		name: "Wide char column offset",
		input: "🎉A",
		check: (b) => {
			const aCell = b.getCell(0, 2)
			const text = aCell.text || " "
			return { pass: text === "A", value: `cell(0,2)="${text}"` }
		},
	},

	// ── Resize ──
	{
		category: "Control",
		name: "Resize preserves content",
		input: "Before resize",
		check: (b) => {
			b.resize(80, 24)
			const text = b.getText()
			return { pass: text.includes("Before resize"), value: text.includes("Before resize") ? "preserved" : "lost" }
		},
	},

	// ── Capabilities ──
	{
		category: "Capabilities",
		name: "True color support",
		input: "",
		check: (b) => {
			return { pass: b.capabilities.truecolor, value: String(b.capabilities.truecolor) }
		},
	},
	{
		category: "Capabilities",
		name: "Reflow support",
		input: "",
		check: (b) => {
			return { pass: true, value: String(b.capabilities.reflow) }
		},
	},
	{
		category: "Capabilities",
		name: "Kitty keyboard",
		input: "",
		check: (b) => {
			return { pass: true, value: String(b.capabilities.kittyKeyboard) }
		},
	},
]

// ── Runner (exported for CLI integration) ──

export async function runMatrix(): Promise<{ backends: BackendResult[]; tests: TestCase[] }> {
	const ghostty = await initGhostty()

	const backendFactories: [string, () => TerminalBackend][] = [
		["xterm.js", () => createXtermBackend()],
		["ghostty", () => createGhosttyBackend(undefined, ghostty)],
		["vt100", () => createVt100Backend()],
	]

	const results: BackendResult[] = []

	for (const [name, factory] of backendFactories) {
		const backendResults = new Map<string, TestResult>()

		for (const tc of tests) {
			const b = factory()
			b.init({ cols: 80, rows: 24 })
			if (tc.input) feed(b, tc.input)

			try {
				backendResults.set(`${tc.category}::${tc.name}`, tc.check(b))
			} catch (err) {
				backendResults.set(`${tc.category}::${tc.name}`, {
					pass: false,
					value: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
				})
			}

			b.destroy()
		}

		results.push({ name, results: backendResults })
	}

	return { backends: results, tests }
}

// ── Report Generator (exported for CLI integration) ──

export function generateReport(data: { backends: BackendResult[]; tests: TestCase[] }): string {
	const { backends, tests: testCases } = data
	const backendNames = backends.map((b) => b.name)

	const lines: string[] = []

	lines.push("# Cross-Terminal Conformance Matrix")
	lines.push("")
	lines.push(`Generated: ${new Date().toISOString().slice(0, 10)}`)
	lines.push(`Backends: ${backendNames.join(", ")}`)
	lines.push("")

	// Summary
	let totalTests = testCases.length
	let allPass = 0
	let anyFail = 0
	let differ = 0

	for (const tc of testCases) {
		const key = `${tc.category}::${tc.name}`
		const results = backends.map((b) => b.results.get(key)!)
		const allOk = results.every((r) => r.pass)
		const allSame = results.every((r) => r.value === results[0]!.value)

		if (allOk) allPass++
		if (!results.every((r) => r.pass)) anyFail++
		if (!allSame) differ++
	}

	lines.push("## Summary")
	lines.push("")
	lines.push(`| Metric | Count |`)
	lines.push(`|--------|-------|`)
	lines.push(`| Total tests | ${totalTests} |`)
	lines.push(`| All backends pass | ${allPass} |`)
	lines.push(`| Any backend fails | ${anyFail} |`)
	lines.push(`| Backends differ | ${differ} |`)
	lines.push("")

	// Group by category
	const categories = [...new Set(testCases.map((t) => t.category))]

	for (const category of categories) {
		const catTests = testCases.filter((t) => t.category === category)

		lines.push(`## ${category}`)
		lines.push("")

		// Table header
		const header = `| Test | ${backendNames.map((n) => `${n} |`).join(" ")} Match |`
		const sep = `|------|${backendNames.map(() => "------|").join(" ")} ------|`
		lines.push(header)
		lines.push(sep)

		for (const tc of catTests) {
			const key = `${tc.category}::${tc.name}`
			const results = backends.map((b) => b.results.get(key)!)
			const allSame = results.every((r) => r.value === results[0]!.value)

			const cells = results.map((r) => {
				const icon = r.pass ? "ok" : "FAIL"
				return `${icon}: ${r.value}`
			})

			const match = allSame ? "=" : "DIFF"
			lines.push(`| ${tc.name} | ${cells.join(" | ")} | ${match} |`)
		}

		lines.push("")
	}

	// Known differences section
	const diffs: { test: string; values: string[] }[] = []
	for (const tc of testCases) {
		const key = `${tc.category}::${tc.name}`
		const results = backends.map((b) => b.results.get(key)!)
		if (!results.every((r) => r.value === results[0]!.value)) {
			diffs.push({
				test: `${tc.category}: ${tc.name}`,
				values: results.map((r, i) => `${backendNames[i]}: ${r.value}`),
			})
		}
	}

	if (diffs.length > 0) {
		lines.push("## Known Differences")
		lines.push("")
		for (const d of diffs) {
			lines.push(`### ${d.test}`)
			lines.push("")
			for (const v of d.values) {
				lines.push(`- ${v}`)
			}
			lines.push("")
		}
	}

	return lines.join("\n")
}

// ── Main (runs when executed directly) ──

if (import.meta.main) {
	const outputPath = process.argv.includes("--output")
		? process.argv[process.argv.indexOf("--output") + 1]
		: null

	const data = await runMatrix()
	const report = generateReport(data)

	if (outputPath) {
		const { writeFile } = await import("node:fs/promises")
		await writeFile(outputPath, report, "utf-8")
		console.log(`Conformance matrix written to ${outputPath}`)
	} else {
		console.log(report)
	}
}
