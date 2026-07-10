/**
 * Tests for terminalStateDigest() + diffTerminalStates() — the state-digest
 * comparator that gives ONE "same terminal state" vocabulary across backends.
 *
 * Two independently-fed backends that saw identical bytes must digest equal
 * (byte-identical under JSON.stringify); a single differing cell, a cursor
 * move, or a mode flip must surface as a structured, row-named diff. A digest
 * is plain serializable data and survives a JSON round-trip unchanged.
 */

import { afterEach, describe, expect, test } from "vitest"
import { createVtermBackend } from "../packages/vterm/src/index.ts"
import { diffTerminalStates, terminalStateDigest } from "../src/terminal/state-digest.ts"
import type { TerminalBackend } from "../src/terminal/types.ts"

const encoder = new TextEncoder()
const ESC = "\x1b"

const active: TerminalBackend[] = []

afterEach(() => {
  for (const b of active) b.destroy()
  active.length = 0
})

/** Create a vterm backend at the given geometry, feed bytes, return it. */
function fed(bytes: string, cols = 20, rows = 6): TerminalBackend {
  const backend = createVtermBackend()
  backend.init({ cols, rows })
  backend.feed(encoder.encode(bytes))
  active.push(backend)
  return backend
}

// A rich flood exercising text, colors, styles, and cursor moves.
const FLOOD =
  `${ESC}[1;1HHeader\r\n` +
  `${ESC}[31mred${ESC}[0m ${ESC}[1mbold${ESC}[0m ${ESC}[4munder${ESC}[0m\r\n` +
  `${ESC}[38;2;10;20;30mtrue${ESC}[0m\r\n` +
  `tail${ESC}[2;2H`

describe("terminalStateDigest", () => {
  test("two independently-fed backends with identical floods digest equal (byte-identical)", () => {
    const a = terminalStateDigest(fed(FLOOD))
    const b = terminalStateDigest(fed(FLOOD))

    expect(a).toEqual(b)
    // Determinism rule: same state ⇒ byte-identical serialization.
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(diffTerminalStates(a, b).equal).toBe(true)
  })

  test("size reflects the terminal geometry, not the buffer length", () => {
    const d = terminalStateDigest(fed("hi", 40, 12))
    expect(d.size).toEqual({ cols: 40, rows: 12 })
    expect(d.rows).toHaveLength(12)
  })

  test("captures the visible grid as text lines", () => {
    const d = terminalStateDigest(fed("abc\r\ndef"))
    expect(d.rows[0]!.text).toBe("abc")
    expect(d.rows[1]!.text).toBe("def")
    expect(d.rows[2]!.text).toBe("")
  })

  test("is deterministic across two calls on the same terminal", () => {
    const term = fed(FLOOD)
    const d1 = terminalStateDigest(term)
    const d2 = terminalStateDigest(term)
    expect(JSON.stringify(d1)).toBe(JSON.stringify(d2))
    expect(d1).toEqual(d2)
  })

  test("survives a JSON round-trip unchanged", () => {
    const d = terminalStateDigest(fed(FLOOD))
    const round = JSON.parse(JSON.stringify(d))
    expect(round).toEqual(d)
    expect(diffTerminalStates(d, round).equal).toBe(true)
  })

  test("trimTrailingBlanks:false renders full-width row text", () => {
    const trimmed = terminalStateDigest(fed("hi", 20, 4))
    const full = terminalStateDigest(fed("hi", 20, 4), { trimTrailingBlanks: false })
    expect(trimmed.rows[0]!.text).toBe("hi")
    expect(full.rows[0]!.text).toHaveLength(20)
    expect(full.rows[0]!.text.startsWith("hi")).toBe(true)
    // Style signatures span the full width regardless of text trimming.
    expect(trimmed.rows[0]!.style).toBe(full.rows[0]!.style)
  })
})

describe("diffTerminalStates", () => {
  test("a one-cell fg difference produces a diff naming the row", () => {
    // Identical text on every row; only row 1's pen color differs.
    const a = terminalStateDigest(fed(`abc\r\n${ESC}[31mdef${ESC}[0m\r\nghi`))
    const b = terminalStateDigest(fed(`abc\r\n${ESC}[32mdef${ESC}[0m\r\nghi`))
    const diff = diffTerminalStates(a, b)

    expect(diff.equal).toBe(false)
    expect(diff.rows).toHaveLength(1)
    expect(diff.rows![0]!.row).toBe(1)
    // Text is identical — the divergence is purely style.
    expect(diff.rows![0]!.a.text).toBe("def")
    expect(diff.rows![0]!.b.text).toBe("def")
    expect(diff.rows![0]!.a.style).not.toBe(diff.rows![0]!.b.style)
    expect(diff.formatted).toContain("row 1")
  })

  test("a cursor move is detected without any cell change", () => {
    const a = terminalStateDigest(fed("hello"))
    const b = terminalStateDigest(fed(`hello${ESC}[1;1H`))
    const diff = diffTerminalStates(a, b)

    expect(diff.equal).toBe(false)
    expect(diff.cursor).toBeDefined()
    expect(diff.cursor!.a.col).toBe(5)
    expect(diff.cursor!.b.col).toBe(0)
    // No glyph changed — the grids are identical.
    expect(diff.rows ?? []).toHaveLength(0)
    expect(diff.formatted).toContain("cursor")
  })

  test("an altScreen mode flip is detected", () => {
    const a = terminalStateDigest(fed("hello"))
    const b = terminalStateDigest(fed(`hello${ESC}[?1049h`))
    const diff = diffTerminalStates(a, b)

    expect(diff.equal).toBe(false)
    const altScreen = diff.modes?.find((m) => m.mode === "altScreen")
    expect(altScreen).toBeDefined()
    expect(altScreen!.a).toBe(false)
    expect(altScreen!.b).toBe(true)
    expect(diff.formatted).toContain("altScreen")
  })

  test("a title change is detected", () => {
    const a = terminalStateDigest(fed(`${ESC}]0;alpha\x07hi`))
    const b = terminalStateDigest(fed(`${ESC}]0;beta\x07hi`))
    const diff = diffTerminalStates(a, b)

    expect(diff.equal).toBe(false)
    expect(diff.title).toEqual({ a: "alpha", b: "beta" })
    expect(diff.formatted).toContain("title")
  })

  test("equal digests report equal with an empty, sentinel-formatted diff", () => {
    const d = terminalStateDigest(fed(FLOOD))
    const diff = diffTerminalStates(d, d)
    expect(diff.equal).toBe(true)
    expect(diff.rows ?? []).toHaveLength(0)
    expect(diff.modes ?? []).toHaveLength(0)
    expect(diff.cursor).toBeUndefined()
    expect(diff.formatted).toBe("Terminal states are identical")
  })

  test("reports every differing row, in order", () => {
    const a = terminalStateDigest(fed("aaa\r\nbbb\r\nccc"))
    const b = terminalStateDigest(fed("aaa\r\nBBB\r\nCCC"))
    const diff = diffTerminalStates(a, b)

    expect(diff.equal).toBe(false)
    expect(diff.rows!.map((r) => r.row)).toEqual([1, 2])
    expect(diff.rows![0]!.a.text).toBe("bbb")
    expect(diff.rows![0]!.b.text).toBe("BBB")
  })
})
